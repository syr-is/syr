import { Injectable } from '@nestjs/common';
import { DbService } from '../db/db.service';
import { UpdateRecordDto } from './dto/update-record.dto';
import { DeleteRecordDto } from './dto/delete-record.dto';
import { DirectoryUpsertDto } from './dto/directory-upsert.dto';
import { verify, canonicalize, decodeMultibase, verifyRotationChain } from '@syr-is/crypto';
import { parseDid } from '@syr-is/did';
import type { RotationStatement } from '@syr-is/types';

export interface HostingRecord {
	did: string;
	provider: string;
	updatedAt: string;
	signature: string;
	/** Root-key rotation chain the record signature was verified against (empty/absent = genesis). */
	rotation_chain?: RotationStatement[];
}

export interface DirectoryEntry {
	did: string;
	provider: string;
	username: string;
	displayName: string;
	listed: boolean;
	updatedAt: string;
	signature: string;
}

interface DirectoryRow {
	did: string;
	provider: string;
	username: string;
	display_name: string;
	listed: boolean;
	updated_at: string;
	signature: string;
}

@Injectable()
export class RegistryService {
	constructor(private readonly dbService: DbService) {}

	private static isUniqueConstraintError(error: unknown): boolean {
		if (error && typeof error === 'object') {
			if ('code' in error && (error as { code: string }).code === 'UNIQUE_CONSTRAINT_VIOLATION') {
				return true;
			}
			if ('message' in error) {
				const msg = String((error as { message: string }).message).toLowerCase();
				return (
					msg.includes('unique') ||
					msg.includes('duplicate') ||
					msg.includes('already exists') ||
					msg.includes('constraint')
				);
			}
		}
		return false;
	}

	/**
	 * Resolve the CURRENT root key for a DID (genesis when no chain is
	 * supplied) and enforce rollback protection: a payload whose chain is
	 * shorter than the registry's recorded high-water mark is rejected.
	 *
	 * Returns the key to verify the record signature against, plus the chain
	 * seq for state persistence after successful verification.
	 */
	private async resolveVerificationKey(
		did: string,
		rotationChain: RotationStatement[] | undefined
	): Promise<{ publicKey: Uint8Array; chainSeq: number }> {
		const chain = rotationChain ?? [];
		let publicKey: Uint8Array;
		if (chain.length === 0) {
			publicKey = parseDid(did).publicKey;
		} else {
			try {
				publicKey = await verifyRotationChain(did, chain);
			} catch (err) {
				const detail = err instanceof Error ? err.message : String(err);
				throw new Error(`Invalid rotation chain: ${detail}`);
			}
		}

		const storedSeq = await this.getStoredRotationSeq(did);
		if (chain.length < storedSeq) {
			throw new Error(
				`Stale rotation chain: seq ${chain.length} is lower than the previously recorded seq ${storedSeq}`
			);
		}

		return { publicKey, chainSeq: chain.length };
	}

	/** Highest rotation-chain seq the registry has accepted for this DID (0 = none). */
	private async getStoredRotationSeq(did: string): Promise<number> {
		const db = this.dbService.getDb();
		const result = await db.query<[Array<{ max_seq: number }>]>(
			'SELECT max_seq FROM did_rotation_state WHERE did = $did LIMIT 1',
			{ did }
		);
		return result[0]?.[0]?.max_seq ?? 0;
	}

	/** Persist the highest seen rotation seq for a DID (monotonic). */
	private async recordRotationSeq(did: string, chainSeq: number): Promise<void> {
		if (chainSeq <= 0) return;
		const db = this.dbService.getDb();
		const stored = await this.getStoredRotationSeq(did);
		if (chainSeq <= stored) return;
		if (stored === 0) {
			try {
				await db.query(
					`CREATE did_rotation_state SET did = $did, max_seq = $maxSeq, updated_at = time::now()`,
					{ did, maxSeq: chainSeq }
				);
				return;
			} catch (err) {
				if (!RegistryService.isUniqueConstraintError(err)) throw err;
				// Concurrent create: fall through to monotonic update.
			}
		}
		await db.query(
			`UPDATE did_rotation_state SET max_seq = $maxSeq, updated_at = time::now()
        WHERE did = $did AND max_seq < $maxSeq`,
			{ did, maxSeq: chainSeq }
		);
	}

	/**
	 * Resolve a DID to its hosting record (including the rotation chain the
	 * record was verified against, when the identity has rotated).
	 */
	async resolve(did: string): Promise<HostingRecord | null> {
		const db = this.dbService.getDb();
		const result = await db.query<[HostingRecord[]]>(
			'SELECT did, provider, updated_at AS updatedAt, signature, rotation_chain FROM hosting_record WHERE did = $did LIMIT 1',
			{ did }
		);

		const record = result[0]?.[0];
		if (!record) return null;
		if (record.rotation_chain == null || record.rotation_chain.length === 0) {
			delete record.rotation_chain;
		}
		return record;
	}

