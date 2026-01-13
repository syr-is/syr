import { UploadSchema, type Upload } from '@syr-is/types';
import { BaseRepository } from './base.repository';

export class UploadRepository extends BaseRepository<Upload> {
	protected tableName = 'upload';
	protected schema = UploadSchema;
}

export const uploadRepository = new UploadRepository();
