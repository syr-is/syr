/**
 * @syr-is/crypto
 * Cryptographic primitives for the Syr identity system.
 * Ed25519 key generation, multibase encoding, signing, verification, and JCS canonicalization.
 */

export {
	generateRootKeypair,
	generateDeviceKeypair,
	sign,
	verify
} from './keys.js';

export {
	encodeMultibase,
	decodeMultibase,
	deriveDid,
	ED25519_MULTICODEC_PREFIX
} from './encoding.js';

export { canonicalize } from './canonical.js';

export {
	createRotationStatement,
	verifyRotationStatement
} from './rotation.js';

export type {
	Keypair,
	RotationStatement
} from './types.js';
