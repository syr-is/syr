import { decryptAegisBundle } from '@syr-is/crypto/aegis';
import type { AegisBundle } from '@syr-is/crypto/aegis';

/**
 * Handler for actions that require the decrypted seed.
 * The seed is never stored; it exists only during the action callback and is zeroed on completion or failure.
 */
class SeedHandler {
	async run<T>(params: {
		bundle: AegisBundle;
		password: string;
		action: (seed: Uint8Array) => Promise<T>;
	}): Promise<T> {
		const seed = await decryptAegisBundle(params.bundle, params.password);
		try {
			return await params.action(seed);
		} finally {
			seed.fill(0);
		}
	}
}

export const seedHandler = new SeedHandler();
