import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { tenantController } from '$lib/controllers/tenant.controller';
import { TenantCreateSchema } from '@syr-is/types';

/**
 * GET /api/tenants — List all tenants
 */
export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user) {
		throw error(401, { code: 'UNAUTHORIZED', message: 'Authentication required' });
	}

	// Only ADMIN users can manage tenants
	if (locals.user.role !== 'ADMIN') {
		throw error(403, { code: 'FORBIDDEN', message: 'Admin access required' });
	}

	const tenants = await tenantController.listTenants();
	return json({ data: tenants });
};

/**
 * POST /api/tenants — Create a new tenant
 */
export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) {
		throw error(401, { code: 'UNAUTHORIZED', message: 'Authentication required' });
	}

	if (locals.user.role !== 'ADMIN') {
		throw error(403, { code: 'FORBIDDEN', message: 'Admin access required' });
	}

	try {
		const body = await request.json();
		const data = TenantCreateSchema.parse(body);
		const tenant = await tenantController.createTenant(data);
		return json({ data: tenant }, { status: 201 });
	} catch (err) {
		if (err instanceof Error && err.message === 'Tenant slug already exists') {
			throw error(409, { code: 'CONFLICT', message: err.message });
		}
		if (err instanceof Error && err.name === 'ZodError') {
			throw error(400, { code: 'VALIDATION_ERROR', message: 'Invalid tenant data' });
		}
		throw err;
	}
};
