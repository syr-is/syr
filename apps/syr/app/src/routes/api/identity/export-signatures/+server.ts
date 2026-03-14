import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { z } from 'zod';
import { verify, decodeMultibase } from '@syr-is/crypto';
import { parseDid } from '@syr-is/did';
import {
	getExportSigningSession,
	updateExportSigningSession,
	setExportSignedBundle
} from '$lib/server/export-verify-store';
import { notifyExportVerified } from '$lib/server/export-verify-broadcast';
import {
	getSignableItemsChunk,
	buildAllSignableItems,
	CHUNK_SIZE
} from '$lib/server/export-signing';

const SignaturesRequestSchema = z.object({
	signing_session_id: z.string().uuid(),
	signatures: z
		.array(
			z.object({
				id: z.string().min(1),
				signature: z.string().min(1)
			})
		)
		.min(1)
});

/**
 * POST /api/identity/export-signatures
 *
 * Receives signatures for a chunk of signable items from Syner.
 * Returns next chunk if has_more, or export_token when done.
 */
export const POST: RequestHandler = async ({ request }) => {
	try {
		const body = await request.json();
		const data = SignaturesRequestSchema.parse(body);

		const session = await getExportSigningSession(data.signing_session_id);
		if (!session) {
			return json(
				{ error: 'session_expired', error_description: 'Signing session expired or not found' },
				{ status: 410 }
			);
		}

		const { export_data, signatures, cursor, all_item_ids, all_signable_items, did } = session;
		const expectedIds = new Set(all_item_ids);
		const receivedIds = new Set<string>();

		// Validate: no duplicate ids, all ids expected, none already received
		for (const { id } of data.signatures) {
			if (!expectedIds.has(id)) {
				return json(
					{ error: 'invalid_request', error_description: `Unexpected signature id: ${id}` },
					{ status: 400 }
				);
			}
			if (signatures[id]) {
				return json(
					{ error: 'invalid_request', error_description: `Duplicate signature for id: ${id}` },
					{ status: 400 }
				);
			}
			if (receivedIds.has(id)) {
				return json(
					{ error: 'invalid_request', error_description: `Duplicate id in request: ${id}` },
					{ status: 400 }
				);
			}
			receivedIds.add(id);
		}

		const allItems = all_signable_items ?? buildAllSignableItems(export_data, did);
		const itemsById = new Map(allItems.map((i) => [i.id, i]));
		let parsedDid;
		try {
			parsedDid = parseDid(did);
		} catch {
			return json(
				{ error: 'server_error', error_description: 'Invalid DID in session' },
				{ status: 500 }
			);
		}

		for (const { id, signature: sigStr } of data.signatures) {
			const item = itemsById.get(id);
			if (!item) {
				return json(
					{ error: 'server_error', error_description: `Unknown item id: ${id}` },
					{ status: 500 }
				);
			}
			let signatureBytes: Uint8Array;
			try {
				signatureBytes = decodeMultibase(sigStr);
			} catch {
				return json(
					{ error: 'invalid_signature', error_description: `Malformed signature for ${id}` },
					{ status: 400 }
				);
			}
			const messageBytes = new TextEncoder().encode(item.message);
			const isValid = await verify(messageBytes, signatureBytes, parsedDid.publicKey);
			if (!isValid) {
				return json(
					{
						error: 'invalid_signature',
						error_description: `Signature verification failed for ${id}`
					},
					{ status: 403 }
				);
			}
		}

		// Validate that received IDs cover the current chunk
		const currentChunk = getSignableItemsChunk(
			export_data,
			did,
			cursor,
			CHUNK_SIZE,
			all_signable_items
		);
		const chunkIds = new Set(currentChunk.items.map((i) => i.id));
		for (const cid of chunkIds) {
			if (!receivedIds.has(cid)) {
				return json(
					{
						error: 'invalid_request',
						error_description: `Missing signature for chunk item: ${cid}`
					},
					{ status: 400 }
				);
			}
		}

		// Merge signatures
		const mergedSignatures: Record<string, string> = { ...signatures };
		for (const { id, signature } of data.signatures) {
			mergedSignatures[id] = signature;
		}

		// Check if all signatures received
		const allReceived = all_item_ids.every((id) => mergedSignatures[id]);

		if (!allReceived) {
			const chunkIndex = Math.floor(cursor / CHUNK_SIZE);

			const updated = await updateExportSigningSession(data.signing_session_id, (s) => ({
				...s,
				signatures: mergedSignatures,
				cursor: currentChunk.nextCursor
			}));
			if (!updated) {
				return json(
					{
						error: 'conflict',
						error_description:
							'Session was updated by another request. Please retry signing this chunk.'
					},
					{ status: 409 }
				);
			}

			return json({
				success: true as const,
				items: currentChunk.items,
				has_more: currentChunk.hasMore,
				chunk_index: chunkIndex + 1,
				total_count: currentChunk.totalCount,
				chunk_size: CHUNK_SIZE,
				signed_count: Object.keys(mergedSignatures).length
			});
		}

		// All done: claim session via optimistic lock to prevent concurrent finalization
		const finalized = await updateExportSigningSession(data.signing_session_id, (s) => ({
			...s,
			signatures: mergedSignatures,
			finalized: true
		}));
		if (!finalized) {
			return json(
				{
					error: 'conflict',
					error_description: 'Already finalized by another request'
				},
				{ status: 409 }
			);
		}

		// Assemble signed bundle
		const signedPosts = export_data.exportedPosts.map((post, i) => {
			const sig = mergedSignatures[`post:${i}`];
			if (!sig) return post;
			const base = { ...post, signature: sig } as Record<string, unknown>;
			const assets = (post as Record<string, unknown> & { assets?: Array<Record<string, unknown>> })
				.assets;
			if (assets) {
				base.assets = assets.map((a, j) => {
					const aSig = mergedSignatures[`post:${i}:asset:${j}`];
					return aSig ? { ...a, signature: aSig } : a;
				});
			}
			return base;
		});

		const signedAssets = export_data.exportedAssets.map((asset, k) => {
			const sig = mergedSignatures[`asset:${k}`];
			return sig ? { ...asset, signature: sig } : asset;
		});

		const exportToken = crypto.randomUUID();
		await setExportSignedBundle(exportToken, {
			manifest: export_data.manifest,
			identity: export_data.identityBundle,
			posts: signedPosts,
			assets: signedAssets,
			pinned_posts: { post_ids: export_data.pinnedPostIds }
		});

		notifyExportVerified(session.challenge_id, exportToken);

		return json({
			success: true as const,
			export_token: exportToken,
			done: true as const
		});
	} catch (err) {
		if (err instanceof z.ZodError) {
			return json(
				{ error: 'invalid_request', error_description: 'Invalid request body' },
				{ status: 400 }
			);
		}
		if (err instanceof SyntaxError) {
			return json(
				{ error: 'invalid_request', error_description: 'Invalid JSON body' },
				{ status: 400 }
			);
		}
		console.error('Export-signatures error:', err);
		return json(
			{ error: 'server_error', error_description: 'An unexpected error occurred' },
			{ status: 500 }
		);
	}
};
