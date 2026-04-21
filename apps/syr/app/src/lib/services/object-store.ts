import {
	S3Client,
	HeadBucketCommand,
	HeadObjectCommand,
	PutObjectCommand,
	GetObjectCommand,
	DeleteObjectCommand,
	DeleteObjectsCommand,
	CopyObjectCommand,
	ListObjectsV2Command,
	CreateBucketCommand,
	PutBucketCorsCommand,
	PutBucketPolicyCommand,
	type PutObjectCommandInput,
	type PutObjectCommandOutput,
	type GetObjectCommandInput,
	type GetObjectCommandOutput,
	type HeadObjectCommandOutput,
	type ListObjectsV2CommandOutput,
	type BucketLocationConstraint
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { NodeHttpHandler } from '@smithy/node-http-handler';
import { s3 } from '$lib/config';

// ── Abstract ObjectStore ──

export abstract class ObjectStore {
	abstract readonly name: string;

	abstract get client(): S3Client;
	abstract get publicClient(): S3Client;

	abstract initialize(): Promise<void>;

	/** Whether uploads need background retry for HeadObject (write-commit lag). */
	abstract get requiresFinalizationRetry(): boolean;

	async headObject(bucket: string, key: string): Promise<HeadObjectCommandOutput | null> {
		try {
			return await this.client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
		} catch (err) {
			const status = (err as any)?.$metadata?.httpStatusCode;
			if (status === 404) return null;
			throw err;
		}
	}

	async putObject(params: PutObjectCommandInput): Promise<PutObjectCommandOutput> {
		return this.client.send(new PutObjectCommand(params));
	}

	async getObject(params: GetObjectCommandInput): Promise<GetObjectCommandOutput> {
		return this.client.send(new GetObjectCommand(params));
	}

	async deleteObject(bucket: string, key: string): Promise<void> {
		await this.client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
	}

	async deleteObjects(bucket: string, keys: string[]): Promise<void> {
		if (keys.length === 0) return;
		await this.client.send(
			new DeleteObjectsCommand({
				Bucket: bucket,
				Delete: { Objects: keys.map((Key) => ({ Key })) }
			})
		);
	}

	async copyObject(bucket: string, sourceKey: string, destKey: string): Promise<void> {
		await this.client.send(
			new CopyObjectCommand({
				Bucket: bucket,
				CopySource: `${bucket}/${sourceKey}`,
				Key: destKey
			})
		);
	}

	async listObjects(
		bucket: string,
		prefix: string,
		continuationToken?: string
	): Promise<ListObjectsV2CommandOutput> {
		return this.client.send(
			new ListObjectsV2Command({
				Bucket: bucket,
				Prefix: prefix,
				ContinuationToken: continuationToken
			})
		);
	}

	async presignPut(params: PutObjectCommandInput, expiresIn = 3600): Promise<string> {
		return getSignedUrl(this.publicClient, new PutObjectCommand(params), { expiresIn });
	}

	async presignGet(params: GetObjectCommandInput, expiresIn = 3600): Promise<string> {
		return getSignedUrl(this.publicClient, new GetObjectCommand(params), { expiresIn });
	}

	protected async ensureBucket(client: S3Client, bucket: string, region: string): Promise<void> {
		try {
			await client.send(new HeadBucketCommand({ Bucket: bucket }));
		} catch (err) {
			const e = err as { name?: string; Code?: string; $metadata?: { httpStatusCode?: number } };
			const isNotFound =
				e?.$metadata?.httpStatusCode === 404 ||
				e?.name === 'NotFound' ||
				e?.Code === 'NotFound' ||
				e?.name === 'NoSuchBucket' ||
				e?.Code === 'NoSuchBucket';
			if (!isNotFound) throw err;

			try {
				await client.send(
					new CreateBucketCommand({
						Bucket: bucket,
						CreateBucketConfiguration:
							region !== 'us-east-1'
								? { LocationConstraint: region as BucketLocationConstraint }
								: undefined
					})
				);
				console.log(`S3 bucket "${bucket}" created`);
			} catch (createErr) {
				const ce = createErr as {
					name?: string;
					Code?: string;
					$metadata?: { httpStatusCode?: number };
				};
				const isAlreadyOwned =
					ce?.$metadata?.httpStatusCode === 409 ||
					ce?.name === 'BucketAlreadyOwnedByYou' ||
					ce?.Code === 'BucketAlreadyOwnedByYou';
				if (isAlreadyOwned) return;
				throw createErr;
			}
		}
	}

	protected async ensureCors(client: S3Client, bucket: string, origins: string[]): Promise<void> {
		await client.send(
			new PutBucketCorsCommand({
				Bucket: bucket,
				CORSConfiguration: {
					CORSRules: [
						{
							ID: 'syr-app',
							AllowedOrigins: origins,
							AllowedMethods: ['GET', 'POST', 'PUT', 'DELETE', 'HEAD'],
							AllowedHeaders: ['*'],
							ExposeHeaders: [
								'ETag',
								'x-amz-version-id',
								'Content-Length',
								'Content-Range',
								'Accept-Ranges'
							],
							MaxAgeSeconds: 3600
						}
					]
				}
			})
		);
		console.log(`S3 bucket "${bucket}" CORS updated for origins: ${origins.join(', ')}`);
	}
}

// ── SeaweedFS Adapter ──

class SeaweedFSStore extends ObjectStore {
	readonly name = 'seaweedfs';
	private _client: S3Client;
	private _publicClient: S3Client;

	constructor() {
		super();
		this._client = new S3Client({
			region: s3.region,
			endpoint: s3.endpoint,
			credentials: { accessKeyId: s3.accessKeyId, secretAccessKey: s3.secretAccessKey },
			forcePathStyle: true,
			requestHandler: new NodeHttpHandler({
				connectionTimeout: 5000,
				requestTimeout: 5000
			})
		});
		this._publicClient = new S3Client({
			region: s3.region,
			endpoint: s3.publicUrl,
			credentials: { accessKeyId: s3.accessKeyId, secretAccessKey: s3.secretAccessKey },
			forcePathStyle: true
		});
	}

	get client() {
		return this._client;
	}
	get publicClient() {
		return this._publicClient;
	}
	get requiresFinalizationRetry() {
		return true;
	}

	async initialize(): Promise<void> {
		await this.ensureBucket(this._client, s3.bucket, s3.region);
		await this.ensureCors(this._client, s3.bucket, s3.corsOrigins);
	}
}

// ── MinIO Adapter ──

class MinIOStore extends ObjectStore {
	readonly name = 'minio';
	private _client: S3Client;
	private _publicClient: S3Client;

	constructor() {
		super();
		// MinIO doesn't support AWS SDK v3's automatic checksum headers
		// (x-amz-checksum-crc32 etc.) — disable them.
		const minioClientConfig = {
			region: s3.region,
			credentials: { accessKeyId: s3.accessKeyId, secretAccessKey: s3.secretAccessKey },
			forcePathStyle: true,
			requestChecksumCalculation: 'WHEN_REQUIRED' as const,
			responseChecksumValidation: 'WHEN_REQUIRED' as const
		};
		this._client = new S3Client({ ...minioClientConfig, endpoint: s3.endpoint });
		this._publicClient = new S3Client({ ...minioClientConfig, endpoint: s3.publicUrl });
	}

	get client() {
		return this._client;
	}
	get publicClient() {
		return this._publicClient;
	}
	get requiresFinalizationRetry() {
		return false;
	}

	async initialize(): Promise<void> {
		try {
			await this.ensureBucket(this._client, s3.bucket, s3.region);
		} catch (err) {
			const code = (err as any)?.Code || (err as any)?.name;
			if (code === 'NotImplemented') {
				console.warn('MinIO: ensureBucket skipped (SDK checksum headers not supported). Ensure bucket exists via mc CLI or MinIO console.');
			} else {
				throw err;
			}
		}

		// MinIO handles CORS natively via MINIO_API_CORS_ALLOW_ORIGIN env var.

		// Set bucket policy for anonymous read on public paths via direct HTTP.
		// The AWS SDK's PutBucketPolicyCommand sends checksum headers MinIO rejects,
		// so we use the S3 REST API directly to bypass the middleware.
		const policy = JSON.stringify({
			Version: '2012-10-17',
			Statement: [
				{
					Sid: 'PublicUploads',
					Effect: 'Allow',
					Principal: '*',
					Action: ['s3:GetObject'],
					Resource: [
						`arn:aws:s3:::${s3.bucket}/uploads/did:syr:*/public/*`,
						`arn:aws:s3:::${s3.bucket}/uploads/did:syr:*/*/public/*`,
						`arn:aws:s3:::${s3.bucket}/instance-media/*/public/*`
					]
				}
			]
		});

		try {
			await this._client.send(
				new PutBucketPolicyCommand({ Bucket: s3.bucket, Policy: policy })
			);
			console.log(`MinIO: public read policy applied to bucket "${s3.bucket}"`);
		} catch (err) {
			const code = (err as any)?.Code || (err as any)?.name;
			if (code === 'NotImplemented') {
				// AWS SDK v3 sends checksum headers MinIO doesn't support on policy ops.
				// Set policy via mc instead:
				//   mc alias set syr http://minio:9000 ACCESS_KEY SECRET_KEY
				//   mc anonymous set-json policy.json syr/BUCKET
				console.warn(`MinIO: PutBucketPolicy not supported via SDK (checksum headers). Set policy via mc CLI.`);
			} else {
				throw err;
			}
		}
	}
}

// ── Factory ──

function createObjectStore(): ObjectStore {
	// Uncomment to auto-switch based on NODE_ENV:
	// const provider = process.env.NODE_ENV === 'production' ? 'minio' : 'seaweedfs';

	const provider = s3.provider;

	if (provider === 'minio') {
		console.log('📦 ObjectStore: MinIO');
		return new MinIOStore();
	}
	console.log('📦 ObjectStore: SeaweedFS');
	return new SeaweedFSStore();
}

export const objectStore = createObjectStore();
