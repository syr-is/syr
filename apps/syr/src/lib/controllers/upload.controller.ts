import { PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { UploadCreate, User } from '@syr-is/types';
import { s3 } from '$lib/config';
import { uploadRepository } from '$lib/repositories/upload.repository';
import { s3Service } from '$lib/services/s3';
import type { RecordId } from 'surrealdb';

export class UploadController {
	async getPutUrl(user: User, upload: UploadCreate) {
		const userId = user.id.toString();
		const now = new Date();
		const year = now.getFullYear();
		const month = String(now.getMonth() + 1).padStart(2, '0');

		let uploadRecord = await uploadRepository.create({
			...upload,
			owner_id: user.id,
			status: 'pending',
			created_at: now,
			updated_at: now
		});

		// Use the full RecordId format (table:id)
		const recordId = uploadRecord.id.toString();
		const key = `uploads/${userId}/${year}/${month}/${recordId}`;
		const finalUrl = `${s3.endpoint}/${s3.bucket}/${key}`;
		uploadRecord = await uploadRepository.update(uploadRecord.id, {
			key,
			url: finalUrl,
			updated_at: new Date()
		});
		const command = new PutObjectCommand({
			Key: key,
			ContentType: uploadRecord.mime_type,
			Bucket: s3.bucket,
			...(uploadRecord.sha256 && {
				ChecksumSHA256: uploadRecord.sha256
			})
		});
		const signedUrl = await getSignedUrl(s3Service.client, command, {
			expiresIn: 3600
		});
		return {
			signedUrl,
			finalUrl,
			uploadId: uploadRecord.id.toString()
		};
	}
	async completeUpload(uploadId: string | RecordId) {
		const uploadRecord = await uploadRepository.update(uploadId, {
			status: 'completed',
			updated_at: new Date()
		});
		return uploadRecord;
	}
}

export const uploadController = new UploadController();
