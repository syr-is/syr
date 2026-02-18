import { UploadSchema, type Upload } from '@syr-is/types';
import { BaseRepository } from './base.repository';

export class UploadRepository extends BaseRepository<Upload> {
	protected tableName = 'upload';
	protected schema = UploadSchema;

	/**
	 * Find all uploads by DID (composite id.created_by).
	 * Used for export-bundle when owner_id filter may not match.
	 */
	async findByDid(did: string): Promise<Upload[]> {
		const result = await this.db.query<[Upload[]]>(
			`SELECT * FROM upload WHERE id.created_by = $did ORDER BY created_at DESC`,
			{ did }
		);
		const raw = result[0] ?? [];
		return raw.map((r) => this.validate(r));
	}
}

export const uploadRepository = new UploadRepository();
