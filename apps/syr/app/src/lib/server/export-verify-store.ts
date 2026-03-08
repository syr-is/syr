import { independentLogin } from '$lib/config';
import { kvService } from '$lib/services/kv';

const KV_EXPORT_CHALLENGE = 'identity_export_challenge';
const KV_IMPORT_CHALLENGE = 'identity_import_challenge';
const KV_DELETE_AEGIS_CHALLENGE = 'identity_delete_aegis_challenge';
const KV_DELETE_ACCOUNT_CHALLENGE = 'identity_delete_account_challenge';
const KV_IMPORT_CHALLENGE_PUBLIC = 'identity_import_challenge_public';
const KV_EXPORT_TOKEN = 'identity_export_token';
const KV_IMPORT_TOKEN = 'identity_import_token';
const KV_PUBLIC_IMPORT_TOKEN = 'identity_public_import_token';
const KV_DELETE_AEGIS_TOKEN = 'identity_delete_aegis_token';
const KV_DELETE_ACCOUNT_TOKEN = 'identity_delete_account_token';

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
	return kvService
		.get<{ did: string }>(KV_PUBLIC_IMPORT_TOKEN, token)
		.then((e) => e ?? null);
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
