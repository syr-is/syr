import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { z } from 'zod';
import {
	UploadCreateSchema,
	extractDid,
	extractLocalId,
	recordIdFromDidAndLocal,
	stringToRecordId
} from '@syr-is/types';
import { PutObjectCommand, HeadObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { userRepository } from '$lib/repositories/user.repository';
import { uploadRepository } from '$lib/repositories/upload.repository';
import { folderRepository } from '$lib/repositories/folder.repository';
import { s3Service } from '$lib/services/s3';
import { s3 } from '$lib/config';
import { dbService } from '$lib/services/db';
import type { Upload } from '@syr-is/types';

function hexToBase64(hex: string): string {
	return Buffer.from(hex, 'hex').toString('base64');
}

function requireAdmin(locals: { user?: { role: string } }) {
	if (!locals.user) {
		throw error(401, { code: 'UNAUTHORIZED', message: 'Authentication required' });
	}
	if (locals.user.role !== 'ADMIN') {
		throw error(403, { code: 'FORBIDDEN', message: 'Admin access required' });
	}
}

/**
 * GET /api/admin/media
 * List instance media uploads (files with key starting with 'instance-media/')
 */
export const GET: RequestHandler = async ({ url, locals }) => {
	requireAdmin(locals);

	const limit = Math.min(
		100,
		Math.max(1, parseInt(url.searchParams.get('limit') ?? '20', 10) || 20)
	);
	const offset = Math.max(0, parseInt(url.searchParams.get('offset') ?? '0', 10) || 0);
	const sortField = url.searchParams.get('sort_field') ?? 'created_at';
	const sortOrder = url.searchParams.get('sort_order') === 'asc' ? 'ASC' : 'DESC';

	const allowedSortFields = ['created_at', 'updated_at', 'filename', 'size'];
	const safeSortField = allowedSortFields.includes(sortField) ? sortField : 'created_at';

	// folder_id: "" = root (no folder), string = specific folder, absent = all
	const folderIdParam = url.searchParams.get('folder_id');

	const db = dbService.getDb();

	let whereClause = `string::starts_with(key, 'instance-media/') AND status = 'completed'`;
	const params: Record<string, unknown> = { limit, offset };

	if (folderIdParam === '') {
		whereClause += ` AND folder_id IS NULL`;
	} else if (folderIdParam) {
		whereClause += ` AND folder_id = $folderId`;
		params.folderId = stringToRecordId.decode(folderIdParam);
	}

	const [dataResult, countResult] = await Promise.all([
		db.query<[Upload[]]>(
			`SELECT * FROM upload WHERE ${whereClause} ORDER BY ${safeSortField} ${sortOrder} LIMIT $limit START $offset`,
			params
		),
		db.query<[{ total: number }[]]>(
			`SELECT count() AS total FROM upload WHERE ${whereClause} GROUP ALL`,
			folderIdParam ? { folderId: params.folderId } : {}
		)
	]);

	const rows = dataResult[0] ?? [];
	const total = countResult[0]?.[0]?.total ?? 0;

	const serialized = rows.map((u) => ({
		...u,
		id: u.id.toString(),
		did: extractDid(u.id),
		local_id: extractLocalId(u.id),
		owner_id: u.owner_id?.toString?.()
	}));

	return json({
		status: 'success',
		data: serialized,
		pagination: { limit, offset, total, has_more: offset + rows.length < total }
	});
};

/**
 * POST /api/admin/media
 * Create a presigned URL for uploading instance media.
 * Key format: instance-media/[folder_path/]{ulid}
 * Files in a "public" folder hierarchy are publicly accessible; others need signed URLs.
 */
export const POST: RequestHandler = async ({ request, locals }) => {
	requireAdmin(locals);

	const user = await userRepository.findById(locals.user!.id);
	if (!user || !user.did) {
		throw error(400, { code: 'BAD_REQUEST', message: 'Admin must have an identity' });
	}

	try {
		const body = await request.json();
		const data = UploadCreateSchema.parse(body);
		const did = user.did;
		const now = new Date();

		const folderId = data.folder_id ? stringToRecordId.decode(data.folder_id) : null;

		// Determine public status and build S3 key with folder path
		let isPublic = false;
		let folderPath = '';
		if (folderId) {
			const pathParts = await folderRepository.getFullPath(folderId);
			if (pathParts.length > 0) {
				folderPath = pathParts.join('/') + '/';
			}
			isPublic = await folderRepository.isInPublicHierarchy(folderId);
		}

		let uploadRecord = await uploadRepository.createWithCompositeId(did, {
			filename: data.filename,
			mime_type: data.mime_type,
			size: data.size,
			sha256: data.sha256,
			metadata: data.metadata,
			owner_id: user.id,
			folder_id: folderId,
			status: 'pending',
			is_public: isPublic,
			created_at: now,
			updated_at: now
		});

		const localId = extractLocalId(uploadRecord.id);
		const key = `instance-media/${folderPath}${localId}`;
		const finalUrl = `${s3.endpoint}/${s3.bucket}/${key}`;

		uploadRecord = await uploadRepository.update(uploadRecord.id, {
			key,
			url: finalUrl,
			is_public: isPublic,
			updated_at: new Date()
		});

		const command = new PutObjectCommand({
			Key: key,
			ContentType: uploadRecord.mime_type,
			Bucket: s3.bucket,
			...(uploadRecord.sha256 && { ChecksumSHA256: hexToBase64(uploadRecord.sha256) })
		});

		const signedUrl = await getSignedUrl(s3Service.client, command, { expiresIn: 3600 });

		return json(
			{
				status: 'success',
				data: {
					signedUrl,
					finalUrl,
					uploadId: uploadRecord.id.toString(),
					uploadDid: extractDid(uploadRecord.id),
					uploadLocalId: extractLocalId(uploadRecord.id),
					isPublic
				}
			},
			{ status: 201 }
		);
	} catch (err) {
		if (err instanceof z.ZodError) {
			throw error(400, {
				code: 'VALIDATION_ERROR',
				message: 'Invalid upload data',
				details: z.treeifyError(err)
			});
		}
		if (err instanceof Error && err.message.includes('Storage limit')) {
			throw error(413, { code: 'STORAGE_LIMIT_EXCEEDED', message: err.message });
		}
		throw err;
	}
};

/**
 * PATCH /api/admin/media
 * Complete an instance media upload (verify in S3, transition to completed).
 */
export const PATCH: RequestHandler = async ({ request, locals }) => {
	requireAdmin(locals);

	try {
		const body = await request.json();
		const { did, local_id } = z
			.object({
				did: z.string().min(1),
				local_id: z.string().min(1),
				status: z.enum(['completed'])
			})
			.parse(body);

		const uploadId = recordIdFromDidAndLocal('upload', did, local_id);
		const upload = await uploadRepository.findById(uploadId);
		if (!upload) throw error(404, { code: 'NOT_FOUND', message: 'Upload not found' });
		if (!upload.key?.startsWith('instance-media/')) {
			throw error(403, { code: 'FORBIDDEN', message: 'Not an instance media upload' });
		}
		if (upload.status === 'completed') return json({ status: 'success', data: upload });
		if (upload.status !== 'pending') {
			throw error(400, {
				code: 'BAD_REQUEST',
				message: 'Upload cannot be completed in its current state'
			});
		}

		// Verify file in S3
		const headResult = await s3Service.client.send(
			new HeadObjectCommand({ Bucket: s3.bucket, Key: upload.key })
		);
		const actualSize = headResult.ContentLength ?? 0;
		if (actualSize !== upload.size) {
			await s3Service.client.send(new DeleteObjectCommand({ Bucket: s3.bucket, Key: upload.key }));
			await uploadRepository.delete(uploadId);
			throw error(400, {
				code: 'FILE_VERIFICATION_FAILED',
				message: `Size mismatch: expected ${upload.size}, got ${actualSize}`
			});
		}
		if (upload.sha256 && headResult.ChecksumSHA256) {
			if (headResult.ChecksumSHA256 !== hexToBase64(upload.sha256)) {
				await s3Service.client.send(
					new DeleteObjectCommand({ Bucket: s3.bucket, Key: upload.key })
				);
				await uploadRepository.delete(uploadId);
				throw error(400, { code: 'FILE_VERIFICATION_FAILED', message: 'Checksum mismatch' });
			}
		}

		const now = new Date();
		await uploadRepository.casPendingToFinalizing(uploadId, now);
		const completed = await uploadRepository.casFinalizingToCompleted(uploadId, now);
		if (!completed)
			throw error(500, { code: 'INTERNAL_SERVER_ERROR', message: 'Failed to complete upload' });

		return json({ status: 'success', data: completed });
	} catch (err) {
		if (err instanceof z.ZodError) {
			throw error(400, {
				code: 'VALIDATION_ERROR',
				message: 'Invalid request',
				details: z.treeifyError(err)
			});
		}
		if (err && typeof err === 'object' && 'status' in err) throw err;
		throw err;
	}
};
