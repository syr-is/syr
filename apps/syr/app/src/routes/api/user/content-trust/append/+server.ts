import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { z } from 'zod';
import {
	contentTrustRuleRepository,
	ContentTrustRuleLimitExceededError
} from '$lib/repositories/content-trust-rule.repository';
import { stringToRecordId } from '@syr-is/types';
import { assertContentTrustPatternUrl } from '$lib/server/content-trust-pattern';

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
	const canonicalPattern = assertContentTrustPatternUrl(parsed.data.pattern);
	const uid = stringToRecordId.decode(locals.user.id);
	try {
		await contentTrustRuleRepository.appendRuleWithLimit(uid, canonicalPattern, parsed.data.kind);
	} catch (e) {
		if (e instanceof ContentTrustRuleLimitExceededError) {
			throw error(422, {
				code: 'VALIDATION_ERROR',
				message: e.message
			});
		}
		throw e;
	}
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
