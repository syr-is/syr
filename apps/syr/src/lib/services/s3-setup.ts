import {
	CreateBucketCommand,
	HeadBucketCommand,
	PutBucketCorsCommand,
	type BucketLocationConstraint
} from '@aws-sdk/client-s3';
import { s3 } from '$lib/config';
import { s3Service } from '$lib/services/s3';

let setupPromise: Promise<void> | null = null;

/**
 * Ensures the S3 bucket exists. Creates it if missing (idempotent).
 */
async function ensureBucket(): Promise<void> {
	try {
		await s3Service.client.send(new HeadBucketCommand({ Bucket: s3.bucket }));
	} catch (err: unknown) {
		const e = err as { name?: string; Code?: string; $metadata?: { httpStatusCode?: number } };
		const name = e?.name ?? '';
		const code = e?.Code ?? '';
		const status = e?.$metadata?.httpStatusCode;
		const isNotFound =
			status === 404 ||
			name === 'NotFound' ||
			code === 'NotFound' ||
			name === 'NoSuchBucket' ||
			code === 'NoSuchBucket';
		if (!isNotFound) {
			throw err;
		}
		try {
			await s3Service.client.send(
				new CreateBucketCommand({
					Bucket: s3.bucket,
					CreateBucketConfiguration:
						s3.region !== 'us-east-1'
							? { LocationConstraint: s3.region as BucketLocationConstraint }
							: undefined
				})
			);
			console.log(`S3 bucket "${s3.bucket}" created`);
		} catch (createErr: unknown) {
			const ce = createErr as {
				name?: string;
				Code?: string;
				$metadata?: { httpStatusCode?: number };
			};
			const status = ce?.$metadata?.httpStatusCode;
			const name = ce?.name ?? '';
			const code = ce?.Code ?? '';
			const isAlreadyOwned =
				status === 409 || name === 'BucketAlreadyOwnedByYou' || code === 'BucketAlreadyOwnedByYou';
			if (isAlreadyOwned) {
				console.log(`S3 bucket "${s3.bucket}" already existed (concurrent creation)`);
				return;
			}
			throw createErr;
		}
	}
}

/**
 * Applies CORS rules to the S3 bucket from config (S3_CORS_ORIGINS or CORS_ORIGIN).
 */
async function ensureBucketCors(): Promise<void> {
	const origins = s3.corsOrigins;
	await s3Service.client.send(
		new PutBucketCorsCommand({
			Bucket: s3.bucket,
			CORSConfiguration: {
				CORSRules: [
					{
						ID: 'syr-app',
						AllowedOrigins: origins,
						AllowedMethods: ['GET', 'POST', 'PUT', 'DELETE', 'HEAD'],
						AllowedHeaders: ['*'],
						ExposeHeaders: ['ETag', 'x-amz-version-id'],
						MaxAgeSeconds: 3600
					}
				]
			}
		})
	);
	console.log(`S3 bucket "${s3.bucket}" CORS updated for origins: ${origins.join(', ')}`);
}

/**
 * Ensures the S3 bucket exists and has CORS configured from env.
 * Safe to call repeatedly; runs once per process.
 */
export async function ensureS3Setup(): Promise<void> {
	if (!setupPromise) {
		setupPromise = (async () => {
			await ensureBucket();
			await ensureBucketCors();
		})();
	}
	return setupPromise;
}
