import { Surreal } from 'surrealdb';
import { db } from '$lib/config';

/**
 * SurrealDB Singleton Service
 * Provides a pooled connection to SurrealDB
 */
class DatabaseService {
	private static instance: DatabaseService;
	private db: Surreal;
	private connected: boolean = false;

	private constructor() {
		this.db = new Surreal();
	}

	/**
	 * Get the singleton instance
	 */
	public static getInstance(): DatabaseService {
		if (!DatabaseService.instance) {
			DatabaseService.instance = new DatabaseService();
		}
		return DatabaseService.instance;
	}

	/**
	 * Connect to SurrealDB
	 */
	public async connect(): Promise<void> {
		if (this.connected) {
			return;
		}

		try {
			await this.db.connect(db.url);
			await this.db.signin({
				username: db.user,
				password: db.password
			});
			await this.db.use({
				namespace: db.namespace,
				database: db.database
			});

			this.connected = true;
			console.log('✅ Connected to SurrealDB');
		} catch (error) {
			console.error('❌ Failed to connect to SurrealDB:', error);
			throw error;
		}
	}

	/**
	 * Get the SurrealDB instance
	 */
	public getDb(): Surreal {
		if (!this.connected) {
			throw new Error('Database not connected. Call connect() first.');
		}
		return this.db;
	}

	/**
	 * Disconnect from SurrealDB
	 */
	public async disconnect(): Promise<void> {
		if (this.connected) {
			await this.db.close();
			this.connected = false;
			console.log('Disconnected from SurrealDB');
		}
	}

	/**
	 * Initialize database schema and indexes
	 */
	public async initializeSchema(): Promise<void> {
		const db = this.getDb();

		try {
			// Define indexes for user table (IF NOT EXISTS)
			await db.query(`
				DEFINE INDEX IF NOT EXISTS unique_username ON TABLE user COLUMNS username UNIQUE;
			`);

			// Add optional DID field to user table
			await db.query(`
				DEFINE FIELD IF NOT EXISTS did ON TABLE user TYPE option<string>;
				DEFINE INDEX IF NOT EXISTS idx_user_did ON TABLE user COLUMNS did UNIQUE;
			`);

			// Define index for profile lookup by user_id
			await db.query(`
				DEFINE INDEX IF NOT EXISTS profile_user_id ON TABLE profile COLUMNS user_id UNIQUE;
			`);

			// Define index for session lookup
			await db.query(`
				DEFINE INDEX IF NOT EXISTS session_token ON TABLE session COLUMNS token UNIQUE;
				DEFINE INDEX IF NOT EXISTS session_user_id ON TABLE session COLUMNS user_id;
			`);

			// Identity table: stores root identity metadata
			await db.query(`
				DEFINE TABLE IF NOT EXISTS identity SCHEMAFULL;
				DEFINE FIELD IF NOT EXISTS did ON TABLE identity TYPE string
					ASSERT string::starts_with($value, "did:syr:");
				DEFINE FIELD IF NOT EXISTS public_key ON TABLE identity TYPE string;
				DEFINE FIELD IF NOT EXISTS user_id ON TABLE identity TYPE record<user>;
				DEFINE FIELD IF NOT EXISTS created_at ON TABLE identity TYPE datetime;
				DEFINE INDEX IF NOT EXISTS idx_identity_did ON TABLE identity COLUMNS did UNIQUE;
				DEFINE INDEX IF NOT EXISTS idx_identity_user ON TABLE identity COLUMNS user_id UNIQUE;
			`);

			// Delegated keys table: stores device delegations
			await db.query(`
				DEFINE TABLE IF NOT EXISTS delegated_key SCHEMAFULL;
				DEFINE FIELD IF NOT EXISTS did ON TABLE delegated_key TYPE string;
				DEFINE FIELD IF NOT EXISTS public_key ON TABLE delegated_key TYPE string;
				DEFINE FIELD IF NOT EXISTS scope ON TABLE delegated_key TYPE string DEFAULT "device";
				DEFINE FIELD IF NOT EXISTS created_at ON TABLE delegated_key TYPE datetime;
				DEFINE FIELD IF NOT EXISTS expires_at ON TABLE delegated_key TYPE option<datetime>;
				DEFINE FIELD IF NOT EXISTS revoked_at ON TABLE delegated_key TYPE option<datetime>;
				DEFINE FIELD IF NOT EXISTS signature ON TABLE delegated_key TYPE string;
				DEFINE INDEX IF NOT EXISTS idx_dk_pubkey ON TABLE delegated_key COLUMNS public_key UNIQUE;
				DEFINE INDEX IF NOT EXISTS idx_dk_did ON TABLE delegated_key COLUMNS did;
			`);

			console.log('✅ Database schema initialized');
		} catch (error) {
			console.error('Schema initialization error:', error);
			throw error;
		}
	}
}

// Export singleton instance
export const dbService = DatabaseService.getInstance();
