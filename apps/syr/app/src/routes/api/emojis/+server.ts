import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { z } from 'zod';
import { userRepository } from '$lib/repositories/user.repository';
import { emojiController } from '$lib/controllers/emoji.controller';
import { EmojiCreateRequestSchema, extractDid, extractLocalId } from '@syr-is/types';

export const GET: RequestHandler = async ({ url, locals }) => {
	if (!locals.user) throw error(401, { code: 'AUTHENTICATION_ERROR', message: 'Unauthorized' });
	const user = await userRepository.findById(locals.user.id);
	if (!user) throw error(400, { code: 'BAD_REQUEST', message: 'Invalid User' });

	const limit = Math.min(
		100,
		Math.max(1, parseInt(url.searchParams.get('limit') ?? '50', 10) || 50)
	);
	const offset = Math.max(0, parseInt(url.searchParams.get('offset') ?? '0', 10) || 0);

	const { data, total } = await emojiController.getUserEmojis(user.id, { limit, offset });

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

export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) throw error(401, { code: 'AUTHENTICATION_ERROR', message: 'Unauthorized' });
	const user = await userRepository.findById(locals.user.id);
	if (!user) throw error(400, { code: 'BAD_REQUEST', message: 'Invalid User' });
	if (!user.did) throw error(400, { code: 'IDENTITY_REQUIRED', message: 'Identity required' });

	try {
		const parsed = EmojiCreateRequestSchema.parse(await request.json());
		const { emoji_local_id, ...data } = parsed;
		const result = await emojiController.createEmoji(user, data, { localId: emoji_local_id });

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
		throw error(500, { code: 'INTERNAL_SERVER_ERROR', message: 'Failed to create emoji' });
	}
};
