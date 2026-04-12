import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { z } from 'zod';
import { userRepository } from '$lib/repositories/user.repository';
import { uploadRepository } from '$lib/repositories/upload.repository';
import { uploadController } from '$lib/controllers/upload.controller';
import { recordIdFromDidAndLocal } from '@syr-is/types';

const PatchSchema = z.object({
	/** Remove from story feed (keeps file in place, does NOT change is_public) */
	unpublish: z.boolean().optional(),
	/** Re-add to story feed with fresh published_at */
	republish: z.boolean().optional(),
	/** Separate control: toggle file visibility (move in/out of public access) */
	set_private: z.boolean().optional()
});

/**
 * PATCH /api/stories/[did]/[id]
 *
 * - unpublish: sets is_story=false. File stays public/private as-is.
 * - republish: sets is_story=true, published_at=now, is_public=true.
 * - set_private: toggles is_public independently of story status.
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
	const isLegacy = !upload.is_story && upload.key && upload.key.includes('/stories/');
	if (!upload.is_story && !isLegacy) {
		throw error(400, { code: 'BAD_REQUEST', message: 'Upload is not a story' });
	}

	const patch: Record<string, unknown> = { updated_at: new Date() };

	if (parsed.data.unpublish) {
		patch.is_story = false;
	}
	if (parsed.data.republish) {
		patch.is_story = true;
		patch.is_public = true;
		patch.published_at = new Date();
	}

	// Handle privacy toggle via S3 key move (public/ ↔ private/)
	if (parsed.data.set_private !== undefined) {
		const moved = await uploadController.toggleStoryPrivacy(
			uploadId,
			user.id,
			parsed.data.set_private
		);
		// If we also have unpublish/republish, apply those on top
		if (Object.keys(patch).length > 1) {
			const updated = await uploadRepository.update(uploadId, patch);
			return json({
				status: 'success',
				data: updated,
				meta: { timestamp: new Date().toISOString() }
			});
		}
		return json({ status: 'success', data: moved, meta: { timestamp: new Date().toISOString() } });
	}

	const updated = await uploadRepository.update(uploadId, patch);

	return json({
		status: 'success',
		data: updated,
		meta: { timestamp: new Date().toISOString() }
	});
};
