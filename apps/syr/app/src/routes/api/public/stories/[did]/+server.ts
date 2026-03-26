import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { isValidSyrDid } from '@syr-is/did';
import type { Upload } from '@syr-is/types';
import { extractLocalId, PublicStoriesResponseSchema } from '@syr-is/types';
import { uploadRepository } from '$lib/repositories/upload.repository';

const WINDOW_MS = 24 * 60 * 60 * 1000;

function uploadToSlide(u: Upload) {
	const meta = u.metadata as Record<string, unknown> | undefined;
	return {
		id: extractLocalId(u.id),
		mime_type: u.mime_type,
		url: u.url as string,
		published_at: u.updated_at.toISOString(),
		width: typeof meta?.width === 'number' ? meta.width : null,
		height: typeof meta?.height === 'number' ? meta.height : null,
		duration_seconds: typeof meta?.duration_seconds === 'number' ? meta.duration_seconds : null
	};
}

export const GET: RequestHandler = async ({ params }) => {
	const did = decodeURIComponent(params.did);
	if (!isValidSyrDid(did)) {
		throw error(400, { code: 'BAD_REQUEST', message: 'Invalid DID' });
	}

	const since = new Date(Date.now() - WINDOW_MS);
	const uploads = await uploadRepository.findActiveStoriesByDid(did, since);
	const slides = uploads.map(uploadToSlide);

	const payload = { did, slides };
	const parsed = PublicStoriesResponseSchema.safeParse(payload);
	if (!parsed.success) {
		throw error(500, {
			code: 'INTERNAL_ERROR',
			message: 'Story response validation failed'
		});
	}

	return json({
		status: 'success',
		data: parsed.data,
		meta: { timestamp: new Date().toISOString() }
	});
};
