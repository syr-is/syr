import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { uploadRepository } from '$lib/repositories/upload.repository';
import { uploadController } from '$lib/controllers/upload.controller';

/**
 * POST /api/webhooks/storage
 *
 * Called by SeaweedFS filer notification webhook when a file is created.
 * Auto-finalizes pending uploads so the client doesn't need to PATCH.
 *
 * Payload: { key: "/buckets/<bucket>/<s3key>", event_type: "create", message: {...} }
 */
export const POST: RequestHandler = async ({ request }) => {
	try {
		const body = await request.json();
		const { key: filerPath, event_type } = body;

		if (event_type !== 'create' || !filerPath) {
			return json({ ok: true });
		}

		// SeaweedFS filer path: /buckets/<bucket>/<s3key>
		// Strip "/buckets/<bucket>/" to get the S3 key
		const match = filerPath.match(/^\/buckets\/[^/]+\/(.+)$/);
		if (!match) {
			return json({ ok: true });
		}
		const s3Key = match[1];

		// Find upload record by key
		const upload = await uploadRepository.findOne({ key: s3Key } as Partial<
			import('@syr-is/types').Upload
		>);
		if (!upload || upload.status !== 'pending') {
			return json({ ok: true });
		}

		// Finalize the upload
		try {
			await uploadController.completeUpload(upload.id);
			console.log(`[webhook/storage] Auto-finalized upload: ${s3Key}`);
		} catch (err) {
			console.error(`[webhook/storage] Failed to finalize ${s3Key}:`, err);
		}
	} catch (err) {
		console.error('[webhook/storage] Error processing webhook:', err);
	}

	// Always return 200 — SeaweedFS retries on non-2xx
	return json({ ok: true });
};