	/**
	 * Update (or create) a hosting record.
	 * Verifies the Ed25519 signature against the CURRENT root key: the
	 * genesis key embedded in the DID, advanced through the optional
	 * rotation_chain (verified from genesis, rollback-protected).
	 */
	async update(dto: UpdateRecordDto): Promise<HostingRecord> {
		// 1. Resolve the current root key (genesis + optional rotation chain)
		const { publicKey, chainSeq } = await this.resolveVerificationKey(dto.did, dto.rotation_chain);

		// 2. Build the canonical payload (JCS — RFC 8785)
		const payload = canonicalize({
			did: dto.did,
			provider: dto.provider,
			updatedAt: dto.updatedAt
		});

		// 3. Decode the signature from multibase (raw Ed25519 signature bytes)
		const signatureBytes = decodeMultibase(dto.signature);

		// 4. Verify the Ed25519 signature under the current root key
		const isValid = await verify(payload, signatureBytes, publicKey);

		if (!isValid) {
			throw new Error('Invalid signature: verification failed against DID public key');
		}

		// 5. Check freshness — updatedAt must be strictly newer than stored
		const existing = await this.resolve(dto.did);
		if (existing) {
			const existingTime = new Date(existing.updatedAt).getTime();
			const newTime = new Date(dto.updatedAt).getTime();
			if (newTime <= existingTime) {
				throw new Error('Stale update: updatedAt must be strictly newer than the existing record');
			}
		}

		// 6. Upsert the hosting record
		// SurrealDB datetime field expects a Date; DTO provides ISO string
		const updatedAtDate = new Date(dto.updatedAt);
		const rotationChain = dto.rotation_chain ?? [];
		const db = this.dbService.getDb();
		if (existing) {
			const result = await db.query(
				`UPDATE hosting_record SET
          provider = $provider,
          updated_at = $updatedAt,
          signature = $signature,
          rotation_chain = $rotationChain
        WHERE did = $did AND updated_at < $updatedAt`,
				{
					did: dto.did,
					provider: dto.provider,
					updatedAt: updatedAtDate,
					signature: dto.signature,
					rotationChain
				}
			);
			const updated = result[0] ?? [];
			if (!Array.isArray(updated) || updated.length === 0) {
				throw new Error(
					'Stale update: record was modified by a concurrent request; updatedAt must be strictly newer'
				);
			}
		} else {
			try {
				await db.query(
					`CREATE hosting_record SET
          did = $did,
          provider = $provider,
          updated_at = $updatedAt,
          signature = $signature,
          rotation_chain = $rotationChain`,
					{
						did: dto.did,
						provider: dto.provider,
						updatedAt: updatedAtDate,
						signature: dto.signature,
						rotationChain
					}
				);
			} catch (createErr) {
				// Concurrent first registration: another request created the record between our resolve() and CREATE
				const msg = createErr instanceof Error ? createErr.message : String(createErr);
				if (
					msg.toLowerCase().includes('unique') ||
					msg.toLowerCase().includes('duplicate') ||
					msg.toLowerCase().includes('constraint') ||
					(createErr as { code?: string }).code === 'UNIQUE_CONSTRAINT_VIOLATION'
				) {
					throw new Error(
						'Concurrent registration: DID was registered by another request; retry with resolve for updates'
					);
				}
				throw createErr;
			}
		}

		// 7. Record the accepted rotation seq (monotonic high-water mark)
		await this.recordRotationSeq(dto.did, chainSeq);

		return {
			did: dto.did,
			provider: dto.provider,
			updatedAt: dto.updatedAt,
			signature: dto.signature,
			...(rotationChain.length > 0 ? { rotation_chain: rotationChain } : {})
		};
	}

	/**
	 * Delete a hosting record.
	 * Verifies the Ed25519 signature on the deletion request under the
	 * CURRENT root key (genesis + optional rotation chain).
	 */
	async delete(dto: DeleteRecordDto): Promise<void> {
		// 1. Resolve the current root key (genesis + optional rotation chain)
		const { publicKey, chainSeq } = await this.resolveVerificationKey(dto.did, dto.rotation_chain);

		// 2. Build the canonical payload
		const payload = canonicalize({
			did: dto.did,
			deletedAt: dto.deletedAt
		});

		// 3. Decode and verify signature
		const signatureBytes = decodeMultibase(dto.signature);
		const isValid = await verify(payload, signatureBytes, publicKey);

		if (!isValid) {
			throw new Error('Invalid signature: verification failed against DID public key');
		}

		// 4. Check record exists
		const existing = await this.resolve(dto.did);
		if (!existing) {
			throw new Error('Not found: no hosting record for this DID');
		}

		// 5. Delete the record (keep rotation state: rollback protection
		//    must survive record deletion and re-registration)
		const db = this.dbService.getDb();
		await db.query('DELETE FROM hosting_record WHERE did = $did', {
			did: dto.did
		});
		await this.recordRotationSeq(dto.did, chainSeq);
	}

