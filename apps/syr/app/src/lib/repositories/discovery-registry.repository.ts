import { dbService } from '$lib/services/db';
import { stringToRecordId } from '@syr-is/types';
import type { RecordId } from 'surrealdb';

export interface DiscoveryRegistry {
	id: RecordId;
	user_id: RecordId;
	registry_url: string;
	created_at: string;
}

class DiscoveryRegistryRepository {
	private get db() {
		return dbService.getDb();
	}

	private userRecordId(userId: RecordId | string): RecordId {
		return typeof userId === 'string' ? stringToRecordId.decode(userId) : userId;
	}

	async add(userId: RecordId | string, registryUrl: string): Promise<DiscoveryRegistry> {
		const uid = this.userRecordId(userId);
		const now = new Date();
		const result = await this.db.query<[DiscoveryRegistry[]]>(
			`CREATE discovery_registry SET
				user_id = $userId,
				registry_url = $registryUrl,
				created_at = $now`,
			{ userId: uid, registryUrl, now }
		);
		return result[0][0];
	}

	async remove(id: RecordId): Promise<void> {
		await this.db.query('DELETE FROM discovery_registry WHERE id = $id', { id });
	}

	async findByUserId(userId: RecordId | string): Promise<DiscoveryRegistry[]> {
		const uid = this.userRecordId(userId);
		const result = await this.db.query<[DiscoveryRegistry[]]>(
			'SELECT * FROM discovery_registry WHERE user_id = $userId ORDER BY created_at ASC',
			{ userId: uid }
		);
		return result[0] ?? [];
	}

	async findById(id: RecordId): Promise<DiscoveryRegistry | null> {
		const result = await this.db.query<[DiscoveryRegistry[]]>(
			'SELECT * FROM discovery_registry WHERE id = $id LIMIT 1',
			{ id }
		);
		return result[0]?.[0] ?? null;
	}

	async findByUserIdAndUrl(
		userId: RecordId | string,
		registryUrl: string
	): Promise<DiscoveryRegistry | null> {
		const uid = this.userRecordId(userId);
		const result = await this.db.query<[DiscoveryRegistry[]]>(
			'SELECT * FROM discovery_registry WHERE user_id = $userId AND registry_url = $registryUrl LIMIT 1',
			{ userId: uid, registryUrl }
		);
		return result[0]?.[0] ?? null;
	}

	async deleteAllForUser(userId: RecordId | string): Promise<void> {
		const uid = this.userRecordId(userId);
		await this.db.query('DELETE FROM discovery_registry WHERE user_id = $userId', { userId: uid });
	}
}

export const discoveryRegistryRepository = new DiscoveryRegistryRepository();
