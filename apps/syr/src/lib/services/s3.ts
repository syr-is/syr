import { S3Client } from '@aws-sdk/client-s3';
import { s3 } from '$lib/config';

class S3Service {
	private static instance: S3Service;
	private _client: S3Client;
	private connected: boolean = false;

	private constructor() {
		this._client = new S3Client({
			region: s3.region,
			endpoint: s3.endpoint,
			credentials: {
				accessKeyId: s3.accessKeyId,
				secretAccessKey: s3.secretAccessKey
			},
			forcePathStyle: true
		});
	}

	public get client(): S3Client {
		return this._client;
	}

	public static getInstance(): S3Service {
		if (!S3Service.instance) {
			S3Service.instance = new S3Service();
		}
		return S3Service.instance;
	}
}

export const s3Service = S3Service.getInstance();
