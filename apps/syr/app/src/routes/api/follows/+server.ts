import { json, error, isHttpError } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { z } from 'zod';
import { followController, FollowValidationError } from '$lib/controllers/follow.controller';
import { userRepository } from '$lib/repositories/user.repository';
import type { UserFollow } from '$lib/repositories/follow.repository';
import { isValidSyrDid } from '@syr-is/did';

const FollowBodySchema = z.object({
	followed_did: z.string().min(12)
});

const PatchFollowProviderSchema = z.object({
	followed_did: z.string().min(12),
	followed_provider_url: z.string().min(1)
});

function followRowToJson(r: UserFollow) {
	return {
		followed_did: r.followed_did,
		source_registry: r.source_registry,
		followed_provider_url: r.followed_provider_url ?? null,
		created_at: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at)
	};
}

export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user) {
		throw error(401, { code: 'AUTHENTICATION_ERROR', message: 'Unauthorized' });
	}
	const rows = await followController.listFollowing(locals.user.id);
	return json({
		status: 'success',
		data: rows.map(followRowToJson)
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
			data: row ? followRowToJson(row) : null
		});
	} catch (e) {
		if (isHttpError(e)) throw e;
		if (e instanceof FollowValidationError) {
			throw error(400, { code: 'VALIDATION_ERROR', message: e.message });
		}
		console.error('follow POST:', e);
		throw error(500, {
			code: 'INTERNAL_SERVER_ERROR',
			message: e instanceof Error ? e.message : 'Follow failed'
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
	try {
		await followController.unfollow(locals.user.id, followed);
	} catch (e) {
		if (isHttpError(e)) throw e;
		console.error('follow DELETE:', e);
		throw error(500, {
			code: 'UNFOLLOW_ERROR',
			message: e instanceof Error ? e.message : 'Unfollow failed'
		});
	}
	return json({ status: 'success' });
};

export const PATCH: RequestHandler = async ({ locals, request }) => {
	if (!locals.user) {
		throw error(401, { code: 'AUTHENTICATION_ERROR', message: 'Unauthorized' });
	}
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		throw error(400, { code: 'BAD_REQUEST', message: 'Invalid JSON' });
	}
	const parsed = PatchFollowProviderSchema.safeParse(body);
	if (!parsed.success) {
		throw error(400, {
			code: 'VALIDATION_ERROR',
			message: 'followed_did and followed_provider_url required',
			details: z.treeifyError(parsed.error)
		});
	}
	if (!isValidSyrDid(parsed.data.followed_did)) {
		throw error(400, { code: 'VALIDATION_ERROR', message: 'Invalid did:syr' });
	}
	try {
		const row = await followController.setFollowProviderUrlManual(
			locals.user.id,
			parsed.data.followed_did,
			parsed.data.followed_provider_url
		);
		return json({ status: 'success', data: followRowToJson(row) });
	} catch (e) {
		if (isHttpError(e)) throw e;
		if (e instanceof FollowValidationError) {
			throw error(400, { code: 'VALIDATION_ERROR', message: e.message });
		}
		console.error('follow PATCH:', e);
		throw error(500, {
			code: 'INTERNAL_SERVER_ERROR',
			message: e instanceof Error ? e.message : 'Update failed'
		});
	}
};
