import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { gifController } from '$lib/controllers/gif.controller';
import { extractDid, extractLocalId } from '@syr-is/types';

export const GET: RequestHandler = async ({ url }) => {
	const search = url.searchParams.get('search') ?? undefined;
	const limit = Math.min(
		100,
		Math.max(1, parseInt(url.searchParams.get('limit') ?? '20', 10) || 20)
	);
	const offset = Math.max(0, parseInt(url.searchParams.get('offset') ?? '0', 10) || 0);

	const { data, total } = await gifController.getInstanceGifs({ search, limit, offset });

	const serialized = data.map((g) => ({
		did: extractDid(g.id),
		local_id: extractLocalId(g.id),
		url: g.url,
		thumbnail_url: g.thumbnail_url ?? null,
		tags: g.tags,
		size: g.size
	}));

	return json({
		status: 'success',
		data: serialized,
		pagination: { limit, offset, total, has_more: offset + data.length < total }
	});
};
