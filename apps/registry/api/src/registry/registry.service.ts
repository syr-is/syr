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

/** Committed rollback-protection state for a DID (0/[] = never rotated). */
interface StoredRotationState {
	maxSeq: number;
	chain: RotationStatement[];
}

/**
 * Token thrown by an in-transaction stale/concurrency guard. Surfaced in the
 * SurrealDB error message and normalized to a STALE_UPDATE-classifiable error.
 */
const STALE_CONCURRENT_MARKER = 'SYR_STALE_CONCURRENT_UPDATE';

/**
 * Structural equality for a committed rotation statement against an incoming
 * one (prefix pinning). Comparing the signature also pins rotatedAt, since the
 * signature is made over the canonical statement (which includes rotatedAt).
 */
function rotationStatementsEqual(a: RotationStatement, b: RotationStatement | undefined): boolean {
	if (!b) return false;
	return (
		a.did === b.did &&
		a.seq === b.seq &&
		a.prevRoot === b.prevRoot &&
		a.newRoot === b.newRoot &&
		a.signature === b.signature
	);
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

	/** Re-throw a normalized stale error when a transaction hit the concurrency guard. */
	private static rethrowStaleConcurrent(err: unknown, message: string): never {
		const msg = err instanceof Error ? err.message : String(err);
		if (msg.includes(STALE_CONCURRENT_MARKER)) {
			throw new Error(message);
		}
		throw err instanceof Error ? err : new Error(msg);
	}

	/**
	 * Resolve the CURRENT root key for a DID (genesis when no chain is
	 * supplied) and enforce rollback + fork protection against the committed
	 * rotation chain:
	 *
	 * - a chain shorter than the committed high-water mark is a rollback;
	 * - the incoming chain MUST exactly extend the committed one — every
	 *   committed statement must appear identically at the same index — so a
	 *   same-length divergence or any prefix mismatch (e.g. a fork forged from
	 *   a compromised RETIRED key below the committed tip) is rejected.
	 *
	 * Both are surfaced as rotation-chain errors (INVALID_ROTATION_CHAIN).
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

		const stored = await this.getStoredRotationState(did);

		// Rollback protection: reject any chain shorter than the committed
		// high-water mark (a stolen retired key re-registering with fewer hops).
		const committedLength = Math.max(stored.maxSeq, stored.chain.length);
		if (chain.length < committedLength) {
			throw new Error(
				`Rotation chain rollback rejected: incoming seq ${chain.length} is not greater than recorded seq ${committedLength}`
			);
		}

		// Prefix pinning: every committed statement must be reproduced exactly
		// by the incoming chain. Guarantees the new chain strictly extends the
		// stored one; forks and same-length divergences fail here.
		for (let i = 0; i < stored.chain.length; i++) {
			if (!rotationStatementsEqual(stored.chain[i], chain[i])) {
				throw new Error(
					`Rotation chain fork rejected: incoming chain diverges from the committed chain at seq ${i + 1}`
				);
			}
		}

		return { publicKey, chainSeq: chain.length };
	}

	/** Committed rollback-protection state for a DID (high-water seq + full chain). */
	private async getStoredRotationState(did: string): Promise<StoredRotationState> {
		const db = this.dbService.getDb();
		const result = await db.query<[Array<{ max_seq: number; chain?: RotationStatement[] }>]>(
			'SELECT max_seq, chain FROM did_rotation_state WHERE did = $did LIMIT 1',
			{ did }
		);
		const row = result[0]?.[0];
		return {
			maxSeq: row?.max_seq ?? 0,
			chain: Array.isArray(row?.chain) ? (row.chain as RotationStatement[]) : []
		};
	}

	/**
	 * SurrealQL fragment (used inside a transaction) that advances the
	 * rollback-protection commitment for `$did` to `$maxSeq` / `$rotationChain`.
	 * Empty for genesis records (no chain to commit). The monotonic `<= $maxSeq`
	 * guard keeps a concurrent higher commitment from being regressed.
	 */
	private rotationStateCommitFragment(chainSeq: number): string {
		if (chainSeq <= 0) return '';
		return `
			LET $stateRows = SELECT id FROM did_rotation_state WHERE did = $did;
			IF array::len($stateRows) == 0 {
				CREATE did_rotation_state SET did = $did, max_seq = $maxSeq, chain = $rotationChain, updated_at = time::now();
			} ELSE {
				UPDATE did_rotation_state SET max_seq = $maxSeq, chain = $rotationChain, updated_at = time::now()
					WHERE did = $did AND max_seq <= $maxSeq;
			};
		`;
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
	 * rotation_chain (verified from genesis, rollback- and fork-protected).
	 * The record write and the rollback-protection commitment are persisted in
	 * a single transaction so they commit or fail together.
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

		// 6. Upsert the hosting record + advance the rotation commitment atomically.
		// SurrealDB datetime field expects a Date; DTO provides ISO string
		const updatedAtDate = new Date(dto.updatedAt);
		const rotationChain = dto.rotation_chain ?? [];
		const db = this.dbService.getDb();
		const params = {
			did: dto.did,
			provider: dto.provider,
			updatedAt: updatedAtDate,
			signature: dto.signature,
			rotationChain,
			maxSeq: chainSeq
		};

		if (existing) {
			// Re-check freshness inside the transaction (the record may have
			// advanced since resolve()); THROW aborts so the commitment below
			// never advances on a losing concurrent write.
			const query = `
				BEGIN TRANSACTION;
				LET $current = SELECT updated_at FROM hosting_record WHERE did = $did;
				IF array::len($current) == 0 OR $current[0].updated_at >= $updatedAt {
					THROW "${STALE_CONCURRENT_MARKER}";
				};
				UPDATE hosting_record SET
					provider = $provider,
					updated_at = $updatedAt,
					signature = $signature,
					rotation_chain = $rotationChain
					WHERE did = $did;
				${this.rotationStateCommitFragment(chainSeq)}
				COMMIT TRANSACTION;
			`;
			try {
				await db.query(query, params);
			} catch (err) {
				RegistryService.rethrowStaleConcurrent(
					err,
					'Stale update: record was modified by a concurrent request; updatedAt must be strictly newer'
				);
			}
		} else {
			const query = `
				BEGIN TRANSACTION;
				CREATE hosting_record SET
					did = $did,
					provider = $provider,
					updated_at = $updatedAt,
					signature = $signature,
					rotation_chain = $rotationChain;
				${this.rotationStateCommitFragment(chainSeq)}
				COMMIT TRANSACTION;
			`;
			try {
				await db.query(query, params);
			} catch (createErr) {
				// Concurrent first registration: another request created the record between our resolve() and CREATE
				if (RegistryService.isUniqueConstraintError(createErr)) {
					throw new Error(
						'Concurrent registration: DID was registered by another request; retry with resolve for updates'
					);
				}
				throw createErr;
			}
		}

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
	 * CURRENT root key (genesis + optional rotation chain). The record delete
	 * and the rollback-protection commitment advance in a single transaction.
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

		// 5. Delete the record and advance the rotation commitment atomically.
		//    The commitment (rollback protection) must survive record deletion
		//    and re-registration, so it lives in did_rotation_state, not the
		//    deleted hosting_record.
		const rotationChain = dto.rotation_chain ?? [];
		const db = this.dbService.getDb();
		const query = `
			BEGIN TRANSACTION;
			DELETE hosting_record WHERE did = $did;
			${this.rotationStateCommitFragment(chainSeq)}
			COMMIT TRANSACTION;
		`;
		await db.query(query, { did: dto.did, rotationChain, maxSeq: chainSeq });
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

		const rotationChain = dto.rotation_chain ?? [];
		const commitFragment = this.rotationStateCommitFragment(chainSeq);
		const db = this.dbService.getDb();
		const params = {
			did: dto.did,
			provider: dto.provider,
			username: dto.username,
			displayName: dto.displayName,
			listed: dto.listed,
			updatedAt: new Date(dto.updatedAt),
			signature: dto.signature,
			rotationChain,
			maxSeq: chainSeq
		};

		const selectRow = async (): Promise<DirectoryRow | undefined> => {
			const existing = await db.query<[DirectoryRow[]]>(
				'SELECT * FROM directory_entry WHERE did = $did LIMIT 1',
				{ did: dto.did }
			);
			return existing[0]?.[0];
		};

		// Directory write + rollback-protection commitment in one transaction.
		const runDirectoryUpdate = async (prev: DirectoryRow) => {
			const oldTime = new Date(prev.updated_at).getTime();
			const newTime = new Date(dto.updatedAt).getTime();
			if (newTime <= oldTime) {
				throw new Error(
					'Stale update: updatedAt must be strictly newer than the existing directory row'
				);
			}
			const query = `
				BEGIN TRANSACTION;
				LET $current = SELECT updated_at FROM directory_entry WHERE did = $did;
				IF array::len($current) == 0 OR $current[0].updated_at >= $updatedAt {
					THROW "${STALE_CONCURRENT_MARKER}";
				};
				UPDATE directory_entry SET
					provider = $provider,
					username = $username,
					display_name = $displayName,
					listed = $listed,
					updated_at = $updatedAt,
					signature = $signature
					WHERE did = $did;
				${commitFragment}
				COMMIT TRANSACTION;
			`;
			try {
				await db.query(query, params);
			} catch (err) {
				RegistryService.rethrowStaleConcurrent(
					err,
					'Stale update: directory row was modified by a concurrent request; updatedAt must be strictly newer'
				);
			}
		};

		let prev = await selectRow();
		if (prev) {
			await runDirectoryUpdate(prev);
		} else {
			const query = `
				BEGIN TRANSACTION;
				CREATE directory_entry SET
					did = $did,
					provider = $provider,
					username = $username,
					display_name = $displayName,
					listed = $listed,
					updated_at = $updatedAt,
					signature = $signature;
				${commitFragment}
				COMMIT TRANSACTION;
			`;
			try {
				await db.query(query, params);
			} catch (createErr) {
				if (!RegistryService.isUniqueConstraintError(createErr)) {
					throw createErr;
				}
				prev = await selectRow();
				if (!prev) {
					throw createErr;
				}
				await runDirectoryUpdate(prev);
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
