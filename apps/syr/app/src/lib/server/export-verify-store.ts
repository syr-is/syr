import { independentLogin } from '$lib/config';
import { kvService } from '$lib/services/kv';

const KV_EXPORT_CHALLENGE = 'identity_export_challenge';
const KV_IMPORT_CHALLENGE = 'identity_import_challenge';
const KV_DELETE_AEGIS_CHALLENGE = 'identity_delete_aegis_challenge';
const KV_DELETE_ACCOUNT_CHALLENGE = 'identity_delete_account_challenge';
const KV_IMPORT_CHALLENGE_PUBLIC = 'identity_import_challenge_public';
const KV_EXPORT_TOKEN = 'identity_export_token';
const KV_EXPORT_SIGNING_SESSION = 'identity_export_signing_session';
const KV_EXPORT_SIGNED_BUNDLE = 'identity_export_signed_bundle';
const KV_IMPORT_TOKEN = 'identity_import_token';
const KV_PUBLIC_IMPORT_TOKEN = 'identity_public_import_token';
const KV_DELETE_AEGIS_TOKEN = 'identity_delete_aegis_token';
const KV_DELETE_ACCOUNT_TOKEN = 'identity_delete_account_token';
const KV_SIGIL_HANDOFF_SESSION = 'user_sigil_handoff_session';
const KV_POST_SIGN_SESSION = 'user_post_sign_session';
const KV_REGISTRY_SIGN_SESSION = 'user_registry_sign_session';

/** Longer than typical login challenges so the user can scan, unlock Syner, and upload. */
const SIGIL_HANDOFF_TTL_SEC = 300;

const POST_SIGN_TTL_SEC = 300;

const CHALLENGE_TTL = independentLogin.challengeTtl;
const TOKEN_TTL = independentLogin.callbackTokenTtl;

export type VerifyPurpose = 'export' | 'import';

export interface ExportChallengeData {
	message: string;
	domain: string;
	expected_did: string;
	created_at: number;
}

export interface ImportChallengeData {
	message: string;
	domain: string;
	expected_did: string;
	user_id: string;
	created_at: number;
}

// --- Export challenge ---

export async function setExportChallenge(
	id: string,
	data: Omit<ExportChallengeData, 'created_at'>
): Promise<void> {
	const full: ExportChallengeData = {
		...data,
		created_at: Date.now()
	};
	await kvService.set(KV_EXPORT_CHALLENGE, id, full, CHALLENGE_TTL);
}

export async function getExportChallenge(id: string): Promise<ExportChallengeData | null> {
	return kvService.get<ExportChallengeData>(KV_EXPORT_CHALLENGE, id);
}

export async function deleteExportChallenge(id: string): Promise<void> {
	await kvService.delete(KV_EXPORT_CHALLENGE, id);
}

/** Atomically get and delete export challenge. Prevents concurrent replay. */
export async function consumeExportChallenge(id: string): Promise<ExportChallengeData | null> {
	return kvService.getAndDelete<ExportChallengeData>(KV_EXPORT_CHALLENGE, id);
}

// --- Export token ---

export async function setExportToken(token: string, userId: string): Promise<void> {
	await kvService.set(KV_EXPORT_TOKEN, token, { user_id: userId }, TOKEN_TTL);
}

/** Validate token and return userId without consuming. Use consumeExportToken after success. */
export function peekExportToken(token: string): Promise<string | null> {
	return kvService.get<{ user_id: string }>(KV_EXPORT_TOKEN, token).then((e) => e?.user_id ?? null);
}

export function consumeExportToken(token: string): Promise<string | null> {
	return kvService
		.getAndDelete<{ user_id: string }>(KV_EXPORT_TOKEN, token)
		.then((entry) => entry?.user_id ?? null);
}

// --- Export signing session (chunked post/asset signing) ---

export type ExportSigningSessionExportData = {
	manifest: {
		version: number;
		did: string;
		exportedAt: string;
		postCount: number;
		assetCount: number;
	};
	identityBundle: Record<string, unknown>;
	exportedPosts: Array<Record<string, unknown>>;
	exportedAssets: Array<Record<string, unknown> & { zip_path: string; content_base64?: string }>;
	skippedAssets: Array<{ zip_path: string; url?: string; reason?: string }>;
	pinnedPostIds: string[];
};

/** Cached signable item for chunked signing. Matches SignableItem from export-signing. */
export type CachedSignableItem = { id: string; message: string };

