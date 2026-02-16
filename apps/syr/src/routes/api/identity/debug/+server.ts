import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { dbService } from '$lib/services/db';

/**
 * GET /api/identity/debug
 *
 * Debug endpoint to check the current state of identity records.
 * TEMPORARY - for debugging only.
 */
export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user) {
		throw error(401, {
			code: 'AUTHENTICATION_ERROR',
			message: 'Authentication required'
		});
	}

	const db = dbService.getDb();

	try {
		// Check identity records
		const identityRecords = await db.query(
			'SELECT * FROM identity WHERE user_id = $userId',
			{ userId: locals.user.id }
		);

		// Check delegated_key records
		const delegatedKeyRecords = await db.query(
			'SELECT * FROM delegated_key WHERE did IN (SELECT VALUE did FROM identity WHERE user_id = $userId)',
			{ userId: locals.user.id }
		);

		// Check user record
		const userRecords = await db.query('SELECT * FROM $userId', { userId: locals.user.id });

		return json({
			status: 'success',
			data: {
				user: locals.user,
				identityRecords: identityRecords[0] || [],
				delegatedKeyRecords: delegatedKeyRecords[0] || [],
				userRecord: userRecords[0]?.[0] || null
			}
		});
	} catch (err) {
		console.error('[identity.debug] Error:', err);
		throw error(500, {
			code: 'INTERNAL_SERVER_ERROR',
			message: err instanceof Error ? err.message : 'Debug query failed'
		});
	}
};

/**
 * DELETE /api/identity/debug
 *
 * Clean up any partial identity records.
 * TEMPORARY - for debugging only.
 */
export const DELETE: RequestHandler = async ({ locals }) => {
	if (!locals.user) {
		throw error(401, {
			code: 'AUTHENTICATION_ERROR',
			message: 'Authentication required'
		});
	}

	const db = dbService.getDb();

	try {
		// Get the user's DID if it exists
		const userRecords = await db.query('SELECT did FROM $userId', { userId: locals.user.id });
		const userDid = userRecords[0]?.[0]?.did;

		// Delete identity records for this user
		await db.query('DELETE identity WHERE user_id = $userId', { userId: locals.user.id });

		// If there was a DID, delete delegated keys too
		if (userDid) {
			await db.query('DELETE delegated_key WHERE did = $did', { did: userDid });
		}

		// Unset DID from user record
		await db.query('UPDATE $userId UNSET did', { userId: locals.user.id });

		return json({
			status: 'success',
			message: 'Identity records cleaned up',
			data: {
				deletedDid: userDid
			}
		});
	} catch (err) {
		console.error('[identity.debug] Cleanup error:', err);
		throw error(500, {
			code: 'INTERNAL_SERVER_ERROR',
			message: err instanceof Error ? err.message : 'Cleanup failed'
		});
	}
};
