import { BaseRepository } from './base.repository';
import { TenantSchema, type Tenant } from '@syr-is/types';

/**
 * Tenant Repository
 * CRUD operations for the tenant table.
 */
export class TenantRepository extends BaseRepository<Tenant> {
	protected tableName = 'tenant';
	protected schema = TenantSchema;

	/**
	 * Find tenant by slug
	 */
	async findBySlug(slug: string): Promise<Tenant | null> {
		const result = await this.db.query<[Tenant[]]>(
			'SELECT * FROM tenant WHERE slug = $slug LIMIT 1',
			{ slug }
		);
		const record = result[0]?.[0];
		if (!record) return null;
		return this.validate(record);
	}

	/**
	 * Check if a slug is already taken
	 */
	async slugExists(slug: string): Promise<boolean> {
		const result = await this.db.query<[{ count: number }[]]>(
			'SELECT count() AS count FROM tenant WHERE slug = $slug GROUP ALL',
			{ slug }
		);
		return (result[0]?.[0]?.count ?? 0) > 0;
	}

	/**
	 * List all tenants
	 */
	async listAll(): Promise<Tenant[]> {
		const result = await this.db.query<[Tenant[]]>('SELECT * FROM tenant ORDER BY created_at DESC');
		const records = result[0] ?? [];
		return records.map((r) => this.validate(r));
	}
}

// Export singleton instance
export const tenantRepository = new TenantRepository();
