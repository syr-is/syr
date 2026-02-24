import { beforeAll } from 'vitest';
import { initCryptoWasm } from '@syr-is/crypto';

beforeAll(async () => {
	await initCryptoWasm();
});
