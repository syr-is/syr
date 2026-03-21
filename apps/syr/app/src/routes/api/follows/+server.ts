import { json, error, isHttpError } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { z } from 'zod';
import { userRepository } from '$lib/repositories/user.repository';
import { followController } from '$lib/controllers/follow.controller';
import { isValidSyrDid } from '@syr-is/did';

const FollowBodySchema = z.object({
	followed_did: z.string().min(12)
});

export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user) {
		throw error(401, { code: 'AUTHENTICATION_ERROR', message: 'Unauthorized' });
	}
	const user = await userRepository.findById(locals.user.id);
	if (!user?.did) {
		throw error(400, { code: 'IDENTITY_REQUIRED', message: 'Identity required to list follows' });
	}
	const rows = await followController.listFollowing(locals.user.id);
	return json({
		status: 'success',
		data: rows.map((r) => ({
			followed_did: r.followed_did,
			source_registry: r.source_registry,
			created_at: r.created_at
		}))
	});
};

export const POST: RequestHandler = async ({ locals, request }) => {
	if (!locals.user) {
		throw error(401, { code: 'AUTHENTICATION_ERROR', message: 'Unauthorized' });
	}
	const user = await userRepository.findById(locals.user.id);
	if (!user?.did) {
		throw error(400, { code: 'IDENTITY_REQUIRED', message: 'Identity required to follow' });
	}
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		throw error(400, { code: 'BAD_REQUEST', message: 'Invalid JSON' });
	}
	const parsed = FollowBodySchema.safeParse(body);
	if (!parsed.success) {
		throw error(400, {
			code: 'VALIDATION_ERROR',
			message: 'followed_did required',
			details: z.treeifyError(parsed.error)
		});
	}
	if (!isValidSyrDid(parsed.data.followed_did)) {
		throw error(400, { code: 'VALIDATION_ERROR', message: 'Invalid did:syr' });
	}
	try {
		const row = await followController.follow(locals.user.id, user.did, parsed.data.followed_did);
		return json({
			status: 'success',
			data: row
				? {
						followed_did: row.followed_did,
						source_registry: row.source_registry,
						created_at: row.created_at
					}
				: null
		});
	} catch (e) {
		if (isHttpError(e)) throw e;
		const msg = e instanceof Error ? e.message : 'Follow failed';
		const clientFacing =
			msg.includes('Add at least one identity registry') ||
			msg.includes('not listed on any of your configured registries') ||
			msg.startsWith('registryApiRoot:');
		throw error(clientFacing ? 400 : 500, {
			code: clientFacing ? 'BAD_REQUEST' : 'INTERNAL_SERVER_ERROR',
			message: msg
		});
	}
};

export const DELETE: RequestHandler = async ({ locals, url }) => {
	if (!locals.user) {
		throw error(401, { code: 'AUTHENTICATION_ERROR', message: 'Unauthorized' });
	}
	const followed = url.searchParams.get('followed_did');
	if (!followed || !isValidSyrDid(followed)) {
		throw error(400, { code: 'VALIDATION_ERROR', message: 'followed_did query required' });
	}
	await followController.unfollow(locals.user.id, followed);
	return json({ status: 'success' });
};