export interface ExportSigningSession {
	challenge_id: string;
	user_id: string;
	did: string;
	export_data: ExportSigningSessionExportData;
	signatures: Record<string, string>;
	cursor: number;
	created_at: number;
	/** Flat list of item ids in order (post:0, post:0:asset:0, asset:0, ...) */
	all_item_ids: string[];
	/** Pre-built signable items to avoid recomputing on each chunk (performance) */
	all_signable_items?: CachedSignableItem[];
	/** Version for optimistic locking; incremented on each update */
	version: number;
	/** Set to true when all signatures are received and the bundle is finalized */
	finalized?: boolean;
}

const SIGNING_SESSION_TTL = 600; // 10 minutes for chunked signing

export async function setExportSigningSession(
	id: string,
	data: Omit<ExportSigningSession, 'created_at' | 'version'>
): Promise<void> {
	const full: ExportSigningSession = {
		...data,
		version: 1,
		created_at: Date.now()
	};
	await kvService.set(KV_EXPORT_SIGNING_SESSION, id, full, SIGNING_SESSION_TTL);
}

export async function getExportSigningSession(id: string): Promise<ExportSigningSession | null> {
	return kvService.get<ExportSigningSession>(KV_EXPORT_SIGNING_SESSION, id);
}

const MAX_UPDATE_RETRIES = 3;

export async function updateExportSigningSession(
	id: string,
	updater: (session: ExportSigningSession) => ExportSigningSession
): Promise<ExportSigningSession | null> {
	for (let attempt = 0; attempt < MAX_UPDATE_RETRIES; attempt++) {
		const current = await getExportSigningSession(id);
		if (!current) return null;
		const expectedVersion = current.version ?? 1;
		const updated = updater(current);
		(updated as ExportSigningSession).version = expectedVersion + 1;
		const success = await kvService.updateValueIfVersionMatch(
			KV_EXPORT_SIGNING_SESSION,
			id,
			expectedVersion,
			updated,
			SIGNING_SESSION_TTL
		);
		if (success) return updated;
	}
	return null;
}

// --- Export signed bundle (pre-assembled signed export) ---

export async function setExportSignedBundle(
	token: string,
	bundle: {
		manifest: ExportSigningSessionExportData['manifest'];
		identity: ExportSigningSessionExportData['identityBundle'];
		posts: Array<Record<string, unknown>>;
		assets: Array<Record<string, unknown>>;
		pinned_posts: { post_ids: string[] };
	}
): Promise<void> {
	await kvService.set(KV_EXPORT_SIGNED_BUNDLE, token, bundle, TOKEN_TTL);
}

/** Peek signed bundle without consuming. Returns null if not a signed-bundle token. */
export async function peekExportSignedBundle(token: string): Promise<{
	manifest: ExportSigningSessionExportData['manifest'];
	identity: ExportSigningSessionExportData['identityBundle'];
	posts: Array<Record<string, unknown>>;
	assets: Array<Record<string, unknown>>;
	pinned_posts: { post_ids: string[] };
} | null> {
	return kvService.get(KV_EXPORT_SIGNED_BUNDLE, token);
}

/** Consume signed bundle (one-time use). Returns null if already used or expired. */
export async function consumeExportSignedBundle(token: string): Promise<{
	manifest: ExportSigningSessionExportData['manifest'];
	identity: ExportSigningSessionExportData['identityBundle'];
	posts: Array<Record<string, unknown>>;
	assets: Array<Record<string, unknown>>;
	pinned_posts: { post_ids: string[] };
} | null> {
	return kvService.getAndDelete(KV_EXPORT_SIGNED_BUNDLE, token);
}

// --- Import challenge ---

export async function setImportChallenge(
	id: string,
	data: Omit<ImportChallengeData, 'created_at'>
): Promise<void> {
	const full: ImportChallengeData = {
		...data,
		created_at: Date.now()
	};
	await kvService.set(KV_IMPORT_CHALLENGE, id, full, CHALLENGE_TTL);
}

export async function getImportChallenge(id: string): Promise<ImportChallengeData | null> {
	return kvService.get<ImportChallengeData>(KV_IMPORT_CHALLENGE, id);
}

export async function deleteImportChallenge(id: string): Promise<void> {
	await kvService.delete(KV_IMPORT_CHALLENGE, id);
}

