import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { IdentityRotateRequestSchema } from '@syr-is/types';
import { rotationController } from '$lib/controllers/rotation.controller';

/**
 * POST /api/identity/rotate
 *
 * Rotate the authenticated user's root key (own DID only). The DID never
 * changes; a signed rotation statement is appended to the per-DID chain.
 *
 * Modes:
 * - { mode: "aegis", password } — custodial: the server verifies the
 *   password, decrypts the Aegis seed, generates the new root, signs the
 *   statement with the OLD key, re-wraps the new seed under Aegis, re-signs
 *   active delegations, and enqueues registry re-sync jobs.
 * - { mode: "external", statement } — self-custody: a fully-formed signed
 *   statement (e.g. from Syner) is validated against the stored chain and
 *   persisted; no server-side key material is involved.
 */
export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) {
		throw error(401, { code: 'AUTHENTICATION_ERROR', message: 'Authentication required' });
	}

	let parsedBody: unknown;
	try {
		parsedBody = await request.json();
	} catch (err) {
		throw error(400, {
			code: 'VALIDATION_ERROR',
			message: 'Invalid JSON body',
			details: { parseError: err instanceof Error ? err.message : 'Failed to parse JSON' }
		});
	}

	const parsed = IdentityRotateRequestSchema.safeParse(parsedBody);
	if (!parsed.success) {
		throw error(400, {
			code: 'VALIDATION_ERROR',
			message: 'Invalid request body',
			details: JSON.parse(JSON.stringify(parsed.error.issues))
		});
	}

	try {
		const result =
			parsed.data.mode === 'aegis'
				? await rotationController.rotateWithAegis(locals.user.id, parsed.data.password)
				: await rotationController.rotateExternal(locals.user.id, parsed.data.statement);

		return json({
			status: 'success',
			data: result,
			meta: { timestamp: new Date().toISOString() }
		});
	} catch (err) {
		if (err && typeof err === 'object' && 'status' in err) throw err;
		const message = err instanceof Error ? err.message : 'Rotation failed';
		const lower = message.toLowerCase();

		if (lower.includes('no identity')) {
			throw error(404, { code: 'NO_IDENTITY', message });
		}
		if (lower.includes('decrypt') || lower.includes('password') || lower.includes('tag')) {
			// Aegis decryption failure = wrong password (never leak more detail)
			throw error(403, { code: 'INVALID_PASSWORD', message: 'Password verification failed' });
		}
		if (
			lower.includes('seq') ||
			lower.includes('prevroot') ||
			lower.includes('rotatedat') ||
			lower.includes('chain') ||
			lower.includes('statement') ||
			lower.includes('aegis') ||
			lower.includes('custodial')
		) {
			throw error(400, { code: 'INVALID_ROTATION', message });
		}

		console.error('[identity/rotate] Rotation failed:', err);
		throw error(500, { code: 'ROTATION_FAILED', message: 'Rotation failed' });
	}
};
