import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { stringToRecordId } from '@syr-is/types';
import { dbService } from '$lib/services/db';
import { uploadRepository } from '$lib/repositories/upload.repository';
import { DeleteObjectCommand } from '@aws-sdk/client-s3';
import { s3Service } from '$lib/services/s3';
import { s3 } from '$lib/config';
import type { Folder, Upload } from '@syr-is/types';
import type { RecordId } from 'surrealdb';

/**
 * DELETE /api/admin/media/folders/[folderId]?delete_contents=true
 * Delete an instance media folder (admin only).
 */
export const DELETE: RequestHandler = async ({ params, url, locals }) => {
	if (!locals.user) throw error(401, { code: 'UNAUTHORIZED', message: 'Authentication required' });
	if (locals.user.role !== 'ADMIN') throw error(403, { code: 'FORBIDDEN', message: 'Admin only' });

	const db = dbService.getDb();
	const folderId = stringToRecordId.decode(params.folderId);
	const deleteContents = url.searchParams.get('delete_contents') === 'true';

	// Verify the folder exists and is an instance media folder
	const folderResult = await db.query<[Folder[]]>(
		`SELECT * FROM folder WHERE id = $id AND scope = 'instance' LIMIT 1`,
		{ id: folderId }
	);
	const folder = folderResult[0]?.[0];
	if (!folder) throw error(404, { code: 'NOT_FOUND', message: 'Folder not found' });

	// Check for children
	const childResult = await db.query<[Folder[]]>(
		`SELECT * FROM folder WHERE parent_id = $id AND scope = 'instance' LIMIT 1`,
		{ id: folderId }
	);
	if ((childResult[0]?.length ?? 0) > 0 && !deleteContents) {
		throw error(400, {
			code: 'BAD_REQUEST',
			message: 'Folder has subfolders. Set delete_contents=true.'
		});
	}

	// Check for uploads
	const uploadResult = await db.query<[Upload[]]>(
		`SELECT * FROM upload WHERE folder_id = $id LIMIT 1`,
		{ id: folderId }
	);
	if ((uploadResult[0]?.length ?? 0) > 0 && !deleteContents) {
		throw error(400, {
			code: 'BAD_REQUEST',
			message: 'Folder has files. Set delete_contents=true.'
		});
	}

	if (deleteContents) {
		// Recursively collect descendant folder IDs
		async function getDescendants(parentId: RecordId): Promise<RecordId[]> {
			const result = await db.query<[{ id: RecordId }[]]>(
				`SELECT id FROM folder WHERE parent_id = $parentId AND scope = 'instance'`,
				{ parentId }
			);
			const children = (result[0] ?? []).map((r) => r.id);
			const all: RecordId[] = [...children];
			for (const childId of children) {
				all.push(...(await getDescendants(childId)));
			}
			return all;
		}

		const descendants = await getDescendants(folderId);

		// Delete uploads in all descendant folders + this folder
		for (const descId of [...descendants, folderId]) {
			const uploadsInFolder = await db.query<[Upload[]]>(
				`SELECT * FROM upload WHERE folder_id = $id`,
				{ id: descId }
			);
			for (const upload of uploadsInFolder[0] ?? []) {
				if (upload.key) {
					try {
						await s3Service.client.send(
							new DeleteObjectCommand({ Bucket: s3.bucket, Key: upload.key })
						);
					} catch {
						/* best effort */
					}
				}
				await uploadRepository.delete(upload.id);
			}
		}

		// Delete descendant folders (children first)
		for (const descId of descendants.reverse()) {
			await db.query(`DELETE FROM folder WHERE id = $id`, { id: descId });
		}
	}

	// Delete the folder itself
	await db.query(`DELETE FROM folder WHERE id = $id`, { id: folderId });

	return json({ status: 'success', message: 'Folder deleted' });
};
