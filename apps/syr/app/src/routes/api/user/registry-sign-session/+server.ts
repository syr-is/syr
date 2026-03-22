import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createRegistrySignSession } from '$lib/server/export-verify-store';
import { config } from '$lib/config';
import { getIdentityContext } from '$lib/server/identity-context';
import { outboxRepository } from '$lib/repositories/outbox.repository';
import { stringToRecordId } from '@syr-is/types';
import { z } from 'zod';
import { initCryptoWasm } from '@syr-is/crypto';
import {
	canonicalStringForDirectoryUpsert,
	canonicalStringForRegistryDelete,
	canonicalStringForRegistryUpdate
} from '$lib/server/registry-job-crypto';

const BodySchema = z.object({
	jobId: z.string().min(1)
});

/**
 * POST /api/user/registry-sign-session
 * Claim one pending registry job and start a Syner signing session (root key only).
 */
export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) {
		throw error(401, { code: 'AUTHENTICATION_ERROR', message: 'Authentication required' });
	}

	const did = locals.user.did?.trim();
	if (!did || !did.startsWith('did:syr:')) {
		throw error(400, {
			code: 'BAD_REQUEST',
			message: 'Your account needs a DID before signing with Syner.'
		});
	}

	const ctx = await getIdentityContext(locals.user.id, locals);
	const rootPk = ctx.identity?.public_key?.trim();
	if (!rootPk) {
		throw error(400, {
			code: 'NO_IDENTITY',
			message: 'No identity public key on record.'
		});
	}

	let body: unknown;
	try {
		body = await request.json();
	} catch {
		throw error(400, { code: 'VALIDATION_ERROR', message: 'Invalid JSON' });
	}
	const parsed = BodySchema.safeParse(body);
	if (!parsed.success) {
		throw error(400, {
			code: 'VALIDATION_ERROR',
			message: 'jobId is required',
			details: parsed.error.flatten()
		});
	}

	const userId = stringToRecordId.decode(locals.user.id);
	const job = await outboxRepository.findActiveByIdAndUser(parsed.data.jobId, userId);
	if (!job || job.type !== 'registry_sync') {
		throw error(404, { code: 'NOT_FOUND', message: 'Registry job not found' });
	}
	if (job.status !== 'pending') {
		throw error(409, {
			code: 'CONFLICT',
			message: 'Job is not pending (already processing or finished). Retry from SYR if stuck.'
		});
	}

	const jp = (job.payload ?? {}) as {
		action?: string;
		did?: string;
		registryUrl?: string;
		provider?: string;
	};
	if (!jp.did || !jp.registryUrl || !jp.action || jp.did !== did) {
		throw error(400, { code: 'VALIDATION_ERROR', message: 'Invalid job payload' });
	}

	const claimed = await outboxRepository.claimIfPending(job.id, userId);
	if (!claimed) {
		throw error(409, { code: 'CONFLICT', message: 'Could not claim job' });
	}

	await initCryptoWasm();

	let sign_object: Record<string, unknown>;
	let canonical_payload: string;
	let directory_sign_object: Record<string, unknown>;
	let directory_canonical_payload: string;
	let updated_at: string | undefined;
	let deleted_at: string | undefined;

	const username = locals.user.username;
	const displayName =
		locals.user.profile?.display_name?.trim() && locals.user.profile.display_name.trim().length > 0
			? locals.user.profile.display_name.trim()
			: username;

	try {
		if (jp.action === 'update') {
			if (!jp.provider) throw new Error('Missing provider');
			updated_at = new Date().toISOString();
			sign_object = { did: jp.did, provider: jp.provider, updatedAt: updated_at };
			canonical_payload = canonicalStringForRegistryUpdate({
				did: jp.did,
				provider: jp.provider,
				updatedAt: updated_at
			});
			directory_sign_object = {
				did: jp.did,
				provider: jp.provider,
				username,
				displayName,
				listed: true,
				updatedAt: updated_at
			};
			directory_canonical_payload = canonicalStringForDirectoryUpsert({
				did: jp.did,
				provider: jp.provider,
				username,
				displayName,
				listed: true,
				updatedAt: updated_at
			});
		} else if (jp.action === 'delete') {
			if (!jp.provider) throw new Error('Missing provider');
			deleted_at = new Date().toISOString();
			sign_object = { did: jp.did, deletedAt: deleted_at };
			canonical_payload = canonicalStringForRegistryDelete({ did: jp.did, deletedAt: deleted_at });
			directory_sign_object = {
				did: jp.did,
				provider: jp.provider,
				username,
				displayName,
				listed: false,
				updatedAt: deleted_at
			};
			directory_canonical_payload = canonicalStringForDirectoryUpsert({
				did: jp.did,
				provider: jp.provider,
				username,
				displayName,
				listed: false,
				updatedAt: deleted_at
			});
		} else {
			throw new Error('Unknown action');
		}

		const sessionId = await createRegistrySignSession({
			user_id: locals.user.id,
			expected_did: did,
			requested_device_public_key: rootPk,
			job_thing_id: String(job.id),
			action: jp.action as 'update' | 'delete',
			did: jp.did,
			registry_url: jp.registryUrl,
			provider: jp.provider,
			updated_at,
			deleted_at,
			sign_object,
			canonical_payload,
			directory_sign_object,
			directory_canonical_payload
		});

		const origin = config.PUBLIC_URL.replace(/\/$/, '');
		const deeplinkUrl =
			`syr://registry-sign?origin=${encodeURIComponent(origin)}` +
			`&session=${encodeURIComponent(sessionId)}` +
			`&did=${encodeURIComponent(did)}`;

		return json({
			status: 'success',
			data: {
				session_id: sessionId,
				deeplink_url: deeplinkUrl,
				expires_in_sec: 300,
				requested_device_public_key: rootPk
			},
			meta: { timestamp: new Date().toISOString() }
		});
	} catch (e) {
		try {
			await outboxRepository.retry(job.id);
		} catch (re) {
			console.error('[registry-sign-session] retry after failure:', re);
		}
		const msg = e instanceof Error ? e.message : 'Session creation failed';
		throw error(500, { code: 'INTERNAL_ERROR', message: msg });
	}
};
