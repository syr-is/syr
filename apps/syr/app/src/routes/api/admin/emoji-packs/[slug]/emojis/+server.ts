import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { z } from 'zod';
import { emojiController } from '$lib/controllers/emoji.controller';
import { emojiRepository } from '$lib/repositories/emoji.repository';
import { EmojiCreateRequestSchema, extractDid, extractLocalId } from '@syr-is/types';
import { userRepository } from '$lib/repositories/user.repository';

export const GET: RequestHandler = async ({ params, url, locals }) => {
	if (!locals.user) throw error(401, { code: 'UNAUTHORIZED', message: 'Authentication required' });
	if (locals.user.role !== 'ADMIN') throw error(403, { code: 'FORBIDDEN', message: 'Admin only' });

	const pack = await emojiController.getPackBySlug(params.slug);
	if (!pack) throw error(404, { code: 'NOT_FOUND', message: 'Pack not found' });

	const limit = Math.min(
		200,
		Math.max(1, parseInt(url.searchParams.get('limit') ?? '100', 10) || 100)
	);
	const offset = Math.max(0, parseInt(url.searchParams.get('offset') ?? '0', 10) || 0);

	const { data, total } = await emojiRepository.findByPackSlug(params.slug, { limit, offset });

	const serialized = data.map((e) => ({
		...e,
		id: e.id.toString(),
		did: extractDid(e.id),
		local_id: extractLocalId(e.id),
		author_id: e.author_id.toString()
	}));

	return json({
		status: 'success',
		data: serialized,
		pagination: { limit, offset, total, has_more: offset + data.length < total }
	});
};

export const POST: RequestHandler = async ({ params, request, locals }) => {
	if (!locals.user) throw error(401, { code: 'UNAUTHORIZED', message: 'Authentication required' });
	if (locals.user.role !== 'ADMIN') throw error(403, { code: 'FORBIDDEN', message: 'Admin only' });

	const pack = await emojiController.getPackBySlug(params.slug);
	if (!pack) throw error(404, { code: 'NOT_FOUND', message: 'Pack not found' });

	const user = await userRepository.findById(locals.user.id);
	if (!user || !user.did)
		throw error(400, { code: 'BAD_REQUEST', message: 'Admin must have an identity' });

	try {
		const parsed = EmojiCreateRequestSchema.parse(await request.json());
		const { emoji_local_id, ...data } = parsed;

		const result = await emojiController.createEmoji(
			user,
			{ ...data, scope: 'instance', pack_slug: params.slug },
			{ localId: emoji_local_id }
		);

		return json(
			{
				status: 'success',
				data: {
					...result,
					id: result.id.toString(),
					did: extractDid(result.id),
					local_id: extractLocalId(result.id),
					author_id: result.author_id.toString()
				}
			},
			{ status: 201 }
		);
	} catch (err) {
		if (err instanceof z.ZodError)
			throw error(400, {
				code: 'VALIDATION_ERROR',
				message: 'Invalid emoji data',
				details: z.treeifyError(err)
			});
		if (err && typeof err === 'object' && 'status' in err) throw err;
		throw error(500, { code: 'INTERNAL_SERVER_ERROR', message: 'Failed to add emoji to pack' });
	}
};
