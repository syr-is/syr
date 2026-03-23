import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { initCryptoWasm } from '@syr-is/crypto';
import { outboxRepository } from '$lib/repositories/outbox.repository';
import { stringToRecordId } from '@syr-is/types';
import {
	canonicalStringForDirectoryUpsert,
	canonicalStringForRegistryDelete,
	canonicalStringForRegistryUpdate
} from '$lib/server/registry-job-crypto';

/**
 * GET /api/identity/registry-sign-prep
 *
 * Returns server-generated timestamps and canonical strings for each **pending** registry_sync job.
 * Browser/Syner signs `canonicalPayload` exactly and submits via POST /api/identity/registry-sign.
 */
export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user) {
		throw error(401, { code: 'AUTHENTICATION_ERROR', message: 'Authentication required' });
	}

	await initCryptoWasm();

	const userId = stringToRecordId.decode(locals.user.id);
	const jobs = await outboxRepository.findActiveByUserAndType(userId, 'registry_sync');
	const pending = jobs.filter((j) => j.status === 'pending');

	type PrepRow = {
		jobId: string;
		action: string;
		did: string;
		registryUrl: string;
		provider?: string;
		updatedAt?: string;
		deletedAt?: string;
		signObject: Record<string, unknown>;
		canonicalPayload: string;
		directorySignObject: Record<string, unknown>;
		directoryCanonicalPayload: string;
	};

	const prepped: PrepRow[] = [];
	const accountDid = locals.user.did?.trim() ?? '';
	if (!accountDid.startsWith('did:syr:')) {
		throw error(403, {
			code: 'FORBIDDEN',
			message: 'A verified did:syr identity is required to prepare registry signatures'
		});
	}

	const displayNameForDirectory = (): string => {
		const u = locals.user?.username ?? '';
		const d = locals.user?.profile?.display_name?.trim();
		return d && d.length > 0 ? d : u;
	};

	for (const job of pending) {
		const p = (job.payload ?? {}) as {
			action?: string;
			did?: string;
			registryUrl?: string;
			provider?: string;
		};
		if (p.did && p.did !== accountDid) {
			throw error(403, {
				code: 'FORBIDDEN',
				message: 'Registry job payload DID does not match your account'
			});
		}
		if (!p.did || !p.registryUrl || !p.action) continue;

		if (p.action === 'update') {
			if (!p.provider) continue;
			const updatedAt = new Date().toISOString();
			const signObject = { did: p.did, provider: p.provider, updatedAt };
			const canonicalPayload = canonicalStringForRegistryUpdate({
				did: p.did,
				provider: p.provider,
				updatedAt
			});
			const username = locals.user?.username ?? '';
			const displayName = displayNameForDirectory();
			const directorySignObject = {
				did: p.did,
				provider: p.provider,
				username,
				displayName,
				listed: true,
				updatedAt
			};
			const directoryCanonicalPayload = canonicalStringForDirectoryUpsert({
				did: p.did,
				provider: p.provider,
				username,
				displayName,
				listed: true,
				updatedAt
			});
			prepped.push({
				jobId: String(job.id),
				action: 'update',
				did: p.did,
				registryUrl: p.registryUrl,
				provider: p.provider,
				updatedAt,
				signObject,
				canonicalPayload,
				directorySignObject,
				directoryCanonicalPayload
			});
		} else if (p.action === 'delete') {
			const deletedAt = new Date().toISOString();
			const signObject = { did: p.did, deletedAt };
			const canonicalPayload = canonicalStringForRegistryDelete({ did: p.did, deletedAt });
			if (!p.provider) continue;
			const username = locals.user?.username ?? '';
			const displayName = displayNameForDirectory();
			const directorySignObject = {
				did: p.did,
				provider: p.provider,
				username,
				displayName,
				listed: false,
				updatedAt: deletedAt
			};
			const directoryCanonicalPayload = canonicalStringForDirectoryUpsert({
				did: p.did,
				provider: p.provider,
				username,
				displayName,
				listed: false,
				updatedAt: deletedAt
			});
			prepped.push({
				jobId: String(job.id),
				action: 'delete',
				did: p.did,
				registryUrl: p.registryUrl,
				deletedAt,
				signObject,
				canonicalPayload,
				directorySignObject,
				directoryCanonicalPayload
			});
		}
	}

	return json({
		status: 'success',
		data: { jobs: prepped },
		meta: { timestamp: new Date().toISOString() }
	});
};
