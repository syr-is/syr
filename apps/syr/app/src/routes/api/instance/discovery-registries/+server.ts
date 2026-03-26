import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { instanceDiscoveryRegistryRepository } from '$lib/repositories/instance-discovery-registry.repository';

function requireAdmin(locals: { user?: { role: string } }) {
	if (!locals.user) {
		throw error(401, { code: 'UNAUTHORIZED', message: 'Authentication required' });
	}
	if (locals.user.role !== 'ADMIN') {
		throw error(403, {
			code: 'FORBIDDEN',
			message: 'Only instance administrators can manage instance discovery'
		});
	}
}

/**
 * GET /api/instance/discovery-registries
 * List instance-wide discovery registry URLs (admin only).
 */
export const GET: RequestHandler = async ({ locals }) => {
	requireAdmin(locals);
	const rows = await instanceDiscoveryRegistryRepository.findAll();
	return json({
		status: 'success',
		data: rows.map((r) => ({
			id: r.id.toString(),
			registryUrl: r.registry_url,
			createdAt: r.created_at
		}))
	});
};

/**
 * POST /api/instance/discovery-registries
 * Add an instance discovery registry URL (admin only).
 */
export const POST: RequestHandler = async ({ locals, request }) => {
	requireAdmin(locals);

	let body: unknown;
	try {
		body = await request.json();
	} catch (e) {
		if (e instanceof SyntaxError) {
			throw error(400, { code: 'BAD_REQUEST', message: 'Invalid JSON body' });
		}
		throw e;
	}
	const registryUrl =
		body != null && typeof body === 'object' && 'registryUrl' in body
			? String((body as { registryUrl?: unknown }).registryUrl ?? '').trim()
			: '';

	if (!registryUrl) {
		throw error(400, { code: 'BAD_REQUEST', message: 'registryUrl is required' });
	}

	try {
		new URL(registryUrl);
	} catch {
		throw error(400, { code: 'BAD_REQUEST', message: 'Invalid URL format' });
	}

	const existing = await instanceDiscoveryRegistryRepository.findByUrl(registryUrl);
	if (existing) {
		throw error(409, { code: 'CONFLICT', message: 'Registry already added' });
	}

	const row = await instanceDiscoveryRegistryRepository.add(registryUrl);
	return json({
		status: 'success',
		data: {
			id: row.id.toString(),
			registryUrl: row.registry_url,
			createdAt: row.created_at
		}
	});
};
