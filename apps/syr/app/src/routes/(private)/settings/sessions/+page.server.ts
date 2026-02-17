import type { PageServerLoad } from './$types';
import { z } from 'zod';

const QuerySchema = z.object({
	page: z.coerce.number().int().positive().catch(1),
	size: z.coerce
		.number()
		.int()
		.positive()
		.refine((v) => [5, 10, 20].includes(v), 'size must be 5, 10 or 20')
		.catch(10)
});

export const load: PageServerLoad = async ({ url, locals }) => {
	if (!locals.user) {
		return {};
	}

	const parsed = QuerySchema.safeParse({
		page: url.searchParams.get('page'),
		size: url.searchParams.get('size')
	});

	const { page, size } = parsed.success ? parsed.data : { page: 1, size: 10 };

	return {
		page,
		size,
		sizes: [5, 10, 20]
	};
};