/** Atomically get and delete import challenge. Prevents concurrent replay. */
export async function consumeImportChallenge(id: string): Promise<ImportChallengeData | null> {
	return kvService.getAndDelete<ImportChallengeData>(KV_IMPORT_CHALLENGE, id);
}

// --- Public import challenge (no auth, for migration flow) ---

export interface PublicImportChallengeData {
	message: string;
	domain: string;
	expected_did: string;
	created_at: number;
}

export async function setPublicImportChallenge(
	id: string,
	data: Omit<PublicImportChallengeData, 'created_at'>
): Promise<void> {
	const full: PublicImportChallengeData = {
		...data,
		created_at: Date.now()
	};
	await kvService.set(KV_IMPORT_CHALLENGE_PUBLIC, id, full, CHALLENGE_TTL);
}

/** Non-consuming get for Syner to fetch challenge details (export-challenge/:id). */
export async function getPublicImportChallenge(
	id: string
): Promise<PublicImportChallengeData | null> {
	return kvService.get<PublicImportChallengeData>(KV_IMPORT_CHALLENGE_PUBLIC, id);
}

export async function consumePublicImportChallenge(
	id: string
): Promise<PublicImportChallengeData | null> {
	return kvService.getAndDelete<PublicImportChallengeData>(KV_IMPORT_CHALLENGE_PUBLIC, id);
}

// --- Public import token (did-only, for register-with-import) ---

export async function setPublicImportToken(token: string, data: { did: string }): Promise<void> {
	await kvService.set(KV_PUBLIC_IMPORT_TOKEN, token, data, TOKEN_TTL);
}

/** Validate token and return did without consuming. Use consumePublicImportToken after success. */
export function peekPublicImportToken(token: string): Promise<{ did: string } | null> {
	return kvService.get<{ did: string }>(KV_PUBLIC_IMPORT_TOKEN, token).then((e) => e ?? null);
}

export async function consumePublicImportToken(token: string): Promise<{ did: string } | null> {
	return kvService.getAndDelete<{ did: string }>(KV_PUBLIC_IMPORT_TOKEN, token);
}

// --- Import token ---

export async function setImportToken(
	token: string,
	data: { user_id: string; did: string }
): Promise<void> {
	await kvService.set(KV_IMPORT_TOKEN, token, data, TOKEN_TTL);
}

export function consumeImportToken(
	token: string
): Promise<{ user_id: string; did: string } | null> {
	return kvService.getAndDelete<{ user_id: string; did: string }>(KV_IMPORT_TOKEN, token);
}

// --- Delete Aegis challenge ---

export interface DeleteAegisChallengeData {
	message: string;
	domain: string;
	expected_did: string;
	user_id: string;
	created_at: number;
}

export async function setDeleteAegisChallenge(
	id: string,
	data: Omit<DeleteAegisChallengeData, 'created_at'>
): Promise<void> {
	const full: DeleteAegisChallengeData = {
		...data,
		created_at: Date.now()
	};
	await kvService.set(KV_DELETE_AEGIS_CHALLENGE, id, full, CHALLENGE_TTL);
}

export async function getDeleteAegisChallenge(
	id: string
): Promise<DeleteAegisChallengeData | null> {
	return kvService.get<DeleteAegisChallengeData>(KV_DELETE_AEGIS_CHALLENGE, id);
}

/** Atomically get and delete delete-aegis challenge. Prevents concurrent replay. */
export async function consumeDeleteAegisChallenge(
	id: string
): Promise<DeleteAegisChallengeData | null> {
	return kvService.getAndDelete<DeleteAegisChallengeData>(KV_DELETE_AEGIS_CHALLENGE, id);
}

// --- Delete Aegis token ---

export async function setDeleteAegisToken(token: string, data: { user_id: string }): Promise<void> {
	await kvService.set(KV_DELETE_AEGIS_TOKEN, token, data, TOKEN_TTL);
}

/** Validate token and return userId without consuming. Use consumeDeleteAegisToken after success. */
export function peekDeleteAegisToken(token: string): Promise<string | null> {
	return kvService
		.get<{ user_id: string }>(KV_DELETE_AEGIS_TOKEN, token)
		.then((e) => e?.user_id ?? null);
}

export function consumeDeleteAegisToken(token: string): Promise<string | null> {
	return kvService
		.getAndDelete<{ user_id: string }>(KV_DELETE_AEGIS_TOKEN, token)
		.then((entry) => entry?.user_id ?? null);
}

