import { objectStore } from '$lib/services/object-store';

let setupPromise: Promise<void> | null = null;

/**
 * Ensures the S3 bucket exists and has CORS configured.
 * Delegates to the active ObjectStore adapter (SeaweedFS or MinIO).
 * Safe to call repeatedly; runs once per process.
 */
export async function ensureS3Setup(): Promise<void> {
	if (!setupPromise) {
		setupPromise = objectStore.initialize().catch((error) => {
			setupPromise = null;
			console.error('Failed to ensure S3 bucket and CORS:', error);
			throw error;
		});
	}
	return setupPromise;
}
