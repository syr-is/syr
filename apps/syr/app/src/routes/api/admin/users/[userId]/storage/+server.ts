import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { z } from 'zod';
import { stringToRecordId } from '@syr-is/types';
import { userRepository } from '$lib/repositories/user.repository';
import { fileStoreUsageController } from '$lib/controllers/file-store-usage.controller';

function requireAdmin(locals: App.Locals) {
	if (!locals.user) {
		throw error(401, { code: 'UNAUTHORIZED', message: 'Authentication required' });
	}
	if (locals.user.role !== 'ADMIN') {
		throw error(403, {
			code: 'FORBIDDEN',
			message: 'Only instance administrators can manage users'
		});
	}
}

function parseUserId(raw: string) {
	try {
		return stringToRecordId.decode(raw);
	} catch {
		throw error(400, { code: 'VALIDATION_ERROR', message: 'Invalid user ID' });
	}
}

function formatBytes(bytes: number): string {
	if (bytes === 0) return '0 B';
	const k = 1024;
	const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
	const i = Math.floor(Math.log(bytes) / Math.log(k));
	return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

export const GET: RequestHandler = async ({ params, locals }) => {
	requireAdmin(locals);
	const userId = parseUserId(params.userId);

	const user = await userRepository.findById(userId);
	if (!user) {
		throw error(404, { code: 'NOT_FOUND', message: 'User not found' });
	}

	const details = await fileStoreUsageController.getUsageDetails(userId);
	const uploadsEnabled = !(await fileStoreUsageController.isUploadDisabled(userId));

	return json({ status: 'success', data: { ...details, uploads_enabled: uploadsEnabled } });
};

const PatchBodySchema = z
	.object({
		bytes_limit: z.number().int().positive().optional(),
		reset: z.boolean().optional(),
		uploads_enabled: z.boolean().optional()
	})
	.refine((d) => d.bytes_limit !== undefined || d.reset || d.uploads_enabled !== undefined, {
		message: 'Provide bytes_limit, reset, or uploads_enabled'
	});

export const PATCH: RequestHandler = async ({ params, request, locals }) => {
	requireAdmin(locals);
	const userId = parseUserId(params.userId);

	const user = await userRepository.findById(userId);
	if (!user) {
		throw error(404, { code: 'NOT_FOUND', message: 'User not found' });
	}

	let body: z.infer<typeof PatchBodySchema>;
	try {
		body = PatchBodySchema.parse(await request.json());
	} catch {
		throw error(400, {
			code: 'VALIDATION_ERROR',
			message: 'Provide bytes_limit, reset, or uploads_enabled'
		});
	}

	if (body.reset) {
		await fileStoreUsageController.clearUserLimit(userId);
	} else if (body.bytes_limit !== undefined) {
		// Prevent setting limit below current usage
		const currentUsage = await fileStoreUsageController.getUsage(userId);
		if (body.bytes_limit < currentUsage) {
			throw error(400, {
				code: 'VALIDATION_ERROR',
				message: `Cannot set limit below current usage (${formatBytes(currentUsage)})`
			});
		}
		await fileStoreUsageController.setUserLimit(userId, body.bytes_limit);
	}

	if (body.uploads_enabled !== undefined) {
		await fileStoreUsageController.setUploadDisabled(userId, !body.uploads_enabled);
	}

	const details = await fileStoreUsageController.getUsageDetails(userId);
	const uploadsEnabled = !(await fileStoreUsageController.isUploadDisabled(userId));

	return json({ status: 'success', data: { ...details, uploads_enabled: uploadsEnabled } });
};
