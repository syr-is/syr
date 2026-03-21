import { Injectable } from '@nestjs/common';
import { DbService } from '../db/db.service';
import { UpdateRecordDto } from './dto/update-record.dto';
import { DeleteRecordDto } from './dto/delete-record.dto';
import { DirectoryUpsertDto } from './dto/directory-upsert.dto';
import { verify, canonicalize, decodeMultibase } from '@syr-is/crypto';
import { parseDid } from '@syr-is/did';

export interface HostingRecord {
	did: string;
	provider: string;
	updatedAt: string;
	signature: string;
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

	/**
	 * Resolve a DID to its hosting record.
	 */
	async resolve(did: string): Promise<HostingRecord | null> {
		const db = this.dbService.getDb();
		const result = await db.query<[HostingRecord[]]>(
			'SELECT did, provider, updated_at AS updatedAt, signature FROM hosting_record WHERE did = $did LIMIT 1',
			{ did }
		);

		return result[0]?.[0] ?? null;
	}

	/**
	 * Update (or create) a hosting record.
	 * Verifies the Ed25519 signature against the public key embedded in the DID.
	 */
	async update(dto: UpdateRecordDto): Promise<HostingRecord> {
		// 1. Parse the DID to extract the public key
		const parsed = parseDid(dto.did);
		const publicKey = parsed.publicKey;

		// 2. Build the canonical payload (JCS — RFC 8785)
		const payload = canonicalize({
			did: dto.did,
			provider: dto.provider,
			updatedAt: dto.updatedAt
		});

		// 3. Decode the signature from multibase (raw Ed25519 signature bytes)
		const signatureBytes = decodeMultibase(dto.signature);

		// 4. Verify the Ed25519 signature
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
		const db = this.dbService.getDb();
		if (existing) {
			const result = await db.query(
				`UPDATE hosting_record SET
          provider = $provider,
          updated_at = $updatedAt,
          signature = $signature
        WHERE did = $did AND updated_at < $updatedAt`,
				{
					did: dto.did,
					provider: dto.provider,
					updatedAt: updatedAtDate,
					signature: dto.signature
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
          signature = $signature`,
					{
						did: dto.did,
						provider: dto.provider,
						updatedAt: updatedAtDate,
						signature: dto.signature
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

		return {
			did: dto.did,
			provider: dto.provider,
			updatedAt: dto.updatedAt,
			signature: dto.signature
		};
	}

	/**
	 * Delete a hosting record.
	 * Verifies the Ed25519 signature on the deletion request.
	 */
	async delete(dto: DeleteRecordDto): Promise<void> {
		// 1. Parse the DID to extract the public key
		const parsed = parseDid(dto.did);
		const publicKey = parsed.publicKey;

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

		// 5. Delete the record
		const db = this.dbService.getDb();
		await db.query('DELETE FROM hosting_record WHERE did = $did', {
			did: dto.did
		});
	}

	async upsertDirectory(dto: DirectoryUpsertDto): Promise<DirectoryEntry> {
		const parsed = parseDid(dto.did);
		const publicKey = parsed.publicKey;

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

		const db = this.dbService.getDb();
		const existing = await db.query<[DirectoryRow[]]>(
			'SELECT * FROM directory_entry WHERE did = $did LIMIT 1',
			{ did: dto.did }
		);
		const prev = existing[0]?.[0];
		const newTime = new Date(dto.updatedAt).getTime();
		if (prev) {
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
		} else {
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
		const result = await db.query<[DirectoryRow[]]>(
			`SELECT * FROM directory_entry WHERE listed = true ORDER BY updated_at DESC LIMIT 500`,
			{}
		);
		const rows = result[0] ?? [];
		const needle = q.trim().toLowerCase();
		const filtered = needle
			? rows.filter(
					(r) =>
						r.did.toLowerCase().includes(needle) ||
						r.username.toLowerCase().includes(needle) ||
						(r.display_name || '').toLowerCase().includes(needle)
				)
			: rows;
		return filtered.slice(0, cap).map((r) => ({
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
