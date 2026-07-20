import type { RotationStatement } from '@syr-is/crypto';

/**
 * A hosting record as stored in the SYR Registry.
 */
export interface HostingRecord {
	did: string;
	provider: string;
	updatedAt: string;
	signature: string;
	/**
	 * Root-key rotation chain (seq 1..n from the genesis key). When present,
	 * the record signature verifies under the chain's CURRENT root key rather
	 * than the genesis key embedded in the DID.
	 */
	rotation_chain?: RotationStatement[];
}

/**
 * Options for the DID resolver.
 */
export interface ResolverOptions {
	/** URL of the SYR Registry service (e.g. "http://localhost:3100") */
	registryUrl: string;

	/**
	 * Optional timeout in milliseconds for HTTP requests.
	 * @default 10000
	 */
	timeout?: number;
}

/**
 * Error thrown when resolution fails.
 */
export class ResolverError extends Error {
	constructor(
		message: string,
		public readonly code:
			| 'INVALID_DID'
			| 'NOT_FOUND'
			| 'INVALID_SIGNATURE'
			| 'PROVIDER_UNREACHABLE'
			| 'INVALID_DOCUMENT'
	) {
		super(message);
		this.name = 'ResolverError';
	}
}
