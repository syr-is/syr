import { BaseRepository } from './base.repository';
import { IdentitySchema, DelegatedKeySchema, type Identity, type DelegatedKey } from '@syr-is/types';

/**
 * Identity Repository
 * CRUD operations for the identity table (root identity metadata).
 */
export class IdentityRepository extends BaseRepository<Identity> {
	protected tableName = 'identity';
	protected schema = IdentitySchema;

	/**
	 * Find identity by DID
	 */
	async findByDid(did: string): Promise<Identity | null> {
		const result = await this.db.query<[Identity[]]>(
			'SELECT * FROM identity WHERE did = $did LIMIT 1',
			{ did }
		);
		const record = result[0]?.[0];
		if (!record) return null;
		return this.validate(record);
	}

	/**
	 * Find identity by user ID
	 */
	async findByUserId(userId: string | import('surrealdb').RecordId): Promise<Identity | null> {
		const result = await this.db.query<[Identity[]]>(
			'SELECT * FROM identity WHERE user_id = $userId LIMIT 1',
			{ userId }
		);
		const record = result[0]?.[0];
		if (!record) return null;
		return this.validate(record);
	}
}

/**
 * Delegated Key Repository
 * CRUD operations for the delegated_key table (device delegations).
 */
export class DelegatedKeyRepository extends BaseRepository<DelegatedKey> {
	protected tableName = 'delegated_key';
	protected schema = DelegatedKeySchema;

	/**
	 * Find delegated key by its public key
	 */
	async findByPublicKey(publicKey: string): Promise<DelegatedKey | null> {
		const result = await this.db.query<[DelegatedKey[]]>(
			'SELECT * FROM delegated_key WHERE public_key = $publicKey LIMIT 1',
			{ publicKey }
		);
		const record = result[0]?.[0];
		if (!record) return null;
		return this.validate(record);
	}

	/**
	 * Find all delegated keys for a DID
	 */
	async findByDid(did: string): Promise<DelegatedKey[]> {
		const result = await this.db.query<[DelegatedKey[]]>(
			'SELECT * FROM delegated_key WHERE did = $did ORDER BY created_at DESC',
			{ did }
		);
		const records = result[0] ?? [];
		return records.map((r) => this.validate(r));
	}

	/**
	 * Find all active (non-revoked, non-expired) delegated keys for a DID
	 */
	async findActivByDid(did: string): Promise<DelegatedKey[]> {
		const result = await this.db.query<[DelegatedKey[]]>(
			`SELECT * FROM delegated_key 
			 WHERE did = $did 
			   AND revoked_at IS NONE 
			   AND (expires_at IS NONE OR expires_at > time::now())
			 ORDER BY created_at DESC`,
			{ did }
		);
		const records = result[0] ?? [];
		return records.map((r) => this.validate(r));
	}

	/**
	 * Revoke a delegated key
	 */
	async revoke(id: import('surrealdb').RecordId | string): Promise<DelegatedKey> {
		return this.update(id, { revoked_at: new Date() } as Partial<DelegatedKey>);
	}
}

// Export singleton instances
export const identityRepository = new IdentityRepository();
export const delegatedKeyRepository = new DelegatedKeyRepository();
