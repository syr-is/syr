import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { FolderCreateSchema, stringToRecordId } from '@syr-is/types';
import { z } from 'zod';
import { userRepository } from '$lib/repositories/user.repository';
import { dbService } from '$lib/services/db';
import type { Folder } from '@syr-is/types';

function requireAdmin(locals: { user?: { role: string } }) {
	if (!locals.user) throw error(401, { code: 'UNAUTHORIZED', message: 'Authentication required' });
	if (locals.user.role !== 'ADMIN') throw error(403, { code: 'FORBIDDEN', message: 'Admin only' });
}

/**
 * GET /api/admin/media/folders?parent_id=...
 * List instance media folders at a given level. Returns folders + breadcrumbs.
 */
export const GET: RequestHandler = async ({ url, locals }) => {
	requireAdmin(locals);
	const db = dbService.getDb();

	const parentIdParam = url.searchParams.get('parent_id') || null;

	let folders: Folder[];
	if (parentIdParam) {
		const parentId = stringToRecordId.decode(parentIdParam);
		const result = await db.query<[Folder[]]>(
			`SELECT * FROM folder WHERE scope = 'instance' AND parent_id = $parentId ORDER BY name ASC`,
			{ parentId }
		);
		folders = result[0] ?? [];
	} else {
		const result = await db.query<[Folder[]]>(
			`SELECT * FROM folder WHERE scope = 'instance' AND parent_id IS NULL ORDER BY name ASC`
		);
		folders = result[0] ?? [];
	}

	// Build breadcrumbs by walking up the parent chain
	const breadcrumbs: Array<{ id: string; name: string }> = [];
	if (parentIdParam) {
		let currentId: string | null = parentIdParam;
		while (currentId) {
			const rows: Folder[] =
				(
					await db.query<[Folder[]]>(`SELECT * FROM folder WHERE id = $id LIMIT 1`, {
						id: stringToRecordId.decode(currentId)
					})
				)[0] ?? [];
			const f: Folder | undefined = rows[0];
			if (!f) break;
			breadcrumbs.unshift({ id: f.id.toString(), name: f.name });
			currentId = f.parent_id ? f.parent_id.toString() : null;
		}
	}

	return json({
		status: 'success',
		data: { folders, breadcrumbs }
	});
};

/**
 * POST /api/admin/media/folders
 * Create an instance media folder.
 */
export const POST: RequestHandler = async ({ request, locals }) => {
	requireAdmin(locals);

	const user = await userRepository.findById(locals.user!.id);
	if (!user) throw error(400, { code: 'BAD_REQUEST', message: 'Invalid user' });

	const db = dbService.getDb();

	try {
		const body = await request.json();
		const data = FolderCreateSchema.parse(body);
		const parentId = data.parent_id ? stringToRecordId.decode(data.parent_id) : null;

		// Check for duplicate name in same parent
		let existing: Folder[];
		if (parentId) {
			const result = await db.query<[Folder[]]>(
				`SELECT * FROM folder WHERE scope = 'instance' AND name = $name AND parent_id = $parentId LIMIT 1`,
				{ name: data.name, parentId }
			);
			existing = result[0] ?? [];
		} else {
			const result = await db.query<[Folder[]]>(
				`SELECT * FROM folder WHERE scope = 'instance' AND name = $name AND parent_id IS NULL LIMIT 1`,
				{ name: data.name }
			);
			existing = result[0] ?? [];
		}

		if (existing.length > 0) {
			throw error(409, {
				code: 'CONFLICT',
				message: `Folder "${data.name}" already exists in this location`
			});
		}

		const now = new Date();
		const result = await db.query<[Folder[]]>(
			`CREATE folder SET
				name = $name,
				owner_id = $ownerId,
				parent_id = $parentId,
				scope = 'instance',
				created_at = $now,
				updated_at = $now`,
			{ name: data.name, ownerId: user.id, parentId, now }
		);

		const folder = Array.isArray(result[0]) ? result[0][0] : result[0];
		if (!folder)
			throw error(500, { code: 'INTERNAL_SERVER_ERROR', message: 'Failed to create folder' });

		return json({ status: 'success', data: folder }, { status: 201 });
	} catch (err) {
		if (err instanceof z.ZodError) {
			throw error(400, {
				code: 'VALIDATION_ERROR',
				message: 'Invalid folder data',
				details: z.treeifyError(err)
			});
		}
		if (err && typeof err === 'object' && 'status' in err) throw err;
		if (err instanceof Error) {
			throw error(400, { code: 'BAD_REQUEST', message: err.message });
		}
		throw err;
	}
};
