import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { verify, canonicalize, decodeMultibase, decodePublicKey } from '@syr-is/crypto';
import { identityRepository } from '$lib/repositories/identity.repository';
import { registryRepository } from '$lib/repositories/registry.repository';
import { outboxRepository } from '$lib/repositories/outbox.repository';
import { stringToRecordId } from '@syr-is/types';
import { z } from 'zod';

const REQUEST_TIMEOUT_MS = 5000;

const RegistrySignSchema = z.object({
	jobId: z.string().min(1),
	action: z.enum(['update', 'delete']),
	did: z.string().min(1),
	registryUrl: z.string().url(),
	provider: z.string().optional(),
	updatedAt: z.string().datetime().optional(),
	deletedAt: z.string().datetime().optional(),
	signature: z.string().min(1)
});

/**
 * POST /api/identity/registry-sign
 *
 * Client signs a pending registry job and submits the signature.
 * Server verifies the signature and sends to the registry.
 */
export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) {
		throw error(401, { code: 'AUTHENTICATION_ERROR', message: 'Authentication required' });
	}

	const parsed = RegistrySignSchema.safeParse(await request.json());
	if (!parsed.success) {
		throw error(400, {
			code: 'VALIDATION_ERROR',
			message: 'Invalid request body',
			details: JSON.parse(JSON.stringify(parsed.error.issues))
		});
	}

	const { jobId, action, did, registryUrl, provider, updatedAt, deletedAt, signature } =
		parsed.data;

	// Verify job belongs to user and is pending
	const userId = stringToRecordId.decode(locals.user.id);
	const allJobs = await outboxRepository.findActiveByUserAndType(userId, 'registry_sync');
	const job = allJobs.find((j) => String(j.id) === jobId);
	if (!job) {
		throw error(404, { code: 'JOB_NOT_FOUND', message: 'Job not found or already completed' });
	}

	const payload = job.payload as {
		action?: string;
		did?: string;
		registryUrl?: string;
		provider?: string;
	};
	if (payload.did !== did || payload.registryUrl !== registryUrl || payload.action !== action) {
		throw error(400, { code: 'PAYLOAD_MISMATCH', message: 'Request does not match job payload' });
	}

	// Verify identity belongs to user
	const identity = await identityRepository.findByDid(did);
	if (!identity || identity.user_id.toString() !== locals.user.id) {
		throw error(403, { code: 'FORBIDDEN', message: 'Identity does not belong to user' });
	}

	// Verify signature
	let canonicalPayload: string;
	if (action === 'update') {
		if (!provider || !updatedAt) {
			throw error(400, {
				code: 'MISSING_FIELDS',
				message: 'update requires provider and updatedAt'
			});
		}
		canonicalPayload = canonicalize({ did, provider, updatedAt });
	} else {
		if (!deletedAt) {
			throw error(400, { code: 'MISSING_FIELDS', message: 'delete requires deletedAt' });
		}
		canonicalPayload = canonicalize({ did, deletedAt });
	}

	const rootKey = decodePublicKey(identity.public_key);
	const signatureBytes = decodeMultibase(signature);
	const valid = await verify(canonicalPayload, signatureBytes, rootKey);
	if (!valid) {
		throw error(400, { code: 'INVALID_SIGNATURE', message: 'Signature verification failed' });
	}

	// Send to registry
	const base = registryUrl.replace(/\/$/, '');
	const signal = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
	try {
		if (action === 'update') {
			const res = await fetch(`${base}/api/v1/update`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ did, provider: provider!, updatedAt, signature }),
				signal
			});
			if (!res.ok) {
				const body = await res.text();
				throw new Error(`Registry update failed (${res.status}): ${body}`);
			}
		} else {
			const res = await fetch(`${base}/api/v1/delete`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ did, deletedAt, signature }),
				signal
			});
			if (!res.ok) {
				const body = await res.text();
				throw new Error(`Registry delete failed (${res.status}): ${body}`);
			}
		}

		if (action === 'update') {
			await registryRepository.updateStatus(did, registryUrl, 'synced');
		} else {
			const registryEntry = await registryRepository.findByDidAndUrl(did, registryUrl);
			if (registryEntry) {
				await registryRepository.removeRegistry(registryEntry.id);
			}
		}
		await outboxRepository.markCompleted(job.id);

		return json({
			status: 'success',
			data: { completed: true },
			meta: { timestamp: new Date().toISOString() }
		});
	} catch (err) {
		const msg =
			err instanceof Error && err.name === 'AbortError'
				? 'Registry request timed out'
				: err instanceof Error
					? err.message
					: 'Registry request failed';
		await outboxRepository.markFailed(job.id, msg, job.attempts + 1, job.max_attempts);
		throw error(502, { code: 'REGISTRY_ERROR', message: msg });
	}
};
