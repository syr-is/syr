import { dbService } from '$lib/services/db';
import type { RecordId } from 'surrealdb';

/** Strip trailing /api/v1 (with optional trailing slash) so we store the bare base URL. */
function stripApiV1(url: string): string {
	return url.replace(/\/api\/v1\/?$/, '');
}

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
		const clean = stripApiV1(registryUrl.trim().replace(/\/$/, ''));
		const now = new Date();
		const result = await this.db.query<[InstanceDiscoveryRegistry[]]>(
			`CREATE instance_discovery_registry SET
				registry_url = $registryUrl,
				created_at = $now`,
			{ registryUrl: clean, now }
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
		return (result[0] ?? []).map((r) => ({ ...r, registry_url: stripApiV1(r.registry_url) }));
	}

	async findById(id: RecordId): Promise<InstanceDiscoveryRegistry | null> {
		const result = await this.db.query<[InstanceDiscoveryRegistry[]]>(
			'SELECT * FROM instance_discovery_registry WHERE id = $id LIMIT 1',
			{ id }
		);
		const row = result[0]?.[0] ?? null;
		return row ? { ...row, registry_url: stripApiV1(row.registry_url) } : null;
	}

	async findByUrl(registryUrl: string): Promise<InstanceDiscoveryRegistry | null> {
		const clean = stripApiV1(registryUrl.trim().replace(/\/$/, ''));
		const withSuffix = `${clean}/api/v1`;
		const result = await this.db.query<[InstanceDiscoveryRegistry[]]>(
			'SELECT * FROM instance_discovery_registry WHERE registry_url = $clean OR registry_url = $withSuffix LIMIT 1',
			{ clean, withSuffix }
		);
		const row = result[0]?.[0] ?? null;
		return row ? { ...row, registry_url: stripApiV1(row.registry_url) } : null;
	}
}

export const instanceDiscoveryRegistryRepository = new InstanceDiscoveryRegistryRepository();
