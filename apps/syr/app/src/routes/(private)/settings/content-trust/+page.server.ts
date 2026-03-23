import type { PageServerLoad } from './$types';
import { redirect } from '@sveltejs/kit';
import { userRepository } from '$lib/repositories/user.repository';
import { contentTrustRuleRepository } from '$lib/repositories/content-trust-rule.repository';
import { stringToRecordId } from '@syr-is/types';
import { effectiveMaxPostPayloadBytes } from '$lib/client/content-limit-config';

export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.user) {
		throw redirect(302, '/login');
	}
	const uid = stringToRecordId.decode(locals.user.id);
	const [user, rules] = await Promise.all([
		userRepository.findById(locals.user.id),
		contentTrustRuleRepository.findByUserId(uid)
	]);
	if (!user) {
		throw redirect(302, '/login');
	}
	return {
		rules: rules.map((r) => ({
			id: String(r.id),
			pattern: r.pattern,
			kind: r.kind,
			sort_order: r.sort_order
		})),
		content_trust_auto_author_provider: user.content_trust_auto_author_provider ?? false,
		content_trust_allow_data_urls: user.content_trust_allow_data_urls ?? false,
		stored_content_max_post_bytes: user.content_max_post_bytes ?? null,
		effective_max_post_payload_bytes: effectiveMaxPostPayloadBytes(
			user.content_max_post_bytes ?? undefined
		)
	};
};
