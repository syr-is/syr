import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { z } from 'zod';

const QuerySchema = z.object({
	page: z.coerce.number().int().min(1).default(1),
	size: z.coerce.number().int().default(20),
	search: z.string().default('')
});

export const load: PageServerLoad = async ({ parent, url }) => {
	const { user } = await parent();
	if (user?.role !== 'ADMIN') {
		throw redirect(303, '/settings/profile');
	}

	const parsed = QuerySchema.safeParse({
		page: url.searchParams.get('page') ?? undefined,
		size: url.searchParams.get('size') ?? undefined,
		search: url.searchParams.get('search') ?? undefined
	});

	const { page, size, search } = parsed.success ? parsed.data : { page: 1, size: 20, search: '' };

	return { page, size, search, sizes: [10, 20, 50] };
};
