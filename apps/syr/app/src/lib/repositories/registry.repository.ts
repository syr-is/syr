import { dbService } from '$lib/services/db';
import type { RecordId } from 'surrealdb';

export interface IdentityRegistry {
	id: RecordId;
	identity_did: string;
	registry_url: string;
	status: 'pending' | 'synced' | 'error';
	last_synced_at: string | null;
	created_at: string;
}

class RegistryRepository {
	private get db() {
		return dbService.getDb();
	}

	/**
	 * Add a registry URL for an identity.
	 */
	async addRegistry(did: string, registryUrl: string): Promise<IdentityRegistry> {
		const now = new Date();
		const result = await this.db.query<[IdentityRegistry[]]>(
			`CREATE identity_registry SET
				identity_did = $did,
				registry_url = $registryUrl,
				status = "pending",
				last_synced_at = NONE,
				created_at = $now`,
			{ did, registryUrl, now }
		);
		return result[0][0];
	}

	/**
	 * Remove a registry for an identity.
	 */
	async removeRegistry(id: RecordId): Promise<void> {
		await this.db.query('DELETE FROM identity_registry WHERE id = $id', { id });
	}

	/**
	 * Find all registries for a DID.
	 */
	async findByDid(did: string): Promise<IdentityRegistry[]> {
		const result = await this.db.query<[IdentityRegistry[]]>(
			'SELECT * FROM identity_registry WHERE identity_did = $did ORDER BY created_at ASC',
			{ did }
		);
		return result[0] ?? [];
	}

	/**
	 * Find a specific registry entry.
	 */
	async findById(id: RecordId): Promise<IdentityRegistry | null> {
		const result = await this.db.query<[IdentityRegistry[]]>(
			'SELECT * FROM identity_registry WHERE id = $id LIMIT 1',
			{ id }
		);
		return result[0]?.[0] ?? null;
	}

	/**
	 * Find a registry entry by DID and URL.
	 */
	async findByDidAndUrl(did: string, registryUrl: string): Promise<IdentityRegistry | null> {
		const result = await this.db.query<[IdentityRegistry[]]>(
			'SELECT * FROM identity_registry WHERE identity_did = $did AND registry_url = $registryUrl LIMIT 1',
			{ did, registryUrl }
		);
		return result[0]?.[0] ?? null;
	}

	/**
	 * Update the sync status of a registry entry.
	 */
	async updateStatus(
		did: string,
		registryUrl: string,
		status: 'pending' | 'synced' | 'error'
	): Promise<void> {
		const params: Record<string, unknown> = { did, registryUrl, status };
		let query = 'UPDATE identity_registry SET status = $status';
		if (status === 'synced') {
			query += ', last_synced_at = time::now()';
		}
		query += ' WHERE identity_did = $did AND registry_url = $registryUrl';
		await this.db.query(query, params);
	}
}

export const registryRepository = new RegistryRepository();
