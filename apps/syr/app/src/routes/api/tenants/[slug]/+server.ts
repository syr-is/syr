import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { tenantController } from '$lib/controllers/tenant.controller';
import { TenantUpdateSchema } from '@syr-is/types';

/**
 * GET /api/tenants/[slug] — Get a tenant by slug
 */
export const GET: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) {
		throw error(401, { code: 'UNAUTHORIZED', message: 'Authentication required' });
	}

	const tenant = await tenantController.getTenantBySlug(params.slug);
	if (!tenant) {
		throw error(404, { code: 'NOT_FOUND', message: 'Tenant not found' });
	}

	return json({ data: tenant });
};

/**
 * PATCH /api/tenants/[slug] — Update a tenant
 */
export const PATCH: RequestHandler = async ({ params, request, locals }) => {
	if (!locals.user) {
		throw error(401, { code: 'UNAUTHORIZED', message: 'Authentication required' });
	}

	if (locals.user.role !== 'ADMIN') {
		throw error(403, { code: 'FORBIDDEN', message: 'Admin access required' });
	}

	// Find tenant by slug first
	const tenant = await tenantController.getTenantBySlug(params.slug);
	if (!tenant) {
		throw error(404, { code: 'NOT_FOUND', message: 'Tenant not found' });
	}

	try {
		const body = await request.json();
		const data = TenantUpdateSchema.parse(body);
		const updated = await tenantController.updateTenant(tenant.id.toString(), data);
		return json({ data: updated });
	} catch (err) {
		if (err instanceof Error && err.name === 'ZodError') {
			throw error(400, { code: 'VALIDATION_ERROR', message: 'Invalid tenant data' });
		}
		throw err;
	}
};

/**
 * DELETE /api/tenants/[slug] — Delete a tenant
 */
export const DELETE: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) {
		throw error(401, { code: 'UNAUTHORIZED', message: 'Authentication required' });
	}

	if (locals.user.role !== 'ADMIN') {
		throw error(403, { code: 'FORBIDDEN', message: 'Admin access required' });
	}

	const tenant = await tenantController.getTenantBySlug(params.slug);
	if (!tenant) {
		throw error(404, { code: 'NOT_FOUND', message: 'Tenant not found' });
	}

	await tenantController.deleteTenant(tenant.id.toString());
	return json({ success: true });
};
