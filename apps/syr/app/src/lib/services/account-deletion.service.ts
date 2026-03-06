import { DeleteObjectCommand } from '@aws-sdk/client-s3';
import { stringToRecordId } from '@syr-is/types';
import type { RecordId } from 'surrealdb';
import { kvService } from '$lib/services/kv';
import { s3Service } from '$lib/services/s3';
import { s3 } from '$lib/config';
import { identityRepository, delegatedKeyRepository } from '$lib/repositories/identity.repository';
import { userRepository } from '$lib/repositories/user.repository';
import { profileRepository } from '$lib/repositories/profile.repository';
import { sessionRepository } from '$lib/repositories/session.repository';
import { postRepository } from '$lib/repositories/post.repository';
import { uploadRepository } from '$lib/repositories/upload.repository';
import { folderRepository } from '$lib/repositories/folder.repository';
import { registryRepository } from '$lib/repositories/registry.repository';
import { outboxRepository } from '$lib/repositories/outbox.repository';
import { folderController } from '$lib/controllers/folder.controller';

/**
 * Account Deletion Service
 * Orchestrates cascade deletion of all user data.
 * Order: KV, outbox, registry, sessions, folders (+ S3), posts, uploads (+ S3), delegated keys, identity, profile, user.
 */
export async function deleteAccount(userId: RecordId | string): Promise<void> {
	const recordId = typeof userId === 'string' ? stringToRecordId.decode(userId) : userId;
	const identity = await identityRepository.findByUserId(recordId);
	const did = identity?.did ?? null;

	// 1. KV: pinned_posts, file_store_usage
	await kvService
		.delete('pinned_posts', String(recordId))
		.catch((e) => console.warn('[account-deletion] Failed to delete pinned_posts:', e));
	await kvService
		.delete('file_store_usage', String(recordId))
		.catch((e) => console.warn('[account-deletion] Failed to delete file_store_usage:', e));

	// 2. Outbox
	await outboxRepository.deleteByUserId(recordId);

	// 3. Registry (by DID)
	if (did) {
		const regs = await registryRepository.findByDid(did);
		for (const r of regs) {
			await registryRepository.removeRegistry(r.id);
		}
	}

	// 4. Sessions
	await sessionRepository.deleteByUserId(recordId);

	// 5. Folders + uploads + S3 (folders owned by user)
	const rootFolders = await folderRepository.findByParent(recordId, null);
	for (const folder of rootFolders) {
		try {
			await folderController.deleteFolder(folder.id.toString(), recordId, true);
		} catch (e) {
			console.warn('[account-deletion] Failed to delete folder:', folder.id, e);
		}
	}

	// 6. Posts (by DID)
	if (did) {
		let cursor: { afterCreatedAt: Date; afterDid: string; afterLocalId: string } | null = null;
		do {
			const { posts, nextCursor } = await postRepository.findByDid(did, {
				limit: 100,
				cursor: cursor ?? undefined
			});
			for (const p of posts) {
				try {
					await postRepository.delete(p.id);
				} catch (e) {
					console.warn('[account-deletion] Failed to delete post:', p.id, e);
				}
			}
			cursor = nextCursor;
		} while (cursor);
	}

	// 7. Uploads (by DID) + S3
	if (did) {
		let cursor: { afterCreatedAt: Date; afterDid: string; afterLocalId: string } | null = null;
		const s3Keys: string[] = [];
		do {
			const { uploads, nextCursor } = await uploadRepository.findByDid(did, {
				limit: 100,
				cursor: cursor ?? undefined
			});
			for (const u of uploads) {
				if (u.key) s3Keys.push(u.key);
				try {
					await uploadRepository.delete(u.id);
				} catch (e) {
					console.warn('[account-deletion] Failed to delete upload:', u.id, e);
				}
			}
			cursor = nextCursor;
		} while (cursor);
		for (const key of s3Keys) {
			try {
				await s3Service.client.send(new DeleteObjectCommand({ Bucket: s3.bucket, Key: key }));
			} catch (e) {
				console.warn('[account-deletion] Failed to delete S3 object:', key, e);
			}
		}
	}

	// 8. Delegated keys, identity
	if (did) {
		await delegatedKeyRepository.deleteByDid(did);
		await identityRepository.deleteByDid(did);
	}

	// 9. Profile
	const profile = await profileRepository.findByUserId(recordId);
	if (profile) {
		try {
			await profileRepository.delete(profile.id);
		} catch (e) {
			console.warn('[account-deletion] Failed to delete profile:', e);
		}
	}

	// 10. User
	await userRepository.delete(recordId);
}
