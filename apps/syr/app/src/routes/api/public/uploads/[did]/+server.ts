import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { isValidSyrDid } from '@syr-is/did';
import { uploadRepository } from '$lib/repositories/upload.repository';
import { extractDid, extractLocalId } from '@syr-is/types';

/**
 * Paginated public uploads for a DID (is_public, completed, with URL).
 */
export const GET: RequestHandler = async ({ params, url }) => {
	let did: string;
	try {
		did = decodeURIComponent(params.did);
	} catch {
		throw error(400, { code: 'BAD_REQUEST', message: 'Invalid DID' });
	}
	if (!isValidSyrDid(did)) {
		throw error(400, { code: 'BAD_REQUEST', message: 'Invalid DID' });
	}
	const limitRaw = url.searchParams.get('limit');
	const limitParsed = limitRaw !== null ? parseInt(limitRaw, 10) : NaN;
	const limitDefault = Number.isNaN(limitParsed) ? 24 : limitParsed;
	const limit = Math.min(100, Math.max(1, limitDefault));
	const offset = Math.max(0, parseInt(url.searchParams.get('offset') ?? '0', 10) || 0);

	const [total, { uploads }] = await Promise.all([
		uploadRepository.countPublicByDid(did),
		uploadRepository.findPublicByDidPage(did, { limit, offset })
	]);

	const data = uploads.map((u) => ({
		id: u.id.toString(),
		did: extractDid(u.id),
		local_id: extractLocalId(u.id),
		owner_id: u.owner_id.toString(),
		folder_id: u.folder_id != null ? u.folder_id.toString() : null,
		filename: u.filename,
		mime_type: u.mime_type,
		size: u.size,
		url: u.url,
		status: u.status,
		is_public: u.is_public,
		created_at: u.created_at.toISOString(),
		updated_at: u.updated_at.toISOString()
	}));

	return json({
		status: 'success',
		data,
		pagination: { limit, offset, total, has_more: offset + uploads.length < total }
	});
};
