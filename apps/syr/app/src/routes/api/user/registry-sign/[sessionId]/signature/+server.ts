import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	completeRegistrySignSessionFailed,
	completeRegistrySignSessionSuccess,
	getRegistrySignSession
} from '$lib/server/export-verify-store';
import { initCryptoWasm, canonicalize } from '@syr-is/crypto';
import { identityRepository } from '$lib/repositories/identity.repository';
import { outboxRepository } from '$lib/repositories/outbox.repository';
import { stringToRecordId } from '@syr-is/types';
import { z } from 'zod';
import { verifyRegistryRootSignature } from '$lib/server/registry-job-crypto';
import { pushSignedRegistryJobToRemoteAndComplete } from '$lib/server/registry-job-runner';

const BodySchema = z.object({
	signature: z.string().min(1),
	directory_signature: z.string().min(1),
	device_public_key: z.string().min(1)
});

/**
 * PUT /api/user/registry-sign/[sessionId]/signature
 * Syner uploads signature (no cookie).
 */
export const PUT: RequestHandler = async ({ request, params }) => {
	const sessionId = params.sessionId?.trim();
	if (!sessionId) {
		throw error(400, { code: 'BAD_REQUEST', message: 'Missing session' });
	}

	const session = await getRegistrySignSession(sessionId);
	if (!session || session.status !== 'pending') {
		throw error(404, {
			code: 'NOT_FOUND',
			message: 'Session not found, expired, or already completed'
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
			message: 'Invalid body',
			details: parsed.error.flatten()
		});
	}

	const { signature, directory_signature, device_public_key } = parsed.data;
	if (device_public_key !== session.requested_device_public_key) {
		await failSessionAndRetryJob(sessionId, session, 'device_public_key mismatch');
		throw error(400, {
			code: 'INVALID_SIGNATURE',
			message: 'device_public_key does not match this signing session.'
		});
	}

	await initCryptoWasm();
	const recomputed = canonicalize(session.sign_object);
	if (recomputed !== session.canonical_payload) {
		await failSessionAndRetryJob(sessionId, session, 'Session canonical mismatch');
		throw error(500, {
			code: 'INTERNAL_ERROR',
			message: 'Session canonical mismatch'
		});
	}

	const recomputedDir = canonicalize(session.directory_sign_object);
	if (recomputedDir !== session.directory_canonical_payload) {
		await failSessionAndRetryJob(sessionId, session, 'Session directory canonical mismatch');
		throw error(500, {
			code: 'INTERNAL_ERROR',
			message: 'Session directory canonical mismatch'
		});
	}

	const identity = await identityRepository.findByDid(session.expected_did);
	const rootPk = identity?.public_key?.trim();
	const reqPk = session.requested_device_public_key.trim();
	if (!identity || !rootPk || rootPk !== reqPk) {
		await failSessionAndRetryJob(sessionId, session, 'Identity mismatch');
		throw error(400, { code: 'FORBIDDEN', message: 'Identity mismatch' });
	}

	const valid = await verifyRegistryRootSignature(
		session.canonical_payload,
		signature,
		device_public_key
	);
	if (!valid) {
		await failSessionAndRetryJob(sessionId, session, 'Invalid signature');
		throw error(400, { code: 'INVALID_SIGNATURE', message: 'Signature verification failed' });
	}

	const dirValid = await verifyRegistryRootSignature(
		session.directory_canonical_payload,
		directory_signature,
		device_public_key
	);
	if (!dirValid) {
		await failSessionAndRetryJob(sessionId, session, 'Invalid directory signature');
		throw error(400, {
			code: 'INVALID_SIGNATURE',
			message: 'Directory signature verification failed'
		});
	}

	const userId = stringToRecordId.decode(session.user_id);
	const job = await outboxRepository.findActiveByIdAndUser(session.job_thing_id, userId);
	if (!job) {
		await failSessionAndRetryJob(sessionId, session, 'Job not found');
		throw error(404, { code: 'NOT_FOUND', message: 'Job not found' });
	}

	const jp = job.payload as {
		action?: string;
		did?: string;
		registryUrl?: string;
		provider?: string;
	};
	if (
		jp.did !== session.did ||
		jp.registryUrl !== session.registry_url ||
		jp.action !== session.action ||
		(session.action === 'update' && jp.provider !== session.provider)
	) {
		await failSessionAndRetryJob(sessionId, session, 'Job payload mismatch');
		throw error(400, { code: 'PAYLOAD_MISMATCH', message: 'Job no longer matches session' });
	}

	const dso = session.directory_sign_object;
	const directory = {
		username: String(dso.username),
		displayName: String(dso.displayName),
		listed: Boolean(dso.listed),
		updatedAt: String(dso.updatedAt),
		signature: directory_signature
	};

	try {
		await pushSignedRegistryJobToRemoteAndComplete({
			job,
			action: session.action,
			did: session.did,
			registryUrl: session.registry_url,
			jobPayload: jp,
			providerForUpdate: session.provider,
			updatedAt: session.updated_at,
			deletedAt: session.deleted_at,
			signature,
			directory
		});
	} catch (e) {
		const msg = e instanceof Error ? e.message : 'Registry request failed';
		await completeRegistrySignSessionFailed(sessionId, msg);
		throw e;
	}

	await completeRegistrySignSessionSuccess(sessionId);

	return json({
		status: 'success',
		data: { ok: true },
		meta: { timestamp: new Date().toISOString() }
	});
};

async function failSessionAndRetryJob(
	sessionId: string,
	session: NonNullable<Awaited<ReturnType<typeof getRegistrySignSession>>>,
	reason = 'Signing failed'
): Promise<void> {
	try {
		const userId = stringToRecordId.decode(session.user_id);
		const job = await outboxRepository.findActiveByIdAndUser(session.job_thing_id, userId);
		if (job) {
			await outboxRepository.retry(job.id);
		}
	} catch (re) {
		console.error('[registry-sign signature] retry job:', re);
	}
	await completeRegistrySignSessionFailed(sessionId, reason);
}
