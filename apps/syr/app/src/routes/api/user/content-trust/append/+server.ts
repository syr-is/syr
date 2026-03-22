import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { z } from 'zod';
import { contentTrustRuleRepository } from '$lib/repositories/content-trust-rule.repository';
import { stringToRecordId } from '@syr-is/types';

const BodySchema = z.object({
	pattern: z.string().min(1).max(2048),
	kind: z.enum(['allow', 'deny'])
});

export const POST: RequestHandler = async ({ locals, request }) => {
	if (!locals.user) {
		throw error(401, { code: 'UNAUTHORIZED', message: 'Unauthorized' });
	}
	let body: unknown;
	try {
		body = await request.json();
	} catch (e) {
		if (e instanceof SyntaxError) {
			throw error(400, { code: 'VALIDATION_ERROR', message: 'Invalid JSON body' });
		}
		throw e;
	}
	const parsed = BodySchema.safeParse(body);
	if (!parsed.success) {
		throw error(400, {
			code: 'VALIDATION_ERROR',
			message: 'Invalid body',
			details: z.treeifyError(parsed.error)
		});
	}
	try {
		new URL(parsed.data.pattern.trim());
	} catch {
		throw error(400, {
			code: 'VALIDATION_ERROR',
			message: 'Pattern must be a valid absolute URL'
		});
	}
	const uid = stringToRecordId.decode(locals.user.id);
	await contentTrustRuleRepository.appendRule(uid, parsed.data.pattern, parsed.data.kind);
	const rules = await contentTrustRuleRepository.findByUserId(uid);
	return json({
		status: 'success',
		data: {
			rules: rules.map((r) => ({
				id: String(r.id),
				pattern: r.pattern,
				kind: r.kind,
				sort_order: r.sort_order
			}))
		}
	});
};
