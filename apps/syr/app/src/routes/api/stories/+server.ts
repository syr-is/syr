import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { z } from 'zod';
import { userRepository } from '$lib/repositories/user.repository';
import { uploadRepository } from '$lib/repositories/upload.repository';
import { recordIdFromDidAndLocal, extractDid, extractLocalId } from '@syr-is/types';

/**
 * GET /api/stories
 *
 * Returns every story owned by the current user — active (within 24h window
 * + is_public), expired, and unpublished. UI classifies them client-side.
 */
export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user) throw error(401, { code: 'UNAUTHORIZED', message: 'Authentication required' });

	const user = await userRepository.findById(locals.user.id);
	if (!user?.did) throw error(400, { code: 'BAD_REQUEST', message: 'User has no DID' });

	const uploads = await uploadRepository.findAllStoriesByDid(user.did);

	// Expose composite-ID fields so the UI can build /api/stories/[did]/[id] URLs
	const serialized = uploads.map((u) => ({
		...u,
		did: extractDid(u.id),
		local_id: extractLocalId(u.id)
	}));

	return json({
		status: 'success',
		data: serialized,
		meta: { timestamp: new Date().toISOString() }
	});
};

const AddStorySchema = z.object({
	did: z.string().min(1),
	local_id: z.string().min(1)
});

/**
 * POST /api/stories  {did, local_id}
 *
 * Flag an existing upload owned by the current user as a story — sets
 * is_story=true, is_public=true, and published_at=now so it enters the
 * 24-hour public window.
 */
export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) throw error(401, { code: 'UNAUTHORIZED', message: 'Authentication required' });

	const user = await userRepository.findById(locals.user.id);
	if (!user?.did) throw error(400, { code: 'BAD_REQUEST', message: 'User has no DID' });

	let body: unknown;
	try {
		body = await request.json();
	} catch {
		throw error(400, { code: 'BAD_REQUEST', message: 'Invalid JSON' });
	}

	const parsed = AddStorySchema.safeParse(body);
	if (!parsed.success) {
		throw error(400, { code: 'VALIDATION_ERROR', message: 'Missing did or local_id' });
	}
	const uploadId = recordIdFromDidAndLocal('upload', parsed.data.did, parsed.data.local_id);
	const upload = await uploadRepository.findById(uploadId);
	if (!upload) throw error(404, { code: 'NOT_FOUND', message: 'Upload not found' });
	if (upload.owner_id.toString() !== user.id.toString()) {
		throw error(403, { code: 'FORBIDDEN', message: 'You do not own this upload' });
	}
	if (upload.status !== 'completed') {
		throw error(400, { code: 'BAD_REQUEST', message: 'Upload must be completed first' });
	}
	if (upload.is_story) {
		throw error(400, {
			code: 'ALREADY_STORY',
			message: 'This upload is already a story. Use PATCH to republish.'
		});
	}

	const updated = await uploadRepository.update(uploadId, {
		is_story: true,
		is_public: true,
		published_at: new Date(),
		updated_at: new Date()
	});

	return json({
		status: 'success',
		data: updated,
		meta: { timestamp: new Date().toISOString() }
	});
};
