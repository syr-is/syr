import { OutboxService } from '$lib/services/outbox.service';
import {
	sign,
	canonicalize,
	encodeMultibase,
	decodeMultibase,
	ED25519_MULTICODEC_PREFIX
} from '@syr-is/crypto';
import { identityRepository } from '$lib/repositories/identity.repository';
import { registryRepository } from '$lib/repositories/registry.repository';
import type { OutboxEntry } from '$lib/repositories/outbox.repository';

/**
 * Payload for registry update jobs.
 */
export interface RegistryUpdatePayload {
	[key: string]: unknown;
	action: 'update' | 'delete';
	did: string;
	registryUrl: string;
	provider: string;
}

/**
 * Registry outbox service.
 * Extends the abstract outbox to handle registry_sync jobs.
 * Signs hosting records using the identity's private key (SYR as custodian).
 */
class RegistryOutboxService extends OutboxService<RegistryUpdatePayload> {
	readonly jobType = 'registry_sync';

	protected async processJob(payload: RegistryUpdatePayload, _entry: OutboxEntry): Promise<void> {
		if (payload.action === 'update') {
			await this.sendUpdate(payload);
		} else if (payload.action === 'delete') {
			await this.sendDelete(payload);
		} else {
			throw new Error(`Unknown registry action: ${payload.action}`);
		}
	}

	/**
	 * Sign and send a hosting record update to the registry.
	 */
	private async sendUpdate(payload: RegistryUpdatePayload): Promise<void> {
		const { did, registryUrl, provider } = payload;

		// Get the identity's private key for signing
		const identity = await identityRepository.findByDid(did);
		if (!identity || !identity.private_key) {
			throw new Error(`Cannot sign: no private key found for ${did}`);
		}

		// Decode private key from multibase (strip multicodec prefix)
		const privateKeyBytes = decodeMultibase(identity.private_key);
		const rawPrivateKey =
			privateKeyBytes.length === 34 &&
			privateKeyBytes[0] === ED25519_MULTICODEC_PREFIX[0] &&
			privateKeyBytes[1] === ED25519_MULTICODEC_PREFIX[1]
				? privateKeyBytes.slice(2)
				: privateKeyBytes;

		// Build the canonical payload
		const updatedAt = new Date().toISOString();
		const canonicalPayload = canonicalize({ did, provider, updatedAt });

		// Sign it
		const signatureBytes = await sign(canonicalPayload, rawPrivateKey);
		const signature = encodeMultibase(signatureBytes);

		// Send to registry (API is at /api/v1/)
		const base = registryUrl.replace(/\/$/, '');
		const res = await fetch(`${base}/api/v1/update`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ did, provider, updatedAt, signature })
		});

		if (!res.ok) {
			const body = await res.text();
			throw new Error(`Registry update failed (${res.status}): ${body}`);
		}

		// Update the identity_registry status
		await registryRepository.updateStatus(did, registryUrl, 'synced');
	}

	/**
	 * Sign and send a deletion request to the registry.
	 */
	private async sendDelete(payload: RegistryUpdatePayload): Promise<void> {
		const { did, registryUrl } = payload;

		// Get the identity's private key for signing
		const identity = await identityRepository.findByDid(did);
		if (!identity || !identity.private_key) {
			throw new Error(`Cannot sign: no private key found for ${did}`);
		}

		// Decode private key from multibase (strip multicodec prefix)
		const privateKeyBytes = decodeMultibase(identity.private_key);
		const rawPrivateKey =
			privateKeyBytes.length === 34 &&
			privateKeyBytes[0] === ED25519_MULTICODEC_PREFIX[0] &&
			privateKeyBytes[1] === ED25519_MULTICODEC_PREFIX[1]
				? privateKeyBytes.slice(2)
				: privateKeyBytes;

		// Build the canonical payload
		const deletedAt = new Date().toISOString();
		const canonicalPayload = canonicalize({ did, deletedAt });

		// Sign it
		const signatureBytes = await sign(canonicalPayload, rawPrivateKey);
		const signature = encodeMultibase(signatureBytes);

		// Send to registry (API is at /api/v1/)
		const base = registryUrl.replace(/\/$/, '');
		const res = await fetch(`${base}/api/v1/delete`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ did, deletedAt, signature })
		});

		if (!res.ok) {
			const body = await res.text();
			throw new Error(`Registry delete failed (${res.status}): ${body}`);
		}
	}
}

export const registryOutboxService = new RegistryOutboxService();
