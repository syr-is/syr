import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { z } from 'zod';
import { userRepository } from '$lib/repositories/user.repository';
import { contentTrustRuleRepository } from '$lib/repositories/content-trust-rule.repository';
import { stringToRecordId } from '@syr-is/types';

const RuleSchema = z.object({
	pattern: z.string().min(1).max(2048),
	kind: z.enum(['allow', 'deny'])
});

const PutSchema = z.object({
	rules: z.array(RuleSchema).max(200),
	content_trust_auto_author_provider: z.boolean().optional(),
	content_trust_allow_data_urls: z.boolean().optional()
});

function assertPatternLooksLikeUrlOrPath(pattern: string): void {
	const t = pattern.trim();
	try {
		new URL(t);
	} catch {
		throw error(400, {
			code: 'VALIDATION_ERROR',
			message: 'Each pattern must be a valid absolute URL (e.g. https://example.com/path)'
		});
	}
}

export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user) {
		throw error(401, { code: 'UNAUTHORIZED', message: 'Unauthorized' });
	}
	const uid = stringToRecordId.decode(locals.user.id);
	const [user, rules] = await Promise.all([
		userRepository.findById(locals.user.id),
		contentTrustRuleRepository.findByUserId(uid)
	]);
	if (!user) throw error(404, { code: 'NOT_FOUND', message: 'User not found' });
	return json({
		status: 'success',
		data: {
			rules: rules.map((r) => ({
				id: String(r.id),
				pattern: r.pattern,
				kind: r.kind,
				sort_order: r.sort_order
			})),
			content_trust_auto_author_provider: user.content_trust_auto_author_provider ?? false,
			content_trust_allow_data_urls: user.content_trust_allow_data_urls ?? false
		}
	});
};

export const PUT: RequestHandler = async ({ locals, request }) => {
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
	const parsed = PutSchema.safeParse(body);
	if (!parsed.success) {
		throw error(400, {
			code: 'VALIDATION_ERROR',
			message: 'Invalid body',
			details: z.treeifyError(parsed.error)
		});
	}
	for (const r of parsed.data.rules) {
		assertPatternLooksLikeUrlOrPath(r.pattern);
	}
	const uid = stringToRecordId.decode(locals.user.id);
	const mergePatch: {
		updated_at: Date;
		content_trust_auto_author_provider?: boolean;
		content_trust_allow_data_urls?: boolean;
	} = { updated_at: new Date() };
	if (parsed.data.content_trust_auto_author_provider !== undefined) {
		mergePatch.content_trust_auto_author_provider = parsed.data.content_trust_auto_author_provider;
	}
	if (parsed.data.content_trust_allow_data_urls !== undefined) {
		mergePatch.content_trust_allow_data_urls = parsed.data.content_trust_allow_data_urls;
	}
	const updated = await userRepository.merge(uid, mergePatch);
	if (!updated) throw error(404, { code: 'NOT_FOUND', message: 'User not found' });
	await contentTrustRuleRepository.replaceAllForUser(uid, parsed.data.rules);
	const rules = await contentTrustRuleRepository.findByUserId(uid);
	return json({
		status: 'success',
		data: {
			rules: rules.map((r) => ({
				id: String(r.id),
				pattern: r.pattern,
				kind: r.kind,
				sort_order: r.sort_order
			})),
			content_trust_auto_author_provider: updated.content_trust_auto_author_provider ?? false,
			content_trust_allow_data_urls: updated.content_trust_allow_data_urls ?? false
		}
	});
};
