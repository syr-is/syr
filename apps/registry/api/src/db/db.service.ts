import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Surreal } from 'surrealdb';

@Injectable()
export class DbService implements OnModuleDestroy {
	private db: Surreal;
	private connected = false;

	constructor() {
		this.db = new Surreal();
	}

	async connect(): Promise<void> {
		if (this.connected) return;

		const url =
			process.env.REGISTRY_SURREALDB_URL || process.env.SURREALDB_URL || 'ws://localhost:8000/rpc';
		const user = process.env.SURREALDB_USER || 'root';
		const pass = process.env.SURREALDB_PASS || 'syr-dev-password';
		const namespace =
			process.env.REGISTRY_SURREALDB_NAMESPACE || process.env.SURREALDB_NAMESPACE || 'syr';
		const database = process.env.REGISTRY_SURREALDB_DATABASE || 'registry';

		await this.db.connect(url);
		await this.db.signin({ username: user, password: pass });
		await this.db.use({ namespace, database });

		this.connected = true;
		console.log('✅ Registry API connected to SurrealDB');
	}

	async initializeSchema(): Promise<void> {
		await this.db.query(`
      DEFINE TABLE IF NOT EXISTS hosting_record SCHEMAFULL;
      DEFINE FIELD IF NOT EXISTS did ON TABLE hosting_record TYPE string
        ASSERT string::starts_with($value, "did:syr:");
      DEFINE FIELD IF NOT EXISTS provider ON TABLE hosting_record TYPE string;
      DEFINE FIELD IF NOT EXISTS updated_at ON TABLE hosting_record TYPE datetime;
      DEFINE FIELD IF NOT EXISTS signature ON TABLE hosting_record TYPE string;
      DEFINE FIELD IF NOT EXISTS created_at ON TABLE hosting_record TYPE datetime DEFAULT time::now();
      DEFINE INDEX IF NOT EXISTS idx_hosting_did ON TABLE hosting_record COLUMNS did UNIQUE;
    `);
		console.log('✅ Registry API schema initialized');
	}

	getDb(): Surreal {
		if (!this.connected) {
			throw new Error('Registry DB not connected');
		}
		return this.db;
	}

	async disconnect(): Promise<void> {
		if (this.connected) {
			await this.db.close();
			this.connected = false;
		}
	}

	async onModuleDestroy() {
		await this.disconnect();
	}
}
