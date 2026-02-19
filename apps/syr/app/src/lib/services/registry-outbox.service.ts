import { OutboxService } from '$lib/services/outbox.service';
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
 * Jobs stay pending; the client signs via GET /api/identity/pending-registry-jobs
 * and POST /api/identity/registry-sign. This processor is not started.
 */
class RegistryOutboxService extends OutboxService<RegistryUpdatePayload> {
	readonly jobType = 'registry_sync';

	override start(): never {
		throw new Error(
			'RegistryOutboxService must not be started; use pending-registry-jobs and registry-sign.'
		);
	}

	protected async processJob(_payload: RegistryUpdatePayload, _entry: OutboxEntry): Promise<void> {
		throw new Error(
			'Registry jobs require client-side signing. Use pending-registry-jobs and registry-sign.'
		);
	}
}

export const registryOutboxService = new RegistryOutboxService();
