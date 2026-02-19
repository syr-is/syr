import { storageEvents } from '$lib/stores/storage-events.svelte';

/**
 * Upload handler for file uploads
 * Handles the complete upload flow: hash calculation, signed URL retrieval, S3 upload, and completion
 */

export interface UploadOptions {
	/** Target folder ID for the upload */
	folder_id?: string | null;
	/** Post ID for post assets - uploads go to posts/{post_id}/public/ */
	post_id?: string;
}

/**
 * Handle file upload to the default location (or specified folder)
 */
export async function handleFileUpload(file: File, options?: UploadOptions): Promise<string> {
	try {
		// Calculate SHA256 hash of the file
		const arrayBuffer = await file.arrayBuffer();
		const hashBuffer = await crypto.subtle.digest('SHA-256', arrayBuffer);
		const hashArray = Array.from(new Uint8Array(hashBuffer));
		const sha256 = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');

		// Determine endpoint based on options
		const endpoint = options?.post_id ? '/api/uploads/post-assets' : '/api/uploads';

		// Build request body
		// Fallback to application/octet-stream if browser can't detect MIME type
		const mimeType = file.type || 'application/octet-stream';
		const body: Record<string, unknown> = {
			filename: file.name,
			mime_type: mimeType,
			size: file.size,
			sha256
		};

		if (options?.post_id) {
			body.post_id = options.post_id;
		} else if (options?.folder_id !== undefined) {
			body.folder_id = options.folder_id;
		}

		// Step 1: Get signed URL from API
		const response = await fetch(endpoint, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json'
			},
			body: JSON.stringify(body)
		});

		if (!response.ok) {
			const errorBody = await response.json().catch(() => null);
			console.error('Upload API error:', errorBody);
			throw new Error(
				`Failed to get upload URL: ${errorBody?.error?.message || errorBody?.message || response.statusText}`
			);
		}

		const result = await response.json();
		if (!result || typeof result !== 'object' || !result.data) {
			throw new Error('Upload API returned invalid response: missing data');
		}
		const { signedUrl, finalUrl, uploadDid, uploadLocalId } = result.data;

		if (!signedUrl || !finalUrl) {
			throw new Error('Upload API returned invalid response: missing signedUrl or finalUrl');
		}

		// Step 2: Upload file to S3 using the signed URL
		const uploadResponse = await fetch(signedUrl, {
			method: 'PUT',
			headers: {
				'Content-Type': mimeType
			},
			body: file
		});

		if (!uploadResponse.ok) {
			throw new Error(`Failed to upload file: ${uploadResponse.statusText}`);
		}

		// Step 3: Complete the upload (requires upload identifiers from API)
		if (uploadDid == null || uploadLocalId == null) {
			throw new Error(
				'Upload API returned invalid response: missing upload identifiers for completion'
			);
		}
		const patchBody: Record<string, unknown> = { status: 'completed' };
		if (uploadDid != null) patchBody.did = uploadDid;
		if (uploadLocalId != null) patchBody.local_id = uploadLocalId;
		const completeResponse = await fetch('/api/uploads', {
			method: 'PATCH',
			headers: {
				'Content-Type': 'application/json'
			},
			body: JSON.stringify(patchBody)
		});

		if (!completeResponse.ok) {
			throw new Error(`Failed to complete upload: ${completeResponse.statusText}`);
		}

		// Trigger storage usage refresh
		storageEvents.refresh();

		return finalUrl;
	} catch (error) {
		console.error('Upload error:', error);
		throw error;
	}
}

/**
 * Handle file upload for post assets
 * Files are stored in: uploads/{did}/posts/{post_ulid}/public/
 * Folder hierarchy on uploads page: posts/{post_id}/public/{upload_id}
 * These files are publicly accessible
 */
export async function handlePostAssetUpload(file: File, postId: string): Promise<string> {
	return handleFileUpload(file, { post_id: postId });
}

/**
 * Create an upload handler for post assets with a specific post ID
 * Used by Milkdown editor for image uploads
 */
export function createPostAssetUploader(postId: string): (file: File) => Promise<string> {
	return (file: File) => handlePostAssetUpload(file, postId);
}
