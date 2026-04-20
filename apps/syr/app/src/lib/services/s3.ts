/**
 * Backward-compatible re-exports from the ObjectStore abstraction.
 * Existing consumers import { s3Service } and { s3PublicClient } — both
 * still work, backed by the active ObjectStore adapter (SeaweedFS or MinIO).
 */
import { objectStore } from './object-store';

export const s3Service = {
	get client() {
		return objectStore.client;
	}
};

export const s3PublicClient = objectStore.publicClient;
