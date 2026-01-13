/**
 * Upload handler for file uploads
 * Handles the complete upload flow: hash calculation, signed URL retrieval, S3 upload, and completion
 */

export async function handleFileUpload(file: File): Promise<string> {
	try {
		// Calculate SHA256 hash of the file
		const arrayBuffer = await file.arrayBuffer();
		const hashBuffer = await crypto.subtle.digest('SHA-256', arrayBuffer);
		const hashArray = Array.from(new Uint8Array(hashBuffer));
		const sha256 = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');

		// Step 1: Get signed URL from API
		const response = await fetch('/api/uploads', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json'
			},
			body: JSON.stringify({
				filename: file.name,
				mime_type: file.type,
				size: file.size,
				sha256
			})
		});

		if (!response.ok) {
			throw new Error(`Failed to get upload URL: ${response.statusText}`);
		}

		const { signedUrl, finalUrl, uploadId } = await response.json();

		// Step 2: Upload file to S3 using the signed URL
		const uploadResponse = await fetch(signedUrl, {
			method: 'PUT',
			headers: {
				'Content-Type': file.type
			},
			body: file
		});

		if (!uploadResponse.ok) {
			throw new Error(`Failed to upload file: ${uploadResponse.statusText}`);
		}

		// Step 3: Complete the upload
		const completeResponse = await fetch('/api/uploads', {
			method: 'PATCH',
			headers: {
				'Content-Type': 'application/json'
			},
			body: JSON.stringify({ id: uploadId, status: 'completed' })
		});

		if (!completeResponse.ok) {
			throw new Error(`Failed to complete upload: ${completeResponse.statusText}`);
		}

		return finalUrl;
	} catch (error) {
		console.error('Upload error:', error);
		throw error;
	}
}
