import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { z } from 'zod';
import { kvService } from '$lib/services/kv';
import { INVITE_CODE_TYPE } from '$lib/instance-config';
import type { InviteCodeValue } from '@syr-is/types';

function generateInviteCode(): string {
	const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
	const bytes = new Uint8Array(8);
	crypto.getRandomValues(bytes);
	return Array.from(bytes, (b) => chars[b % chars.length]).join('');
}

export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user) {
		throw error(401, { code: 'UNAUTHORIZED', message: 'Authentication required' });
	}
	if (locals.user.role !== 'ADMIN') {
		throw error(403, {
			code: 'FORBIDDEN',
			message: 'Only instance administrators can manage invite codes'
		});
	}

	const entries = await kvService.getByType(INVITE_CODE_TYPE);
	const codes = entries.map((entry) => {
		const raw = String(entry.id.id);
		const prefix = `${INVITE_CODE_TYPE}:`;
		const value = entry.value as InviteCodeValue;
		return {
			code: raw.startsWith(prefix) ? raw.slice(prefix.length) : raw,
			created_by: value.created_by,
			max_uses: value.max_uses,
			uses: value.uses,
			created_at: value.created_at
		};
	});

	return json({ status: 'success', data: codes });
};

const CreateBodySchema = z.object({
	max_uses: z.number().int().min(1).nullable().optional()
});

export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) {
		throw error(401, { code: 'UNAUTHORIZED', message: 'Authentication required' });
	}
	if (locals.user.role !== 'ADMIN') {
		throw error(403, {
			code: 'FORBIDDEN',
			message: 'Only instance administrators can manage invite codes'
		});
	}

	let body: z.infer<typeof CreateBodySchema>;
	try {
		body = CreateBodySchema.parse(await request.json());
	} catch {
		throw error(400, { code: 'VALIDATION_ERROR', message: 'Invalid request body' });
	}

	const username = locals.user.username;
	let code = generateInviteCode();

	const value: InviteCodeValue = {
		created_by: username,
		max_uses: body.max_uses ?? null,
		uses: 0,
		created_at: new Date().toISOString()
	};

	// Create with one retry on collision
	let created = await kvService.createIfAbsent(INVITE_CODE_TYPE, code, value);
	if (!created) {
		code = generateInviteCode();
		created = await kvService.createIfAbsent(INVITE_CODE_TYPE, code, value);
		if (!created) {
			throw error(500, {
				code: 'INTERNAL_SERVER_ERROR',
				message: 'Failed to generate unique invite code'
			});
		}
	}

	return json(
		{
			status: 'success',
			data: { code, ...value }
		},
		{ status: 201 }
	);
};
