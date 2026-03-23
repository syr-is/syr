import {
	initCryptoWasm,
	canonicalize,
	verify,
	decodeMultibase,
	decodePublicKey
} from '@syr-is/crypto';

/** Signed object for registry `update` (JCS over this record). */
export type RegistryUpdateSignRecord = {
	did: string;
	provider: string;
	updatedAt: string;
};

/** Signed object for registry `delete` (JCS over this record). */
export type RegistryDeleteSignRecord = {
	did: string;
	deletedAt: string;
};

export function canonicalStringForRegistryUpdate(record: RegistryUpdateSignRecord): string {
	return canonicalize({
		did: record.did,
		provider: record.provider,
		updatedAt: record.updatedAt
	});
}

export function canonicalStringForRegistryDelete(record: RegistryDeleteSignRecord): string {
	return canonicalize({ did: record.did, deletedAt: record.deletedAt });
}

/** Signed object for registry `directory/upsert` (JCS over this record). */
export type RegistryDirectoryUpsertSignRecord = {
	did: string;
	provider: string;
	username: string;
	displayName: string;
	listed: boolean;
	updatedAt: string;
};

export function canonicalStringForDirectoryUpsert(
	record: RegistryDirectoryUpsertSignRecord
): string {
	return canonicalize({
		did: record.did,
		provider: record.provider,
		username: record.username,
		displayName: record.displayName,
		listed: record.listed,
		updatedAt: record.updatedAt
	});
}

/**
 * Verify Ed25519 signature over the canonical UTF-8 string using the identity root public key (multibase).
 */
export async function verifyRegistryRootSignature(
	canonicalPayload: string,
	signatureMultibase: string,
	rootPublicKeyMultibase: string
): Promise<boolean> {
	await initCryptoWasm();
	try {
		const rootKey = decodePublicKey(rootPublicKeyMultibase);
		const signatureBytes = decodeMultibase(signatureMultibase);
		return await verify(canonicalPayload, signatureBytes, rootKey);
	} catch {
		return false;
	}
}
