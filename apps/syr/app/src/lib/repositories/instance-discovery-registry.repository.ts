import { normalizeRegistryUrl } from '$lib/registry-url';
import { dbService } from '$lib/services/db';
import type { RecordId } from 'surrealdb';

export interface InstanceDiscoveryRegistry {
	id: RecordId;
	registry_url: string;
	created_at: string;
}

class InstanceDiscoveryRegistryRepository {
	private get db() {
		return dbService.getDb();
	}

	async add(registryUrl: string): Promise<InstanceDiscoveryRegistry> {
		const normalized = normalizeRegistryUrl(registryUrl);
		const now = new Date();
		const result = await this.db.query<[InstanceDiscoveryRegistry[]]>(
			`CREATE instance_discovery_registry SET
				registry_url = $registryUrl,
				created_at = $now`,
			{ registryUrl: normalized, now }
		);
		const rows = Array.isArray(result[0]) ? result[0] : [];
		const row = rows[0];
		if (!row) {
			throw new Error('instance_discovery_registry.add: CREATE returned no row');
		}
		return row;
	}

	async remove(id: RecordId): Promise<boolean> {
		const result = await this.db.query<[InstanceDiscoveryRegistry[]]>(
			'DELETE FROM instance_discovery_registry WHERE id = $id RETURN BEFORE',
			{ id }
		);
		const deleted = result[0] ?? [];
		return deleted.length > 0;
	}

	async findAll(): Promise<InstanceDiscoveryRegistry[]> {
		const result = await this.db.query<[InstanceDiscoveryRegistry[]]>(
			'SELECT * FROM instance_discovery_registry ORDER BY created_at ASC'
		);
		return result[0] ?? [];
	}

	async findById(id: RecordId): Promise<InstanceDiscoveryRegistry | null> {
		const result = await this.db.query<[InstanceDiscoveryRegistry[]]>(
			'SELECT * FROM instance_discovery_registry WHERE id = $id LIMIT 1',
			{ id }
		);
		return result[0]?.[0] ?? null;
	}

	async findByUrl(registryUrl: string): Promise<InstanceDiscoveryRegistry | null> {
		const normalized = normalizeRegistryUrl(registryUrl);
		const result = await this.db.query<[InstanceDiscoveryRegistry[]]>(
			'SELECT * FROM instance_discovery_registry WHERE registry_url = $registryUrl LIMIT 1',
			{ registryUrl: normalized }
		);
		return result[0]?.[0] ?? null;
	}
}

export const instanceDiscoveryRegistryRepository = new InstanceDiscoveryRegistryRepository();
