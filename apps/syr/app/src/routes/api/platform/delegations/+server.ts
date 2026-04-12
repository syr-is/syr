import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { platformDelegationController } from '$lib/controllers/platform-delegation.controller';

/**
 * GET /api/platform/delegations?did=...
 *
 * Public endpoint listing platform delegations for a DID.
 * Used by consumer applications to verify message signatures.
 */
export const GET: RequestHandler = async ({ url }) => {
	const did = url.searchParams.get('did');
	if (!did) {
		return json(
			{ error: 'invalid_request', error_description: 'did query parameter is required' },
			{ status: 400 }
		);
	}

	try {
		const delegations = await platformDelegationController.getDelegations(did);
		return json({ data: delegations });
	} catch (err) {
		console.error('Platform delegations listing error:', err);
		return json(
			{ error: 'server_error', error_description: 'An unexpected error occurred' },
			{ status: 500 }
		);
	}
};