	async upsertDirectory(dto: DirectoryUpsertDto): Promise<DirectoryEntry> {
		const { publicKey, chainSeq } = await this.resolveVerificationKey(dto.did, dto.rotation_chain);

		const payload = canonicalize({
			did: dto.did,
			provider: dto.provider,
			username: dto.username,
			displayName: dto.displayName,
			listed: dto.listed,
			updatedAt: dto.updatedAt
		});

		const signatureBytes = decodeMultibase(dto.signature);
		const isValid = await verify(payload, signatureBytes, publicKey);
		if (!isValid) {
			throw new Error('Invalid signature: directory upsert verification failed');
		}
		await this.recordRotationSeq(dto.did, chainSeq);

		const db = this.dbService.getDb();
		const selectRow = async (): Promise<DirectoryRow | undefined> => {
			const existing = await db.query<[DirectoryRow[]]>(
				'SELECT * FROM directory_entry WHERE did = $did LIMIT 1',
				{ did: dto.did }
			);
			return existing[0]?.[0];
		};

		let prev = await selectRow();
		const newTime = new Date(dto.updatedAt).getTime();
		const runDirectoryUpdate = async () => {
			if (!prev) return;
			const oldTime = new Date(prev.updated_at).getTime();
			if (newTime <= oldTime) {
				throw new Error(
					'Stale update: updatedAt must be strictly newer than the existing directory row'
				);
			}
			await db.query(
				`UPDATE directory_entry SET
          provider = $provider,
          username = $username,
          display_name = $displayName,
          listed = $listed,
          updated_at = $updatedAt,
          signature = $signature
        WHERE did = $did AND updated_at < $updatedAt`,
				{
					did: dto.did,
					provider: dto.provider,
					username: dto.username,
					displayName: dto.displayName,
					listed: dto.listed,
					updatedAt: new Date(dto.updatedAt),
					signature: dto.signature
				}
			);
		};

		if (prev) {
			await runDirectoryUpdate();
		} else {
			try {
				await db.query(
					`CREATE directory_entry SET
          did = $did,
          provider = $provider,
          username = $username,
          display_name = $displayName,
          listed = $listed,
          updated_at = $updatedAt,
          signature = $signature`,
					{
						did: dto.did,
						provider: dto.provider,
						username: dto.username,
						displayName: dto.displayName,
						listed: dto.listed,
						updatedAt: new Date(dto.updatedAt),
						signature: dto.signature
					}
				);
			} catch (createErr) {
				if (!RegistryService.isUniqueConstraintError(createErr)) {
					throw createErr;
				}
				prev = await selectRow();
				if (!prev) {
					throw createErr;
				}
				await runDirectoryUpdate();
			}
		}

		return {
			did: dto.did,
			provider: dto.provider,
			username: dto.username,
			displayName: dto.displayName,
			listed: dto.listed,
			updatedAt: dto.updatedAt,
			signature: dto.signature
		};
	}

	async searchDirectory(q: string, limit: number): Promise<DirectoryEntry[]> {
		const db = this.dbService.getDb();
		const cap = Math.min(Math.max(limit, 1), 100);
		const needle = q.trim().toLowerCase();
		const result = await db.query<[DirectoryRow[]]>(
			needle
				? `SELECT * FROM directory_entry
           WHERE listed = true AND (
             string::contains(string::lowercase(did), $needle)
             OR string::contains(string::lowercase(username), $needle)
             OR string::contains(string::lowercase(display_name ?? ''), $needle)
           )
           ORDER BY updated_at DESC
           LIMIT $cap`
				: `SELECT * FROM directory_entry
           WHERE listed = true
           ORDER BY updated_at DESC
           LIMIT $cap`,
			needle ? { needle, cap } : { cap }
		);
		const rows = result[0] ?? [];
		return rows.map((r) => ({
			did: r.did,
			provider: r.provider,
			username: r.username,
			displayName: r.display_name,
			listed: r.listed,
			updatedAt:
				typeof r.updated_at === 'string'
					? r.updated_at
					: new Date(r.updated_at as Date).toISOString(),
			signature: r.signature
		}));
	}
}
