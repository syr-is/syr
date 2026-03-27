import { z } from 'zod';
import { BaseEntitySchema, MetadataSchema, RecordIdSchema, TimestampSchema } from './common.js';
import { stringToRecordId } from './codecs.js';

/**
 * Upload Key Schema
 * Validates the upload key format for file storage paths.
 *
 * Format patterns:
 * - With folder: uploads/{did}/{folder_path}/{ulid}
 * - Without folder (root): uploads/{did}/{ulid}
 * - Post assets: uploads/{did}/posts/{post_ulid}/public/{ulid}
 * - Profile stories: uploads/{did}/stories/{UTC_YYYY-MM-DD}/public/{ulid}
 *
 * The DID prefix (did:syr:z6Mk...) namespaces all uploads by identity owner.
 * Note: folder_path can be nested like "public/images/2024"
 */
export const UploadKeySchema = z
	.string()
	.regex(/^uploads\/did:syr:[a-zA-Z0-9]+\/.+$/, 'Upload key must start with uploads/{did}/')
	.describe('Upload key in format uploads/{did}/[folder_path/]{ulid}');

export type UploadKey = z.infer<typeof UploadKeySchema>;

/**
 * Upload Status Schema
 * Represents the current status of an upload
 */
export const UploadStatusSchema = z.enum([
	'pending',
	'uploading',
	'finalizing',
	'completed',
	'failed',
	'cancelled'
]);

export type UploadStatus = z.infer<typeof UploadStatusSchema>;

/**
 * Upload Schema
 * Represents a file upload in the SYR system
 * - Pending uploads don't require key or url
 * - Completed uploads require key and url
 * - folder_id references the parent folder (null for root level uploads)
 * - is_public indicates if the file is in the public folder hierarchy
 */
export const UploadSchema = BaseEntitySchema.extend({
	key: UploadKeySchema.optional(),
	owner_id: RecordIdSchema,
	folder_id: RecordIdSchema.nullable().optional(),
	filename: z.string().min(1),
	mime_type: z.string().min(1),
	size: z.number().int().nonnegative(),
	sha256: z
		.string()
		.regex(/^[a-f0-9]{64}$/i)
		.optional(),
	url: z.url().optional(),
	status: UploadStatusSchema.default('pending'),
	is_public: z.boolean().default(false),
	/** Profile story slide (presign path); completed story uploads set published_at at completion. */
	is_story: z.boolean().default(false),
	/** Wall-clock time the story became public (set once when status → completed). */
	published_at: TimestampSchema.nullable().optional(),
	metadata: MetadataSchema.optional()
}).refine(
	(data) => {
		// Pending / finalizing uploads don't require key or url (finalizing is transient between S3 verify and completed)
		if (data.status === 'pending' || data.status === 'finalizing') {
			return true;
		}
		// Completed uploads require key and url
		if (data.status === 'completed') {
			return !!data.key && !!data.url;
		}
		// Other statuses (uploading, failed, cancelled) may or may not have key/url
		return true;
	},
	{
		message: 'Completed uploads must have both key and url',
		path: ['key'] // Error will be shown on key field
	}
);

export type Upload = z.infer<typeof UploadSchema>;

/**
 * Upload with composite ID components for API responses and URL construction.
 * did and local_id are added when serializing uploads for the client.
 */
export type UploadWithCompositeId = Upload & { did?: string; local_id?: string };

/**
 * Upload Create Schema
 * For creating new uploads
 * Pending uploads don't require key or url
 * folder_id can be provided as a string ID
 */
export const UploadCreateSchema = z.object({
	filename: z.string().min(1),
	mime_type: z.string().min(1),
	size: z.number().int().nonnegative(),
	sha256: z
		.string()
		.regex(/^[a-f0-9]{64}$/i)
		.optional(),
	metadata: MetadataSchema.optional(),
	folder_id: z.string().nullable().optional()
});

export type UploadCreate = z.infer<typeof UploadCreateSchema>;

/**
 * Upload Update Schema
 * For updating existing uploads
 * Uses stringToRecordId codec to accept string IDs from JSON requests
 */
export const UploadUpdateSchema = z.object({
	id: stringToRecordId,
	status: z.enum(['completed'])
});

export type UploadUpdate = z.infer<typeof UploadUpdateSchema>;
