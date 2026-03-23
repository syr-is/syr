import {
	DeleteObjectCommand,
	DeleteObjectsCommand,
	ListObjectsV2Command
} from '@aws-sdk/client-s3';
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
import { discoveryRegistryRepository } from '$lib/repositories/discovery-registry.repository';
import { contentTrustRuleRepository } from '$lib/repositories/content-trust-rule.repository';
import { outboxRepository } from '$lib/repositories/outbox.repository';
import { folderController } from '$lib/controllers/folder.controller';

/**
 * Account Deletion Service
 * Orchestrates cascade deletion of all user data.
 * Order: outbox, registry, discovery registries, content trust rules, sessions, folders (+ S3), posts, uploads (+ S3),
 *        delegated keys, identity, profile, KV (pinned_posts, file_store_usage), user.
 * Note: pinned_posts and file_store_usage are deleted last so subtractUsage during folder/upload deletion
 * updates the real entry; deleting early would let subtractUsage recreate it.
 */
export async function deleteAccount(userId: RecordId | string): Promise<void> {
	const recordId = typeof userId === 'string' ? stringToRecordId.decode(userId) : userId;
	const identity = await identityRepository.findByUserId(recordId);
	const did = identity?.did ?? null;

	// 1. Outbox
	try {
		await outboxRepository.deleteByUserId(recordId);
	} catch (e) {
		console.warn('[account-deletion] Failed to delete outbox:', e);
	}

	// 2. Registry (by DID)
	if (did) {
		try {
			const regs = await registryRepository.findByDid(did);
			for (const r of regs) {
				await registryRepository.removeRegistry(r.id);
			}
		} catch (e) {
			console.warn('[account-deletion] Failed to delete registry entries:', e);
		}
	}

	// 2b. Discovery registries (by user)
	try {
		await discoveryRegistryRepository.deleteAllForUser(recordId);
	} catch (e) {
		console.warn('[account-deletion] Failed to delete discovery registry entries:', e);
	}

	// 2c. Content trust rules (by user)
	try {
		await contentTrustRuleRepository.deleteAllForUser(recordId);
	} catch (e) {
		console.warn('[account-deletion] Failed to delete content trust rules:', e);
	}

	// 3. Sessions
	try {
		await sessionRepository.deleteByUserId(recordId);
	} catch (e) {
		console.warn('[account-deletion] Failed to delete sessions:', e);
	}

	// 4. Folders + uploads + S3 (folders owned by user)
	const rootFolders = await folderRepository.findByParent(recordId, null);
	for (const folder of rootFolders) {
		try {
			await folderController.deleteFolder(folder.id.toString(), recordId, true);
		} catch (e) {
			console.warn('[account-deletion] Failed to delete folder:', folder.id, e);
		}
	}

	// 5. Posts (by DID)
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

	// 6. Uploads (by DID) + S3
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

		// 7. Delete any orphaned S3 objects under uploads/{did}/ (e.g. failed uploads with no DB record)
		const prefix = `uploads/${did}/`;
		try {
			let continuationToken: string | undefined;
			do {
				const listResp = await s3Service.client.send(
					new ListObjectsV2Command({
						Bucket: s3.bucket,
						Prefix: prefix,
						ContinuationToken: continuationToken
					})
				);
				if (listResp.Contents && listResp.Contents.length > 0) {
					const deleteResp = await s3Service.client.send(
						new DeleteObjectsCommand({
							Bucket: s3.bucket,
							Delete: {
								Objects: (listResp.Contents ?? [])
									.filter((obj): obj is typeof obj & { Key: string } => obj.Key != null)
									.map((obj) => ({ Key: obj.Key })),
								Quiet: true
							}
						})
					);
					if (deleteResp.Errors && deleteResp.Errors.length > 0) {
						const errKeys = deleteResp.Errors.map((e) => e.Key ?? '?').join(', ');
						throw new Error(
							`S3 DeleteObjects failed for prefix ${prefix}: ${deleteResp.Errors.length} error(s) (keys: ${errKeys})`
						);
					}
				}
				continuationToken = listResp.NextContinuationToken;
			} while (continuationToken);
		} catch (e) {
			console.warn('[account-deletion] Failed to delete orphaned S3 prefix:', prefix, e);
		}
	}

	// 8. Delegated keys, identity
	if (did) {
		try {
			await delegatedKeyRepository.deleteByDid(did);
		} catch (e) {
			console.warn('[account-deletion] Failed to delete delegated keys:', e);
		}
		try {
			await identityRepository.deleteByDid(did);
		} catch (e) {
			console.warn('[account-deletion] Failed to delete identity:', e);
		}
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

	// 10. KV: pinned_posts, file_store_usage (must be after folder/upload deletion so subtractUsage doesn't recreate)
	await kvService
		.delete('pinned_posts', String(recordId))
		.catch((e) => console.warn('[account-deletion] Failed to delete pinned_posts:', e));
	await kvService
		.delete('file_store_usage', String(recordId))
		.catch((e) => console.warn('[account-deletion] Failed to delete file_store_usage:', e));

	// 11. User
	try {
		await userRepository.delete(recordId);
	} catch (e) {
		console.error('[account-deletion] CRITICAL: Failed to delete user', {
			userId: String(recordId),
			error: e instanceof Error ? e.message : String(e),
			stack: e instanceof Error ? e.stack : undefined
		});
		throw e;
	}
}