// --- Delete Account challenge ---

export interface DeleteAccountChallengeData {
	message: string;
	domain: string;
	expected_did: string;
	user_id: string;
	created_at: number;
}

export async function setDeleteAccountChallenge(
	id: string,
	data: Omit<DeleteAccountChallengeData, 'created_at'>
): Promise<void> {
	const full: DeleteAccountChallengeData = {
		...data,
		created_at: Date.now()
	};
	await kvService.set(KV_DELETE_ACCOUNT_CHALLENGE, id, full, CHALLENGE_TTL);
}

export async function getDeleteAccountChallenge(
	id: string
): Promise<DeleteAccountChallengeData | null> {
	return kvService.get<DeleteAccountChallengeData>(KV_DELETE_ACCOUNT_CHALLENGE, id);
}

/** Atomically get and delete delete-account challenge. Prevents concurrent replay. */
export async function consumeDeleteAccountChallenge(
	id: string
): Promise<DeleteAccountChallengeData | null> {
	return kvService.getAndDelete<DeleteAccountChallengeData>(KV_DELETE_ACCOUNT_CHALLENGE, id);
}

// --- Delete Account token ---

export async function setDeleteAccountToken(
	token: string,
	data: { user_id: string }
): Promise<void> {
	await kvService.set(KV_DELETE_ACCOUNT_TOKEN, token, data, TOKEN_TTL);
}

/** Validate token and return userId without consuming. Use consumeDeleteAccountToken after success. */
export function peekDeleteAccountToken(token: string): Promise<string | null> {
	return kvService
		.get<{ user_id: string }>(KV_DELETE_ACCOUNT_TOKEN, token)
		.then((e) => e?.user_id ?? null);
}

export function consumeDeleteAccountToken(token: string): Promise<string | null> {
	return kvService
		.getAndDelete<{ user_id: string }>(KV_DELETE_ACCOUNT_TOKEN, token)
		.then((entry) => entry?.user_id ?? null);
}

// --- Sigil handoff (Syner → browser signing session) ---

export type SigilHandoffSessionData = {
	user_id: string;
	/** DID of the SYR account starting handoff; uploaded Sigil must advertise the same key. */
	expected_did: string;
	status: 'pending' | 'complete';
	created_at: number;
	/** Encrypted Sigil JSON string when status === 'complete'. */
	sigil_json?: string;
};

export async function createSigilHandoffSession(
	userId: string,
	expectedDid: string
): Promise<string> {
	const sessionId = crypto.randomUUID();
	const full: SigilHandoffSessionData = {
		user_id: userId,
		expected_did: expectedDid,
		status: 'pending',
		created_at: Date.now()
	};
	await kvService.set(KV_SIGIL_HANDOFF_SESSION, sessionId, full, SIGIL_HANDOFF_TTL_SEC);
	return sessionId;
}

export async function getSigilHandoffSession(id: string): Promise<SigilHandoffSessionData | null> {
	return kvService.get<SigilHandoffSessionData>(KV_SIGIL_HANDOFF_SESSION, id);
}

/**
 * Syner POSTs encrypted Sigil here. Returns false if session missing or not pending.
 */
export async function completeSigilHandoffSession(id: string, sigilJson: string): Promise<boolean> {
	const cur = await kvService.get<SigilHandoffSessionData>(KV_SIGIL_HANDOFF_SESSION, id);
	if (!cur || cur.status !== 'pending') return false;
	const next: SigilHandoffSessionData = {
		...cur,
		status: 'complete',
		sigil_json: sigilJson
	};
	await kvService.set(KV_SIGIL_HANDOFF_SESSION, id, next, SIGIL_HANDOFF_TTL_SEC);
	return true;
}

/**
 * Browser picks up encrypted Sigil once; entry is removed atomically.
 */
export async function consumeSigilHandoffPayload(
	id: string,
	userId: string
): Promise<string | null> {
	const cur = await kvService.getAndDelete<SigilHandoffSessionData>(KV_SIGIL_HANDOFF_SESSION, id);
	if (!cur || cur.user_id !== userId || cur.status !== 'complete' || !cur.sigil_json) {
		return null;
	}
	return cur.sigil_json;
}

// --- Post mutation signing (Syner → SYR browser, session-bound) ---

export type PostSignSessionSignedMutation = {
	payload: Record<string, unknown>;
	signature: string;
	device_public_key: string;
};

