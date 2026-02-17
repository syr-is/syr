/**
 * A hosting record as stored in the SYR Registry.
 */
export interface HostingRecord {
	did: string;
	provider: string;
	updatedAt: string;
	signature: string;
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
