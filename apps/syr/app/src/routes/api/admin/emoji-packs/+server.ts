import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { z } from 'zod';
import { emojiController } from '$lib/controllers/emoji.controller';
import { EmojiPackCreateSchema } from '@syr-is/types';

export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user) throw error(401, { code: 'UNAUTHORIZED', message: 'Authentication required' });
	if (locals.user.role !== 'ADMIN') throw error(403, { code: 'FORBIDDEN', message: 'Admin only' });

	const { data } = await emojiController.getPacks();
	const serialized = data.map((p) => ({
		...p,
		id: p.id.toString(),
		created_by: p.created_by.toString()
	}));
	return json({ status: 'success', data: serialized });
};

export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) throw error(401, { code: 'UNAUTHORIZED', message: 'Authentication required' });
	if (locals.user.role !== 'ADMIN') throw error(403, { code: 'FORBIDDEN', message: 'Admin only' });

	try {
		const parsed = EmojiPackCreateSchema.parse(await request.json());
		const user = await (
			await import('$lib/repositories/user.repository')
		).userRepository.findById(locals.user.id);
		if (!user) throw error(400, { code: 'BAD_REQUEST', message: 'Invalid User' });

		const result = await emojiController.createPack(user, parsed);
		return json(
			{
				status: 'success',
				data: { ...result, id: result.id.toString(), created_by: result.created_by.toString() }
			},
			{ status: 201 }
		);
	} catch (err) {
		if (err instanceof z.ZodError)
			throw error(400, {
				code: 'VALIDATION_ERROR',
				message: 'Invalid pack data',
				details: z.treeifyError(err)
			});
		if (err && typeof err === 'object' && 'status' in err) throw err;
		if (err instanceof Error && err.message.includes('already exists'))
			throw error(409, { code: 'CONFLICT', message: err.message });
		throw error(500, { code: 'INTERNAL_SERVER_ERROR', message: 'Failed to create pack' });
	}
};
