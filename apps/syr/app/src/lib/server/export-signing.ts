import { canonicalize } from '@syr-is/crypto';
import { buildPostPayload, buildAssetPayload } from '$lib/services/bundle-signature-verification';
import type { ExportSigningSessionExportData } from './export-verify-store';

export const CHUNK_SIZE = 20;

export type SignableItem = { id: string; message: string };

/**
 * Builds the flat list of all signable items (posts, post-nested assets, standalone assets)
 * in a deterministic order for chunked signing.
 */
export function buildAllSignableItems(
	exportData: ExportSigningSessionExportData,
	did: string
): SignableItem[] {
	const items: SignableItem[] = [];

	// 1. Each post (includes assets refs in payload)
	for (let i = 0; i < exportData.exportedPosts.length; i++) {
		const post = exportData.exportedPosts[i] as Record<string, unknown>;
		const payload = buildPostPayload(did, post as Parameters<typeof buildPostPayload>[1]);
		const message = canonicalize(payload);
		items.push({ id: `post:${i}`, message });
	}

	// 2. Each post's nested assets
	for (let i = 0; i < exportData.exportedPosts.length; i++) {
		const post = exportData.exportedPosts[i] as Record<string, unknown> & {
			assets?: Array<Record<string, unknown>>;
		};
		const assets = post?.assets ?? [];
		for (let j = 0; j < assets.length; j++) {
			const asset = assets[j];
			if (asset && typeof asset.sha256 === 'string') {
				const payload = buildAssetPayload(did, asset as Parameters<typeof buildAssetPayload>[1]);
				const message = canonicalize(payload);
				items.push({ id: `post:${i}:asset:${j}`, message });
			}
		}
	}

	// 3. Standalone assets (exportedAssets)
	for (let k = 0; k < exportData.exportedAssets.length; k++) {
		const asset = exportData.exportedAssets[k];
		if (asset && typeof asset.sha256 === 'string') {
			const payload = buildAssetPayload(did, asset as Parameters<typeof buildAssetPayload>[1]);
			const message = canonicalize(payload);
			items.push({ id: `asset:${k}`, message });
		}
	}

	return items;
}

/**
 * Returns a chunk of signable items starting at cursor.
 * Also returns the next cursor and whether more items remain.
 * When allItems is provided, uses it instead of rebuilding (avoids O(n) canonicalization per chunk).
 */
export function getSignableItemsChunk(
	exportData: ExportSigningSessionExportData,
	did: string,
	cursor: number,
	chunkSize: number = CHUNK_SIZE,
	allItems?: SignableItem[]
): { items: SignableItem[]; nextCursor: number; hasMore: boolean; totalCount: number } {
	const all = allItems ?? buildAllSignableItems(exportData, did);
	const chunk = all.slice(cursor, cursor + chunkSize);
	const nextCursor = cursor + chunk.length;
	const hasMore = nextCursor < all.length;
	return {
		items: chunk,
		nextCursor,
		hasMore,
		totalCount: all.length
	};
}
