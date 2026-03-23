import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { identityRepository } from '$lib/repositories/identity.repository';
import { outboxRepository } from '$lib/repositories/outbox.repository';
import { stringToRecordId } from '@syr-is/types';
import { z } from 'zod';
import {
	canonicalStringForDirectoryUpsert,
	canonicalStringForRegistryDelete,
	canonicalStringForRegistryUpdate,
	verifyRegistryRootSignature
} from '$lib/server/registry-job-crypto';
import { pushSignedRegistryJobToRemoteAndComplete } from '$lib/server/registry-job-runner';

const RegistrySignSchema = z.object({
	jobId: z.string().min(1),
	action: z.enum(['update', 'delete']),
	did: z.string().min(1),
	registryUrl: z.string().url(),
	provider: z.string().optional(),
	updatedAt: z.string().datetime().optional(),
	deletedAt: z.string().datetime().optional(),
	signature: z.string().min(1),
	directorySignature: z.string().min(1)
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
	const parsed = RegistrySignSchema.safeParse(parsedBody);
	if (!parsed.success) {
		throw error(400, {
			code: 'VALIDATION_ERROR',
			message: 'Invalid request body',
			details: JSON.parse(JSON.stringify(parsed.error.issues))
		});
	}

	const {
		jobId,
		action,
		did,
		registryUrl,
		provider,
		updatedAt,
		deletedAt,
		signature,
		directorySignature
	} = parsed.data;

	const userId = stringToRecordId.decode(locals.user.id);
	const job = await outboxRepository.findActiveByIdAndUser(jobId, userId);
	if (!job) {
		throw error(404, { code: 'JOB_NOT_FOUND', message: 'Job not found or already completed' });
	}

	const claimed = await outboxRepository.claimIfPending(job.id, userId);
	if (!claimed) {
		throw error(404, { code: 'JOB_NOT_FOUND', message: 'Job not found or already completed' });
	}

	let completed = false;
	try {
		const payload = job.payload as {
			action?: string;
			did?: string;
			registryUrl?: string;
			provider?: string;
		};
		if (
			payload.did !== did ||
			payload.registryUrl !== registryUrl ||
			payload.action !== action ||
			(action === 'update' && payload.provider !== provider)
		) {
			throw error(400, { code: 'PAYLOAD_MISMATCH', message: 'Request does not match job payload' });
		}

		const identity = await identityRepository.findByDid(did);
		if (!identity || identity.user_id.toString() !== locals.user.id) {
			throw error(403, { code: 'FORBIDDEN', message: 'Identity does not belong to user' });
		}

		let canonicalPayload: string;
		if (action === 'update') {
			if (!provider || !updatedAt) {
				throw error(400, {
					code: 'MISSING_FIELDS',
					message: 'update requires provider and updatedAt'
				});
			}
			canonicalPayload = canonicalStringForRegistryUpdate({ did, provider, updatedAt });
		} else {
			if (!deletedAt) {
				throw error(400, { code: 'MISSING_FIELDS', message: 'delete requires deletedAt' });
			}
			canonicalPayload = canonicalStringForRegistryDelete({ did, deletedAt });
		}

		const valid = await verifyRegistryRootSignature(
			canonicalPayload,
			signature,
			identity.public_key
		);
		if (!valid) {
			throw error(400, { code: 'INVALID_SIGNATURE', message: 'Signature verification failed' });
		}

		const prov = payload.provider;
		if (!prov) {
			throw error(400, { code: 'MISSING_FIELDS', message: 'Job payload missing provider' });
		}

		const username = locals.user.username;
		const displayName =
			locals.user.profile?.display_name?.trim() &&
			locals.user.profile.display_name.trim().length > 0
				? locals.user.profile.display_name.trim()
				: username;

		let directoryCanonical: string;
		let directoryListing: {
			username: string;
			displayName: string;
			listed: boolean;
			updatedAt: string;
			signature: string;
		};
		if (action === 'update') {
			const updatedAtStr = updatedAt as string;
			directoryCanonical = canonicalStringForDirectoryUpsert({
				did,
				provider: prov,
				username,
				displayName,
				listed: true,
				updatedAt: updatedAtStr
			});
			directoryListing = {
				username,
				displayName,
				listed: true,
				updatedAt: updatedAtStr,
				signature: directorySignature
			};
		} else {
			if (!deletedAt) {
				throw error(400, { code: 'MISSING_FIELDS', message: 'delete requires deletedAt' });
			}
			directoryCanonical = canonicalStringForDirectoryUpsert({
				did,
				provider: prov,
				username,
				displayName,
				listed: false,
				updatedAt: deletedAt
			});
			directoryListing = {
				username,
				displayName,
				listed: false,
				updatedAt: deletedAt,
				signature: directorySignature
			};
		}

		const dirValid = await verifyRegistryRootSignature(
			directoryCanonical,
			directorySignature,
			identity.public_key
		);
		if (!dirValid) {
			throw error(400, {
				code: 'INVALID_SIGNATURE',
				message: 'Directory signature verification failed'
			});
		}

		const pushResult = await pushSignedRegistryJobToRemoteAndComplete({
			job,
			action,
			did,
			registryUrl,
			jobPayload: payload,
			providerForUpdate: provider,
			updatedAt,
			deletedAt,
			signature,
			directory: directoryListing
		});

		completed = true;

		return json({
			status: 'success',
			data: { completed: true, directory_synced: pushResult.directorySyncOk },
			meta: { timestamp: new Date().toISOString() }
		});
	} finally {
		if (!completed) {
			try {
				await outboxRepository.retry(job.id);
			} catch (re) {
				console.error('[registry-sign] failed to release claimed job:', re);
			}
		}
	}
};
