/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { initCryptoWasm, generateRootKeypair, deriveDid, decodePublicKey } from '@syr-is/crypto';
import { createSigil, type SigilObject } from '@syr-is/crypto/sigil';
import {
	assertEncryptedSigilJsonMatchesDid,
	loadSigilFromEncryptedJsonText,
	unlockSigilSession,
	clearSigilSession,
	getUnlockedSigningSeed
} from './sigil-session.js';

beforeEach(() => {
	clearSigilSession();
});

describe('assertEncryptedSigilJsonMatchesDid', () => {
	it('accepts Sigil whose pub matches expected DID', async () => {
		await initCryptoWasm();
		const kp = await generateRootKeypair();
		const sigil = await createSigil(kp.privateKey, 'test-pass');
		const text = JSON.stringify(sigil);
		const did = deriveDid(decodePublicKey(sigil.pub));
		await expect(assertEncryptedSigilJsonMatchesDid(text, did)).resolves.toBeUndefined();
	});

	it('rejects when expected DID differs from pub', async () => {
		await initCryptoWasm();
		const kp = await generateRootKeypair();
		const sigil = await createSigil(kp.privateKey, 'test-pass');
		const text = JSON.stringify(sigil);
		const other = await generateRootKeypair();
		const otherDid = deriveDid(other.publicKey);
		await expect(assertEncryptedSigilJsonMatchesDid(text, otherDid)).rejects.toThrow(
			/different identity|SYR account/
		);
	});
});

describe('unlockSigilSession seed–pub binding', () => {
	it('unlocks when ciphertext matches pub', async () => {
		await initCryptoWasm();
		const kp = await generateRootKeypair();
		const sigil = await createSigil(kp.privateKey, 'good-pass');
		await loadSigilFromEncryptedJsonText(JSON.stringify(sigil), {
			filename: 'x.sigil',
			loadedAt: new Date().toISOString()
		});
		await unlockSigilSession('good-pass');
		const seed = getUnlockedSigningSeed();
		expect(seed).not.toBeNull();
		expect(seed!.length).toBe(32);
	});

	it('rejects when ciphertext does not match pub (tampered enc)', async () => {
		await initCryptoWasm();
		const kp = await generateRootKeypair();
		const sigil = await createSigil(kp.privateKey, 'good-pass');
		const tampered: SigilObject = {
			...sigil,
			enc: {
				...sigil.enc,
				ct: sigil.enc.ct.slice(0, -2) + 'XX'
			}
		};
		await loadSigilFromEncryptedJsonText(JSON.stringify(tampered), {
			filename: 'x.sigil',
			loadedAt: new Date().toISOString()
		});
		await expect(unlockSigilSession('good-pass')).rejects.toThrow();
		expect(getUnlockedSigningSeed()).toBeNull();
	});
});
