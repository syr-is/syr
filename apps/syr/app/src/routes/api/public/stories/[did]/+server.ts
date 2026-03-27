import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { isValidSyrDid } from '@syr-is/did';
import type { Upload } from '@syr-is/types';
import { extractLocalId, PublicStoriesResponseSchema } from '@syr-is/types';
import { uploadRepository } from '$lib/repositories/upload.repository';

const WINDOW_MS = 24 * 60 * 60 * 1000;

function metaPositiveInt(v: unknown): number | null {
	if (typeof v !== 'number' || !Number.isFinite(v) || !Number.isInteger(v) || v <= 0) {
		return null;
	}
	return v;
}

function metaDurationSeconds(v: unknown): number | null {
	if (typeof v !== 'number' || !Number.isFinite(v) || !Number.isInteger(v) || v < 0) {
		return null;
	}
	return v;
}

function uploadToSlide(u: Upload) {
	const meta = u.metadata as Record<string, unknown> | undefined;
	const publishedAt =
		u.published_at != null ? u.published_at.toISOString() : u.updated_at.toISOString();
	return {
		id: extractLocalId(u.id),
		mime_type: u.mime_type,
		url: u.url as string,
		published_at: publishedAt,
		width: metaPositiveInt(meta?.width),
		height: metaPositiveInt(meta?.height),
		duration_seconds: metaDurationSeconds(meta?.duration_seconds)
	};
}

export const GET: RequestHandler = async ({ params }) => {
	let did: string;
	try {
		did = decodeURIComponent(params.did);
	} catch {
		throw error(400, { code: 'BAD_REQUEST', message: 'Invalid DID' });
	}
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
