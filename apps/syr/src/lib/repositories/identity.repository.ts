import type { RecordId } from 'surrealdb';
import { BaseRepository } from './base.repository';
import {
	IdentitySchema,
	DelegatedKeySchema,
	type Identity,
	type DelegatedKey
} from '@syr-is/types';

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
	async findByUserId(userId: string | RecordId): Promise<Identity | null> {
		const result = await this.db.query<[Identity[]]>(
			'SELECT * FROM identity WHERE user_id = $userId LIMIT 1',
			{ userId }
		);
		const record = result[0]?.[0];
		if (!record) return null;
		return this.validate(record);
	}

	/**
	 * Find all identities belonging to a tenant
	 */
	async findByTenant(tenantId: string | RecordId): Promise<Identity[]> {
		const result = await this.db.query<[Identity[]]>(
			'SELECT * FROM identity WHERE tenant_id = $tenantId ORDER BY created_at DESC',
			{ tenantId }
		);
		const records = result[0] ?? [];
		return records.map((r) => this.validate(r));
	}

	/**
	 * Find identity by DID within a specific tenant scope
	 */
	async findByDidAndTenant(did: string, tenantId: string | RecordId): Promise<Identity | null> {
		const result = await this.db.query<[Identity[]]>(
			'SELECT * FROM identity WHERE did = $did AND tenant_id = $tenantId LIMIT 1',
			{ did, tenantId }
		);
		const record = result[0]?.[0];
		if (!record) return null;
		return this.validate(record);
	}

	/**
	 * Atomically create identity, delegated_key, and update user.did in a single transaction.
	 * All three operations succeed or none are applied (no compensating cleanup needed).
	 */
	async createIdentityWithDelegationAndUserUpdate(params: {
		did: string;
		publicKey: string;
		userId: RecordId;
		now: Date;
		devicePublicKey: string;
		scope: string;
		delegationCreatedAt: Date;
		delegationExpiresAt: Date | undefined;
		signature: string;
		canonicalDelegation: string;
	}): Promise<void> {
		const {
			did,
			publicKey,
			userId,
			now,
			devicePublicKey,
			scope,
			delegationCreatedAt,
			delegationExpiresAt,
			signature,
			canonicalDelegation
		} = params;

		// Execute as separate queries in sequence rather than a transaction
		// SurrealDB's transaction support can be finicky with mixed CREATE/UPDATE operations
		try {
			// Create identity record
			console.log('[identity.repository] Creating identity record...', { did, userId });
			const identityResult = await this.db.query(
				`CREATE identity SET
					did = $did,
					public_key = $publicKey,
					user_id = $userId,
					created_at = $now;`,
				{
					did,
					publicKey,
					userId,
					now
				}
			);
			console.log('[identity.repository] Identity created:', identityResult);

			// Create delegated_key record
			// For optional datetime fields, SurrealDB expects NONE, not null
			console.log('[identity.repository] Creating delegated_key record...');
			const delegatedKeyQuery = delegationExpiresAt
				? `CREATE delegated_key SET
					did = $did,
					public_key = $devicePublicKey,
					scope = $scope,
					created_at = $delegationCreatedAt,
					signature = $signature,
					canonical_delegation = $canonicalDelegation,
					expires_at = $delegationExpiresAt;`
				: `CREATE delegated_key SET
					did = $did,
					public_key = $devicePublicKey,
					scope = $scope,
					created_at = $delegationCreatedAt,
					signature = $signature,
					canonical_delegation = $canonicalDelegation;`;

			const delegatedKeyParams: Record<string, unknown> = {
				did,
				devicePublicKey,
				scope,
				delegationCreatedAt,
				signature,
				canonicalDelegation
			};
			if (delegationExpiresAt) {
				delegatedKeyParams.delegationExpiresAt = delegationExpiresAt;
			}

			const delegatedKeyResult = await this.db.query(delegatedKeyQuery, delegatedKeyParams);
			console.log('[identity.repository] Delegated key created:', delegatedKeyResult);

			// Update user with DID
			console.log('[identity.repository] Updating user with DID...');
			const userUpdateResult = await this.db.query(`UPDATE $userId SET did = $did;`, {
				userId,
				did
			});
			console.log('[identity.repository] User updated:', userUpdateResult);
		} catch (error) {
			console.error('[identity.repository] Error during identity creation:', error);
			// If any operation fails, attempt rollback
			// Note: This is not a true atomic transaction, but provides best-effort cleanup
			try {
				await this.db.query(`DELETE identity WHERE did = $did;`, { did });
				await this.db.query(`DELETE delegated_key WHERE did = $did;`, { did });
				await this.db.query(`UPDATE $userId UNSET did;`, { userId });
			} catch (rollbackError) {
				console.error('[identity.repository] Rollback failed:', rollbackError);
			}
			throw error;
		}
	}

	/**
	 * Create an identity with server-generated keys.
	 * Stores the encrypted private key.
	 */
	async createIdentityServerSide(params: {
		did: string;
		publicKey: string;
		encryptedPrivateKey: string;
		userId: RecordId;
		tenantId?: RecordId;
		now: Date;
	}): Promise<void> {
		const { did, publicKey, encryptedPrivateKey, userId, tenantId, now } = params;

		console.log('[identity.repository] Creating identity record (server-side)...', { did, userId });

		let query = `CREATE identity SET
			did = $did,
			public_key = $publicKey,
			encrypted_private_key = $encryptedPrivateKey,
			user_id = $userId,
			created_at = $now`;

		const queryParams: Record<string, unknown> = {
			did,
			publicKey,
			encryptedPrivateKey,
			userId,
			now
		};

		if (tenantId) {
			query += `, tenant_id = $tenantId;`;
			queryParams.tenantId = tenantId;
		} else {
			query += `;`;
		}

		// Create identity record
		await this.db.query(query, queryParams);

		// Update user with DID
		await this.db.query(`UPDATE $userId SET did = $did;`, {
			userId,
			did
		});
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
	async findActiveByDid(did: string): Promise<DelegatedKey[]> {
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
	 * Create a delegated key (for add-device flow).
	 */
	async createDelegatedKey(params: {
		did: string;
		publicKey: string;
		scope: string;
		createdAt: Date;
		expiresAt?: Date;
		signature: string;
		canonicalDelegation: string;
	}): Promise<DelegatedKey> {
		const { did, publicKey, scope, createdAt, expiresAt, signature, canonicalDelegation } = params;

		const expiresClause = expiresAt ? ', expires_at = $expiresAt' : '';
		const query = `CREATE delegated_key SET
			did = $did,
			public_key = $publicKey,
			scope = $scope,
			created_at = $createdAt,
			signature = $signature,
			canonical_delegation = $canonicalDelegation${expiresClause};`;

		const result = await this.db.query<[DelegatedKey[]]>(query, {
			did,
			publicKey,
			scope,
			createdAt,
			signature,
			canonicalDelegation,
			...(expiresAt ? { expiresAt } : {})
		});
		const record = result[0]?.[0];
		if (!record) throw new Error('Failed to create delegated key.');
		return this.validate(record);
	}

	/**
	 * Revoke a delegated key
	 */
	async revoke(id: RecordId | string): Promise<DelegatedKey> {
		return this.update(id, { revoked_at: new Date() } as Partial<DelegatedKey>);
	}
}

// Export singleton instances
export const identityRepository = new IdentityRepository();
export const delegatedKeyRepository = new DelegatedKeyRepository();
