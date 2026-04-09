import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { z } from 'zod';
import { gifController } from '$lib/controllers/gif.controller';
import { GifCreateRequestSchema, extractDid, extractLocalId } from '@syr-is/types';
import { userRepository } from '$lib/repositories/user.repository';

export const GET: RequestHandler = async ({ url, locals }) => {
	if (!locals.user) throw error(401, { code: 'UNAUTHORIZED', message: 'Authentication required' });
	if (locals.user.role !== 'ADMIN') throw error(403, { code: 'FORBIDDEN', message: 'Admin only' });

	const search = url.searchParams.get('search') ?? undefined;
	const limit = Math.min(
		100,
		Math.max(1, parseInt(url.searchParams.get('limit') ?? '20', 10) || 20)
	);
	const offset = Math.max(0, parseInt(url.searchParams.get('offset') ?? '0', 10) || 0);

	const { data, total } = await gifController.getInstanceGifs({ search, limit, offset });

	const serialized = data.map((g) => ({
		...g,
		id: g.id.toString(),
		did: extractDid(g.id),
		local_id: extractLocalId(g.id),
		author_id: g.author_id.toString()
	}));

	return json({
		status: 'success',
		data: serialized,
		pagination: { limit, offset, total, has_more: offset + data.length < total }
	});
};

export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) throw error(401, { code: 'UNAUTHORIZED', message: 'Authentication required' });
	if (locals.user.role !== 'ADMIN') throw error(403, { code: 'FORBIDDEN', message: 'Admin only' });

	const user = await userRepository.findById(locals.user.id);
	if (!user || !user.did)
		throw error(400, { code: 'BAD_REQUEST', message: 'Admin must have an identity' });

	try {
		const parsed = GifCreateRequestSchema.parse(await request.json());
		const { gif_local_id, ...data } = parsed;
		const result = await gifController.createGif(
			user,
			{ ...data, scope: 'instance' },
			{ localId: gif_local_id }
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
				message: 'Invalid GIF data',
				details: z.treeifyError(err)
			});
		if (err && typeof err === 'object' && 'status' in err) throw err;
		throw error(500, { code: 'INTERNAL_SERVER_ERROR', message: 'Failed to create instance GIF' });
	}
};
