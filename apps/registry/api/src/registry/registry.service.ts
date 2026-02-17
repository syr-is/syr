import { Injectable } from '@nestjs/common';
import { DbService } from '../db/db.service';
import { UpdateRecordDto } from './dto/update-record.dto';
import { DeleteRecordDto } from './dto/delete-record.dto';
import { verify, canonicalize, decodeMultibase } from '@syr-is/crypto';
import { parseDid } from '@syr-is/did';

export interface HostingRecord {
	did: string;
	provider: string;
	updatedAt: string;
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
			await db.query(
				`UPDATE hosting_record SET
          provider = $provider,
          updated_at = $updatedAt,
          signature = $signature
        WHERE did = $did`,
				{
					did: dto.did,
					provider: dto.provider,
					updatedAt: updatedAtDate,
					signature: dto.signature
				}
			);
		} else {
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
}