export type PostSignSessionData = {
	user_id: string;
	expected_did: string;
	requested_device_public_key: string;
	payload: Record<string, unknown>;
	status: 'pending' | 'complete';
	signed_mutation?: PostSignSessionSignedMutation;
	created_at: number;
};

export async function createPostSignSession(
	data: Omit<PostSignSessionData, 'status' | 'created_at' | 'signed_mutation'>
): Promise<string> {
	const sessionId = crypto.randomUUID();
	const full: PostSignSessionData = {
		...data,
		status: 'pending',
		created_at: Date.now()
	};
	await kvService.set(KV_POST_SIGN_SESSION, sessionId, full, POST_SIGN_TTL_SEC);
	return sessionId;
}

export async function getPostSignSession(id: string): Promise<PostSignSessionData | null> {
	return kvService.get<PostSignSessionData>(KV_POST_SIGN_SESSION, id);
}

export async function completePostSignSession(
	id: string,
	signed: PostSignSessionSignedMutation
): Promise<boolean> {
	const cur = await kvService.get<PostSignSessionData>(KV_POST_SIGN_SESSION, id);
	if (!cur || cur.status !== 'pending') return false;
	const next: PostSignSessionData = {
		...cur,
		status: 'complete',
		signed_mutation: signed
	};
	await kvService.set(KV_POST_SIGN_SESSION, id, next, POST_SIGN_TTL_SEC);
	return true;
}

export async function deletePostSignSession(id: string): Promise<void> {
	await kvService.delete(KV_POST_SIGN_SESSION, id);
}

// --- Publication registry signing (Syner → SYR browser, session-bound) ---

export type RegistrySignSessionData = {
	user_id: string;
	expected_did: string;
	requested_device_public_key: string;
	/** Surreal thing id string e.g. outbox:ulid */
	job_thing_id: string;
	action: 'update' | 'delete';
	did: string;
	registry_url: string;
	provider?: string;
	updated_at?: string;
	deleted_at?: string;
	/** Object Syner canonicalizes (same shape as server JCS input). */
	sign_object: Record<string, unknown>;
	canonical_payload: string;
	/** Second signature: `POST …/directory/upsert` (searchable directory row). */
	directory_sign_object: Record<string, unknown>;
	directory_canonical_payload: string;
	status: 'pending' | 'complete' | 'failed';
	result_error?: string;
	created_at: number;
};

const REGISTRY_SIGN_TTL_SEC = POST_SIGN_TTL_SEC;

export async function createRegistrySignSession(
	data: Omit<RegistrySignSessionData, 'status' | 'created_at' | 'result_error'>
): Promise<string> {
	const sessionId = crypto.randomUUID();
	const full: RegistrySignSessionData = {
		...data,
		status: 'pending',
		created_at: Date.now()
	};
	await kvService.set(KV_REGISTRY_SIGN_SESSION, sessionId, full, REGISTRY_SIGN_TTL_SEC);
	return sessionId;
}

export async function getRegistrySignSession(id: string): Promise<RegistrySignSessionData | null> {
	return kvService.get<RegistrySignSessionData>(KV_REGISTRY_SIGN_SESSION, id);
}

export async function completeRegistrySignSessionSuccess(id: string): Promise<boolean> {
	const cur = await kvService.get<RegistrySignSessionData>(KV_REGISTRY_SIGN_SESSION, id);
	if (!cur || cur.status !== 'pending') return false;
	const next: RegistrySignSessionData = {
		...cur,
		status: 'complete'
	};
	await kvService.set(KV_REGISTRY_SIGN_SESSION, id, next, REGISTRY_SIGN_TTL_SEC);
	return true;
}

export async function completeRegistrySignSessionFailed(
	id: string,
	message: string
): Promise<boolean> {
	const cur = await kvService.get<RegistrySignSessionData>(KV_REGISTRY_SIGN_SESSION, id);
	if (!cur || cur.status !== 'pending') return false;
	const next: RegistrySignSessionData = {
		...cur,
		status: 'failed',
		result_error: message
	};
	await kvService.set(KV_REGISTRY_SIGN_SESSION, id, next, REGISTRY_SIGN_TTL_SEC);
	return true;
}

export async function deleteRegistrySignSession(id: string): Promise<void> {
	await kvService.delete(KV_REGISTRY_SIGN_SESSION, id);
}
