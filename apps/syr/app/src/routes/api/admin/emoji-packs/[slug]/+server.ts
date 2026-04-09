import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { z } from 'zod';
import { emojiController } from '$lib/controllers/emoji.controller';
import { EmojiPackUpdateSchema } from '@syr-is/types';

export const GET: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) throw error(401, { code: 'UNAUTHORIZED', message: 'Authentication required' });
	if (locals.user.role !== 'ADMIN') throw error(403, { code: 'FORBIDDEN', message: 'Admin only' });

	const pack = await emojiController.getPackBySlug(params.slug);
	if (!pack) throw error(404, { code: 'NOT_FOUND', message: 'Pack not found' });

	return json({
		status: 'success',
		data: { ...pack, id: pack.id.toString(), created_by: pack.created_by.toString() }
	});
};

export const PATCH: RequestHandler = async ({ params, request, locals }) => {
	if (!locals.user) throw error(401, { code: 'UNAUTHORIZED', message: 'Authentication required' });
	if (locals.user.role !== 'ADMIN') throw error(403, { code: 'FORBIDDEN', message: 'Admin only' });

	const pack = await emojiController.getPackBySlug(params.slug);
	if (!pack) throw error(404, { code: 'NOT_FOUND', message: 'Pack not found' });

	try {
		const parsed = EmojiPackUpdateSchema.parse(await request.json());
		const result = await emojiController.updatePack(pack.id, parsed);
		return json({
			status: 'success',
			data: { ...result, id: result.id.toString(), created_by: result.created_by.toString() }
		});
	} catch (err) {
		if (err instanceof z.ZodError)
			throw error(400, {
				code: 'VALIDATION_ERROR',
				message: 'Invalid data',
				details: z.treeifyError(err)
			});
		if (err && typeof err === 'object' && 'status' in err) throw err;
		throw error(500, { code: 'INTERNAL_SERVER_ERROR', message: 'Failed to update pack' });
	}
};

export const DELETE: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) throw error(401, { code: 'UNAUTHORIZED', message: 'Authentication required' });
	if (locals.user.role !== 'ADMIN') throw error(403, { code: 'FORBIDDEN', message: 'Admin only' });

	const pack = await emojiController.getPackBySlug(params.slug);
	if (!pack) throw error(404, { code: 'NOT_FOUND', message: 'Pack not found' });

	await emojiController.deletePack(pack.id);
	return json({ status: 'success', message: 'Pack deleted' });
};
