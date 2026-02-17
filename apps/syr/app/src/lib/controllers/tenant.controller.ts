import { tenantRepository } from '$lib/repositories/tenant.repository';
import type { TenantCreate, TenantUpdate, Tenant } from '@syr-is/types';

/**
 * Tenant Controller
 * Business logic for multi-tenancy operations.
 */
export class TenantController {
	/**
	 * Create a new tenant
	 */
	async createTenant(data: TenantCreate): Promise<Tenant> {
		// Check if slug is taken
		if (await tenantRepository.slugExists(data.slug)) {
			throw new Error('Tenant slug already exists');
		}

		const now = new Date();
		const tenant = await tenantRepository.create({
			name: data.name,
			slug: data.slug,
			settings: data.settings ?? { max_identities: 100, allow_identity_creation: true },
			created_at: now,
			updated_at: now
		} as Partial<Tenant>);

		return tenant;
	}

	/**
	 * Get a tenant by slug
	 */
	async getTenantBySlug(slug: string): Promise<Tenant | null> {
		return tenantRepository.findBySlug(slug);
	}

	/**
	 * Get a tenant by ID
	 */
	async getTenantById(id: string): Promise<Tenant | null> {
		return tenantRepository.findById(id);
	}

	/**
	 * Update a tenant
	 */
	async updateTenant(id: string, data: TenantUpdate): Promise<Tenant> {
		const existing = await tenantRepository.findById(id);
		if (!existing) {
			throw new Error('Tenant not found');
		}

		const updates: Partial<Tenant> = {
			updated_at: new Date()
		};

		if (data.name !== undefined) {
			updates.name = data.name;
		}

		if (data.settings !== undefined) {
			updates.settings = {
				...existing.settings,
				...data.settings
			} as Tenant['settings'];
		}

		return tenantRepository.update(id, updates);
	}

	/**
	 * List all tenants
	 */
	async listTenants(): Promise<Tenant[]> {
		return tenantRepository.listAll();
	}

	/**
	 * Delete a tenant
	 */
	async deleteTenant(id: string): Promise<void> {
		const existing = await tenantRepository.findById(id);
		if (!existing) {
			throw new Error('Tenant not found');
		}
		await tenantRepository.delete(id);
	}
}

// Export singleton instance
export const tenantController = new TenantController();
