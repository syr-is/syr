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

export const GET: RequestHandler = async ({ params, locals }) => {
	requireAdmin(locals);
	const userId = parseUserId(params.userId);

	const user = await userRepository.findById(userId);
	if (!user) {
		throw error(404, { code: 'NOT_FOUND', message: 'User not found' });
	}

	const details = await fileStoreUsageController.getUsageDetails(userId);
	return json({ status: 'success', data: details });
};

const PatchBodySchema = z
	.object({
		bytes_limit: z.number().int().positive().optional(),
		reset: z.boolean().optional()
	})
	.refine((d) => d.bytes_limit !== undefined || d.reset, {
		message: 'Provide bytes_limit or set reset to true'
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
			message: 'Provide bytes_limit or set reset to true'
		});
	}

	if (body.reset) {
		await fileStoreUsageController.clearUserLimit(userId);
	} else if (body.bytes_limit !== undefined) {
		await fileStoreUsageController.setUserLimit(userId, body.bytes_limit);
	}

	const details = await fileStoreUsageController.getUsageDetails(userId);
	return json({ status: 'success', data: details });
};
