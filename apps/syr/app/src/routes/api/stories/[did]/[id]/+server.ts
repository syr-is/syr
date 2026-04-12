import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { z } from 'zod';
import { userRepository } from '$lib/repositories/user.repository';
import { uploadRepository } from '$lib/repositories/upload.repository';
import { recordIdFromDidAndLocal } from '@syr-is/types';

const PatchSchema = z.object({
	is_public: z.boolean().optional(),
	republish: z.boolean().optional()
});

/**
 * PATCH /api/stories/[did]/[id]  { is_public?: boolean, republish?: boolean }
 *
 * Toggle publish/unpublish on a story. Unpublish = is_public false (hidden
 * from the public 24h feed, file remains). Republish = is_public true +
 * refresh published_at so the story re-enters the window.
 */
export const PATCH: RequestHandler = async ({ params, request, locals }) => {
	if (!locals.user) throw error(401, { code: 'UNAUTHORIZED', message: 'Authentication required' });

	const user = await userRepository.findById(locals.user.id);
	if (!user?.did) throw error(400, { code: 'BAD_REQUEST', message: 'User has no DID' });

	let body: unknown;
	try {
		body = await request.json();
	} catch {
		throw error(400, { code: 'BAD_REQUEST', message: 'Invalid JSON' });
	}
	const parsed = PatchSchema.safeParse(body);
	if (!parsed.success) {
		throw error(400, { code: 'VALIDATION_ERROR', message: 'Invalid body' });
	}

	const uploadId = recordIdFromDidAndLocal('upload', params.did, params.id);
	const upload = await uploadRepository.findById(uploadId);
	if (!upload) throw error(404, { code: 'NOT_FOUND', message: 'Story not found' });
	if (upload.owner_id.toString() !== user.id.toString()) {
		throw error(403, { code: 'FORBIDDEN', message: 'You do not own this story' });
	}
	if (!upload.is_story) {
		throw error(400, { code: 'BAD_REQUEST', message: 'Upload is not a story' });
	}

	const patch: Record<string, unknown> = { updated_at: new Date() };
	if (parsed.data.is_public !== undefined) patch.is_public = parsed.data.is_public;
	if (parsed.data.republish) {
		patch.is_public = true;
		patch.published_at = new Date();
	}

	const updated = await uploadRepository.update(uploadId, patch);

	return json({
		status: 'success',
		data: updated,
		meta: { timestamp: new Date().toISOString() }
	});
};
