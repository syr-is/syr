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
				DEFINE FIELD IF NOT EXISTS did ON TABLE user TYPE option<string> ASSERT $value IS NONE OR string::starts_with($value, "did:syr:");
				DEFINE INDEX IF NOT EXISTS idx_user_did ON TABLE user COLUMNS did UNIQUE;
			`);

			// Username change cooldown tracking
			await db.query(`
				DEFINE FIELD IF NOT EXISTS username_last_updated ON TABLE user TYPE option<datetime>;
			`);

			await db.query(`
				DEFINE FIELD IF NOT EXISTS signing_warn_before_each_action ON TABLE user TYPE option<bool>;
				DEFINE FIELD IF NOT EXISTS signing_require_explicit_sign_button ON TABLE user TYPE option<bool>;
				DEFINE FIELD IF NOT EXISTS feed_hide_unsigned_posts ON TABLE user TYPE option<bool>;
				DEFINE FIELD IF NOT EXISTS content_trust_auto_author_provider ON TABLE user TYPE option<bool>;
				DEFINE FIELD IF NOT EXISTS content_trust_allow_data_urls ON TABLE user TYPE option<bool>;
				DEFINE FIELD IF NOT EXISTS content_max_post_bytes ON TABLE user TYPE option<int>;
			`);

			await db.query(`
				DEFINE TABLE IF NOT EXISTS user_content_trust_rule SCHEMAFULL;
				DEFINE FIELD IF NOT EXISTS user_id ON TABLE user_content_trust_rule TYPE record<user>;
				DEFINE FIELD IF NOT EXISTS pattern ON TABLE user_content_trust_rule TYPE string;
				DEFINE FIELD IF NOT EXISTS kind ON TABLE user_content_trust_rule TYPE string
					ASSERT $value IN ['allow', 'deny'];
				DEFINE FIELD IF NOT EXISTS sort_order ON TABLE user_content_trust_rule TYPE int;
				DEFINE FIELD IF NOT EXISTS created_at ON TABLE user_content_trust_rule TYPE datetime;
				DEFINE INDEX IF NOT EXISTS idx_uctr_user ON TABLE user_content_trust_rule COLUMNS user_id;
			`);

			await db.query(`
				DEFINE FIELD IF NOT EXISTS content_signature ON TABLE profile TYPE option<string>;
				DEFINE FIELD IF NOT EXISTS signed_payload_json ON TABLE profile TYPE option<string>;
				DEFINE FIELD IF NOT EXISTS signing_device_public_key ON TABLE profile TYPE option<string>;
				DEFINE FIELD IF NOT EXISTS identity_host_url ON TABLE profile TYPE option<string>;
			`);

			await db.query(`
				DEFINE FIELD IF NOT EXISTS is_story ON TABLE upload TYPE option<bool>;
				DEFINE FIELD IF NOT EXISTS published_at ON TABLE upload TYPE option<datetime>;
			`);

			await db.query(`
				DEFINE FIELD IF NOT EXISTS content_signature ON TABLE post TYPE option<string>;
				DEFINE FIELD IF NOT EXISTS signed_payload_json ON TABLE post TYPE option<string>;
				DEFINE FIELD IF NOT EXISTS signing_device_public_key ON TABLE post TYPE option<string>;
			`);

			await db.query(`
				DEFINE TABLE IF NOT EXISTS user_follow SCHEMAFULL;
				DEFINE FIELD IF NOT EXISTS follower_user_id ON TABLE user_follow TYPE record<user>;
				DEFINE FIELD IF NOT EXISTS followed_did ON TABLE user_follow TYPE string
					ASSERT string::starts_with($value, "did:syr:");
				DEFINE FIELD IF NOT EXISTS source_registry ON TABLE user_follow TYPE option<string>;
				DEFINE FIELD IF NOT EXISTS followed_provider_url ON TABLE user_follow TYPE option<string>;
				DEFINE FIELD IF NOT EXISTS created_at ON TABLE user_follow TYPE datetime;
			`);

			// Backfill is_public for existing rows before enforcing the type
			await db.query(`
				UPDATE user_follow SET is_public = false WHERE is_public IS NONE;
			`);

			await db.query(`
				DEFINE FIELD IF NOT EXISTS is_public ON TABLE user_follow TYPE bool DEFAULT false;
				DEFINE INDEX IF NOT EXISTS idx_follow_follower ON TABLE user_follow COLUMNS follower_user_id;
				DEFINE INDEX IF NOT EXISTS idx_follow_followed ON TABLE user_follow COLUMNS followed_did;
				REMOVE INDEX IF EXISTS idx_follow_unique ON TABLE user_follow;
				DEFINE INDEX IF NOT EXISTS idx_follow_unique ON TABLE user_follow COLUMNS follower_user_id, followed_did, followed_provider_url UNIQUE;
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
			// Aegis (CIGP) fields store password-encrypted seed
			await db.query(`
				DEFINE TABLE IF NOT EXISTS identity SCHEMAFULL;
				DEFINE FIELD IF NOT EXISTS did ON TABLE identity TYPE string
					ASSERT string::starts_with($value, "did:syr:");
				DEFINE FIELD IF NOT EXISTS public_key ON TABLE identity TYPE string;
				DEFINE FIELD IF NOT EXISTS user_id ON TABLE identity TYPE record<user>;
				DEFINE FIELD IF NOT EXISTS created_at ON TABLE identity TYPE datetime;
				DEFINE FIELD IF NOT EXISTS aegis_salt ON TABLE identity TYPE option<string>;
				DEFINE FIELD IF NOT EXISTS aegis_nonce ON TABLE identity TYPE option<string>;
				DEFINE FIELD IF NOT EXISTS aegis_ct ON TABLE identity TYPE option<string>;
				DEFINE FIELD IF NOT EXISTS aegis_tag ON TABLE identity TYPE option<string>;
				DEFINE FIELD IF NOT EXISTS aegis_kdf_mem ON TABLE identity TYPE option<int>;
				DEFINE FIELD IF NOT EXISTS aegis_kdf_it ON TABLE identity TYPE option<int>;
				DEFINE FIELD IF NOT EXISTS aegis_kdf_par ON TABLE identity TYPE option<int>;
				DEFINE INDEX IF NOT EXISTS idx_identity_did ON TABLE identity COLUMNS did UNIQUE;
				DEFINE INDEX IF NOT EXISTS idx_identity_user ON TABLE identity COLUMNS user_id UNIQUE;
			`);

			// Delegated keys table: stores device delegations
			await db.query(`
				DEFINE TABLE IF NOT EXISTS delegated_key SCHEMAFULL;
				DEFINE FIELD IF NOT EXISTS did ON TABLE delegated_key TYPE string
					ASSERT string::starts_with($value, "did:syr:");
				DEFINE FIELD IF NOT EXISTS public_key ON TABLE delegated_key TYPE string;
				DEFINE FIELD IF NOT EXISTS scope ON TABLE delegated_key TYPE string DEFAULT "device";
				DEFINE FIELD IF NOT EXISTS created_at ON TABLE delegated_key TYPE datetime;
				DEFINE FIELD IF NOT EXISTS expires_at ON TABLE delegated_key TYPE option<datetime>;
				DEFINE FIELD IF NOT EXISTS revoked_at ON TABLE delegated_key TYPE option<datetime>;
				DEFINE FIELD IF NOT EXISTS signature ON TABLE delegated_key TYPE string;
				DEFINE FIELD IF NOT EXISTS canonical_delegation ON TABLE delegated_key TYPE option<string>;
				DEFINE FIELD IF NOT EXISTS platform_origin ON TABLE delegated_key TYPE option<string>;
				DEFINE FIELD IF NOT EXISTS platform_name ON TABLE delegated_key TYPE option<string>;
				DEFINE FIELD IF NOT EXISTS aegis_delegate ON TABLE delegated_key FLEXIBLE TYPE option<object>;
				DEFINE INDEX IF NOT EXISTS idx_dk_pubkey ON TABLE delegated_key COLUMNS public_key UNIQUE;
				DEFINE INDEX IF NOT EXISTS idx_dk_did ON TABLE delegated_key COLUMNS did;
				DEFINE INDEX IF NOT EXISTS idx_dk_platform ON TABLE delegated_key COLUMNS did, platform_origin;
			`);

			// Outbox table: durable job queue for external service communication
			await db.query(`
				DEFINE TABLE IF NOT EXISTS outbox SCHEMAFULL;
				DEFINE FIELD IF NOT EXISTS type ON TABLE outbox TYPE string;
				DEFINE FIELD IF NOT EXISTS payload ON TABLE outbox FLEXIBLE TYPE object;
				DEFINE FIELD IF NOT EXISTS status ON TABLE outbox TYPE string DEFAULT "pending";
				DEFINE FIELD IF NOT EXISTS attempts ON TABLE outbox TYPE int DEFAULT 0;
				DEFINE FIELD IF NOT EXISTS max_attempts ON TABLE outbox TYPE int DEFAULT 10;
				DEFINE FIELD IF NOT EXISTS next_retry_at ON TABLE outbox TYPE datetime;
				DEFINE FIELD IF NOT EXISTS last_error ON TABLE outbox TYPE option<string>;
				DEFINE FIELD IF NOT EXISTS user_id ON TABLE outbox TYPE record<user>;
				DEFINE FIELD IF NOT EXISTS created_at ON TABLE outbox TYPE datetime;
				DEFINE FIELD IF NOT EXISTS updated_at ON TABLE outbox TYPE datetime;
				DEFINE INDEX IF NOT EXISTS idx_outbox_status_retry ON TABLE outbox COLUMNS status, next_retry_at;
				DEFINE INDEX IF NOT EXISTS idx_outbox_user ON TABLE outbox COLUMNS user_id;
			`);

			// Identity registry table: tracks which registries a user has listed their DID on
			await db.query(`
				DEFINE TABLE IF NOT EXISTS identity_registry SCHEMAFULL;
				DEFINE FIELD IF NOT EXISTS identity_did ON TABLE identity_registry TYPE string;
				DEFINE FIELD IF NOT EXISTS registry_url ON TABLE identity_registry TYPE string;
				DEFINE FIELD IF NOT EXISTS status ON TABLE identity_registry TYPE string DEFAULT "pending";
				DEFINE FIELD IF NOT EXISTS last_synced_at ON TABLE identity_registry TYPE option<datetime>;
				DEFINE FIELD IF NOT EXISTS created_at ON TABLE identity_registry TYPE datetime;
				DEFINE INDEX IF NOT EXISTS idx_ir_did ON TABLE identity_registry COLUMNS identity_did;
				DEFINE INDEX IF NOT EXISTS idx_ir_unique ON TABLE identity_registry COLUMNS identity_did, registry_url UNIQUE;
			`);

			// Discovery registry: account-scoped URLs used for directory search and follow gating (not publication)
			await db.query(`
				DEFINE TABLE IF NOT EXISTS discovery_registry SCHEMAFULL;
				DEFINE FIELD IF NOT EXISTS user_id ON TABLE discovery_registry TYPE record<user>;
				DEFINE FIELD IF NOT EXISTS registry_url ON TABLE discovery_registry TYPE string;
				DEFINE FIELD IF NOT EXISTS created_at ON TABLE discovery_registry TYPE datetime;
				DEFINE INDEX IF NOT EXISTS idx_dr_user ON TABLE discovery_registry COLUMNS user_id;
				DEFINE INDEX IF NOT EXISTS idx_dr_unique ON TABLE discovery_registry COLUMNS user_id, registry_url UNIQUE;
			`);

			// Instance-wide discovery registries (admin): resolve remote DIDs for /u and public proxy
			await db.query(`
				DEFINE TABLE IF NOT EXISTS instance_discovery_registry SCHEMAFULL;
				DEFINE FIELD IF NOT EXISTS registry_url ON TABLE instance_discovery_registry TYPE string;
				DEFINE FIELD IF NOT EXISTS created_at ON TABLE instance_discovery_registry TYPE datetime;
				DEFINE INDEX IF NOT EXISTS idx_idr_url ON TABLE instance_discovery_registry COLUMNS registry_url UNIQUE;
			`);

			// Emoji pack table (instance-level, simple auto-ID)
			await db.query(`
				DEFINE TABLE IF NOT EXISTS emoji_pack SCHEMAFULL;
				DEFINE FIELD IF NOT EXISTS slug ON TABLE emoji_pack TYPE string;
				DEFINE FIELD IF NOT EXISTS name ON TABLE emoji_pack TYPE string;
				DEFINE FIELD IF NOT EXISTS description ON TABLE emoji_pack TYPE option<string>;
				DEFINE FIELD IF NOT EXISTS created_by ON TABLE emoji_pack TYPE record<user>;
				DEFINE FIELD IF NOT EXISTS created_at ON TABLE emoji_pack TYPE datetime;
				DEFINE FIELD IF NOT EXISTS updated_at ON TABLE emoji_pack TYPE datetime;
				DEFINE INDEX IF NOT EXISTS idx_emoji_pack_slug ON TABLE emoji_pack COLUMNS slug UNIQUE;
			`);

			// Emoji table (composite ID: { created_by: did, id: ulid })
			await db.query(`
				DEFINE TABLE IF NOT EXISTS emoji SCHEMAFULL;
				DEFINE FIELD IF NOT EXISTS shortcode ON TABLE emoji TYPE string;
				DEFINE FIELD IF NOT EXISTS url ON TABLE emoji TYPE string;
				DEFINE FIELD IF NOT EXISTS mime_type ON TABLE emoji TYPE string;
				DEFINE FIELD IF NOT EXISTS size ON TABLE emoji TYPE int;
				DEFINE FIELD IF NOT EXISTS is_sticker ON TABLE emoji TYPE bool DEFAULT false;
				DEFINE FIELD IF NOT EXISTS pack_slug ON TABLE emoji TYPE option<string>;
				DEFINE FIELD IF NOT EXISTS scope ON TABLE emoji TYPE string
					ASSERT $value IN ['instance', 'user'];
				DEFINE FIELD IF NOT EXISTS author_id ON TABLE emoji TYPE record<user>;
				DEFINE FIELD IF NOT EXISTS created_at ON TABLE emoji TYPE datetime;
				DEFINE FIELD IF NOT EXISTS updated_at ON TABLE emoji TYPE datetime;
				DEFINE INDEX IF NOT EXISTS idx_emoji_pack ON TABLE emoji COLUMNS pack_slug;
				DEFINE INDEX IF NOT EXISTS idx_emoji_author ON TABLE emoji COLUMNS author_id;
			`);

			// GIF table (composite ID: { created_by: did, id: ulid })
			await db.query(`
				DEFINE TABLE IF NOT EXISTS gif SCHEMAFULL;
				DEFINE FIELD IF NOT EXISTS url ON TABLE gif TYPE string;
				DEFINE FIELD IF NOT EXISTS thumbnail_url ON TABLE gif TYPE option<string>;
				DEFINE FIELD IF NOT EXISTS mime_type ON TABLE gif TYPE string;
				DEFINE FIELD IF NOT EXISTS size ON TABLE gif TYPE int;
				DEFINE FIELD IF NOT EXISTS scope ON TABLE gif TYPE string
					ASSERT $value IN ['instance', 'user'];
				DEFINE FIELD IF NOT EXISTS tags ON TABLE gif TYPE array<string> DEFAULT [];
				DEFINE FIELD IF NOT EXISTS author_id ON TABLE gif TYPE record<user>;
				DEFINE FIELD IF NOT EXISTS created_at ON TABLE gif TYPE datetime;
				DEFINE FIELD IF NOT EXISTS updated_at ON TABLE gif TYPE datetime;
				DEFINE INDEX IF NOT EXISTS idx_gif_scope ON TABLE gif COLUMNS scope;
				DEFINE INDEX IF NOT EXISTS idx_gif_author ON TABLE gif COLUMNS author_id;
			`);

			// Comment table (composite ID: { created_by: did, id: ulid })
			// Migration: drop deprecated parent_type/parent_did/parent_id fields and old index
			await db.query(`
				REMOVE FIELD IF EXISTS parent_type ON TABLE comment;
				REMOVE FIELD IF EXISTS parent_did ON TABLE comment;
				REMOVE FIELD IF EXISTS parent_id ON TABLE comment;
				REMOVE INDEX IF EXISTS idx_comment_parent ON TABLE comment;
			`);
			await db.query(`
				DEFINE TABLE IF NOT EXISTS comment SCHEMAFULL;
				DEFINE FIELD IF NOT EXISTS post_did ON TABLE comment TYPE string;
				DEFINE FIELD IF NOT EXISTS post_id ON TABLE comment TYPE string;
				DEFINE FIELD IF NOT EXISTS ancestor_chain ON TABLE comment TYPE array<string> DEFAULT [];
				DEFINE FIELD IF NOT EXISTS content ON TABLE comment TYPE string;
				DEFINE FIELD IF NOT EXISTS visibility ON TABLE comment TYPE string
					ASSERT $value IN ['public', 'unlisted', 'private'];
				DEFINE FIELD IF NOT EXISTS status ON TABLE comment TYPE string
					ASSERT $value IN ['draft', 'completed'];
				DEFINE FIELD IF NOT EXISTS author_id ON TABLE comment TYPE record<user>;
				DEFINE FIELD IF NOT EXISTS created_at ON TABLE comment TYPE datetime;
				DEFINE FIELD IF NOT EXISTS updated_at ON TABLE comment TYPE datetime;
				DEFINE FIELD IF NOT EXISTS content_signature ON TABLE comment TYPE option<string>;
				DEFINE FIELD IF NOT EXISTS signed_payload_json ON TABLE comment TYPE option<string>;
				DEFINE FIELD IF NOT EXISTS signing_device_public_key ON TABLE comment TYPE option<string>;
				DEFINE INDEX IF NOT EXISTS idx_comment_post ON TABLE comment COLUMNS post_did, post_id;
				DEFINE INDEX IF NOT EXISTS idx_comment_author ON TABLE comment COLUMNS author_id;
			`);

			// Reaction table (composite ID: { created_by: did, id: ulid })
			await db.query(`
				DEFINE TABLE IF NOT EXISTS reaction SCHEMAFULL;
				DEFINE FIELD IF NOT EXISTS parent_type ON TABLE reaction TYPE string
					ASSERT $value IN ['post', 'comment'];
				DEFINE FIELD IF NOT EXISTS parent_did ON TABLE reaction TYPE string;
				DEFINE FIELD IF NOT EXISTS parent_id ON TABLE reaction TYPE string;
				DEFINE FIELD IF NOT EXISTS kind ON TABLE reaction TYPE string
					ASSERT $value IN ['unicode', 'custom_emoji', 'sticker', 'gif'];
				DEFINE FIELD IF NOT EXISTS value ON TABLE reaction TYPE string;
				DEFINE FIELD IF NOT EXISTS image_url ON TABLE reaction TYPE option<string>;
				DEFINE FIELD IF NOT EXISTS author_id ON TABLE reaction TYPE record<user>;
				DEFINE FIELD IF NOT EXISTS created_at ON TABLE reaction TYPE datetime;
				DEFINE FIELD IF NOT EXISTS updated_at ON TABLE reaction TYPE datetime;
				DEFINE FIELD IF NOT EXISTS content_signature ON TABLE reaction TYPE option<string>;
				DEFINE FIELD IF NOT EXISTS signed_payload_json ON TABLE reaction TYPE option<string>;
				DEFINE FIELD IF NOT EXISTS signing_device_public_key ON TABLE reaction TYPE option<string>;
				DEFINE INDEX IF NOT EXISTS idx_reaction_parent ON TABLE reaction COLUMNS parent_type, parent_did, parent_id;
				DEFINE INDEX IF NOT EXISTS idx_reaction_author ON TABLE reaction COLUMNS author_id;
				DEFINE INDEX IF NOT EXISTS idx_reaction_unique ON TABLE reaction COLUMNS author_id, parent_type, parent_did, parent_id, kind, value UNIQUE;
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
