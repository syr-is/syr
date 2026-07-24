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
      DEFINE FIELD IF NOT EXISTS rotation_chain ON TABLE hosting_record TYPE option<array>;
      -- Each element is a rotation statement (an object). On a SCHEMAFULL table the
      -- array-element schema must be declared FLEXIBLE, otherwise cleanup_table_fields
      -- strips every nested key and the chain round-trips to a list of empty objects,
      -- making rotated identities unresolvable. Same recipe the syr app uses for its
      -- FLEXIBLE object fields.
      DEFINE FIELD IF NOT EXISTS rotation_chain.* ON TABLE hosting_record FLEXIBLE TYPE object;
      DEFINE FIELD IF NOT EXISTS created_at ON TABLE hosting_record TYPE datetime DEFAULT time::now();
      DEFINE INDEX IF NOT EXISTS idx_hosting_did ON TABLE hosting_record COLUMNS did UNIQUE;

      DEFINE TABLE IF NOT EXISTS did_rotation_state SCHEMAFULL;
      DEFINE FIELD IF NOT EXISTS did ON TABLE did_rotation_state TYPE string
        ASSERT string::starts_with($value, "did:syr:");
      DEFINE FIELD IF NOT EXISTS max_seq ON TABLE did_rotation_state TYPE int;
      -- Committed rotation chain (prefix pinning): the incoming chain must
      -- exactly extend this, so forks with the same/greater seq are rejected.
      -- FLEXIBLE per element for the same reason hosting_record.rotation_chain is:
      -- otherwise cleanup_table_fields strips nested keys and the chain round-trips
      -- to empty objects, defeating the prefix comparison.
      DEFINE FIELD IF NOT EXISTS chain ON TABLE did_rotation_state TYPE option<array>;
      DEFINE FIELD IF NOT EXISTS chain.* ON TABLE did_rotation_state FLEXIBLE TYPE object;
      DEFINE FIELD IF NOT EXISTS updated_at ON TABLE did_rotation_state TYPE datetime;
      DEFINE INDEX IF NOT EXISTS idx_rotation_state_did ON TABLE did_rotation_state COLUMNS did UNIQUE;

      DEFINE TABLE IF NOT EXISTS directory_entry SCHEMAFULL;
      DEFINE FIELD IF NOT EXISTS did ON TABLE directory_entry TYPE string
        ASSERT string::starts_with($value, "did:syr:");
      DEFINE FIELD IF NOT EXISTS provider ON TABLE directory_entry TYPE string;
      DEFINE FIELD IF NOT EXISTS username ON TABLE directory_entry TYPE string;
      DEFINE FIELD IF NOT EXISTS display_name ON TABLE directory_entry TYPE string;
      DEFINE FIELD IF NOT EXISTS listed ON TABLE directory_entry TYPE bool;
      DEFINE FIELD IF NOT EXISTS updated_at ON TABLE directory_entry TYPE datetime;
      DEFINE FIELD IF NOT EXISTS signature ON TABLE directory_entry TYPE string;
      DEFINE INDEX IF NOT EXISTS idx_directory_did ON TABLE directory_entry COLUMNS did UNIQUE;
      DEFINE INDEX IF NOT EXISTS idx_directory_listed ON TABLE directory_entry COLUMNS listed;
      DEFINE INDEX IF NOT EXISTS idx_directory_username ON TABLE directory_entry COLUMNS username;
      DEFINE INDEX IF NOT EXISTS idx_directory_display_name ON TABLE directory_entry COLUMNS display_name;
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
