<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import * as Card from '@syr-is/ui/card';
	import { buttonVariants } from '@syr-is/ui/button';
	import { toast } from 'svelte-sonner';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
	let exportLoading = $state(false);
	let keyExportLoading = $state(false);
	let revokingKey = $state<string | null>(null);
	let newRegistryUrl = $state('');
	let addingRegistry = $state(false);
	let removingRegistry = $state<string | null>(null);
	let retryingJob = $state<string | null>(null);
	let cancellingJob = $state<string | null>(null);
	let deletingAll = $state(false);

	async function exportPrivateKey() {
		if (!data.hasIdentity) return;
		if (
			!confirm(
				'⚠️ WARNING: You are about to download your ROOT PRIVATE KEY.\n\n' +
					'• Anyone with this key can fully impersonate your identity.\n' +
					'• Store it in a secure, offline location.\n' +
					'• After export, YOU are responsible for key custody.\n\n' +
					'Do you understand and wish to proceed?'
			)
		)
			return;

		keyExportLoading = true;
		try {
			const res = await fetch('/api/identity/export-keys', { method: 'POST' });
			if (!res.ok) {
				const err = await res.json();
				throw new Error(err?.message ?? 'Key export failed');
			}
			const result = await res.json();
			const blob = new Blob([JSON.stringify(result.data, null, 2)], {
				type: 'application/json'
			});
			const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
			const url = URL.createObjectURL(blob);
			const a = document.createElement('a');
			a.href = url;
			a.download = `private-key-${timestamp}.json`;
			a.click();
			URL.revokeObjectURL(url);
			toast.success('Private key exported — store it securely!');
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Key export failed');
		} finally {
			keyExportLoading = false;
		}
	}

	async function exportIdentity() {
		if (!data.hasIdentity) return;
		exportLoading = true;
		try {
			const res = await fetch('/api/identity/export');
			if (!res.ok) {
				const err = await res.json();
				throw new Error(err?.message ?? 'Export failed');
			}
			const bundle = await res.json();
			const blob = new Blob([JSON.stringify(bundle.data, null, 2)], {
				type: 'application/json'
			});
			const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
			const url = URL.createObjectURL(blob);
			const a = document.createElement('a');
			a.href = url;
			a.download = `identity-export-${timestamp}.json`;
			a.click();
			URL.revokeObjectURL(url);
			toast.success('Identity exported successfully');
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Export failed');
		} finally {
			exportLoading = false;
		}
	}

	async function revokeKey(publicKey: string) {
		if (!confirm('Revoke this device key? This device will no longer be able to sign mutations.')) {
			return;
		}
		revokingKey = publicKey;
		try {
			const res = await fetch('/api/identity/delegate/revoke', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ devicePublicKey: publicKey })
			});
			if (!res.ok) {
				const err = await res.json();
				throw new Error(err?.message ?? 'Revoke failed');
			}
			toast.success('Device key revoked');
			await invalidateAll();
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Revoke failed');
		} finally {
			revokingKey = null;
		}
	}

	async function addRegistry() {
		if (!newRegistryUrl.trim()) return;
		addingRegistry = true;
		try {
			const res = await fetch('/api/identity/registries', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ registryUrl: newRegistryUrl.trim() })
			});
			if (!res.ok) {
				const err = await res.json();
				throw new Error(err?.message ?? 'Failed to add registry');
			}
			newRegistryUrl = '';
			toast.success('Registry added — sync queued');
			await invalidateAll();
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Failed to add registry');
		} finally {
			addingRegistry = false;
		}
	}

	async function removeRegistry(registryId: string) {
		if (!confirm('Remove this registry listing?')) return;
		removingRegistry = registryId;
		try {
			// Extract the id part after 'identity_registry:'
			const idPart = registryId.includes(':')
				? registryId.split(':').slice(1).join(':')
				: registryId;
			const res = await fetch(`/api/identity/registries/${encodeURIComponent(idPart)}`, {
				method: 'DELETE'
			});
			if (!res.ok) {
				const err = await res.json();
				throw new Error(err?.message ?? 'Failed to remove registry');
			}
			toast.success('Registry removal queued');
			await invalidateAll();
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Failed to remove registry');
		} finally {
			removingRegistry = null;
		}
	}

	async function deleteAllRegistries() {
		if (!confirm('Delete your identity from ALL registries? This cannot be undone.')) return;
		deletingAll = true;
		try {
			const res = await fetch('/api/identity/registries/delete-all', { method: 'POST' });
			if (!res.ok) {
				const err = await res.json();
				throw new Error(err?.message ?? 'Failed');
			}
			toast.success('Deletion from all registries queued');
			await invalidateAll();
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Failed');
		} finally {
			deletingAll = false;
		}
	}

	async function retryJob(jobId: string) {
		retryingJob = jobId;
		try {
			const idPart = jobId.includes(':') ? jobId.split(':').slice(1).join(':') : jobId;
			const res = await fetch(`/api/identity/outbox/${encodeURIComponent(idPart)}/retry`, {
				method: 'POST'
			});
			if (!res.ok) {
				const err = await res.json();
				throw new Error(err?.message ?? 'Retry failed');
			}
			toast.success('Job queued for retry');
			await invalidateAll();
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Retry failed');
		} finally {
			retryingJob = null;
		}
	}

	async function cancelJob(jobId: string) {
		if (!confirm('Cancel this outbox job?')) return;
		cancellingJob = jobId;
		try {
			const idPart = jobId.includes(':') ? jobId.split(':').slice(1).join(':') : jobId;
			const res = await fetch(`/api/identity/outbox/${encodeURIComponent(idPart)}/cancel`, {
				method: 'POST'
			});
			if (!res.ok) {
				const err = await res.json();
				throw new Error(err?.message ?? 'Cancel failed');
			}
			toast.success('Job cancelled');
			await invalidateAll();
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Cancel failed');
		} finally {
			cancellingJob = null;
		}
	}

	function truncateKey(pubKey: string): string {
		if (pubKey.length <= 16) return pubKey;
		return pubKey.slice(0, 8) + '…' + pubKey.slice(-8);
	}

	function statusColor(status: string): string {
		switch (status) {
			case 'synced':
			case 'completed':
				return 'text-green-600';
			case 'pending':
			case 'processing':
				return 'text-yellow-600';
			case 'failed':
			case 'error':
				return 'text-red-600';
			case 'cancelled':
				return 'text-muted-foreground';
			default:
				return '';
		}
	}
</script>

<div class="space-y-6">
	<Card.Root>
		<Card.Header>
			<Card.Title>Identity</Card.Title>
			<Card.Description>
				Manage your cryptographic identity, export for backup, and revoke delegated keys.
			</Card.Description>
		</Card.Header>
		<Card.Content class="space-y-4">
			{#if data.hasIdentity}
				<div class="space-y-2">
					<p class="text-sm font-medium">Your DID</p>
					<p class="font-mono text-sm break-all text-muted-foreground">{data.did}</p>
				</div>

				<div class="flex flex-wrap gap-2">
					<button
						class={buttonVariants({ variant: 'default' })}
						onclick={exportIdentity}
						disabled={exportLoading}
					>
						{#if exportLoading}
							Exporting...
						{:else}
							Export identity
						{/if}
					</button>
					<button
						class={buttonVariants({ variant: 'destructive' })}
						onclick={exportPrivateKey}
						disabled={keyExportLoading}
					>
						{#if keyExportLoading}
							Exporting key...
						{:else}
							Export private key
						{/if}
					</button>
				</div>

				{#if data.delegatedKeys?.length}
					<div class="space-y-2">
						<p class="text-sm font-medium">Delegated device keys</p>
						<ul class="space-y-2">
							{#each data.delegatedKeys as key (key.publicKey)}
								<li
									class="flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm"
								>
									<div class="flex flex-col gap-0.5">
										<span class="font-mono" title={key.publicKey}>{truncateKey(key.publicKey)}</span
										>
										<span class="text-muted-foreground">
											{key.revokedAt ? 'Revoked' : 'Active'}
										</span>
									</div>
									{#if !key.revokedAt}
										<button
											class={buttonVariants({ variant: 'destructive', size: 'sm' })}
											onclick={() => revokeKey(key.publicKey)}
											disabled={revokingKey === key.publicKey}
										>
											{revokingKey === key.publicKey ? 'Revoking...' : 'Revoke'}
										</button>
									{/if}
								</li>
							{/each}
						</ul>
					</div>
				{/if}
			{:else}
				<p class="text-muted-foreground">
					You do not have an identity yet. Identity is created automatically when you first sign in
					after registration.
				</p>
			{/if}
		</Card.Content>
	</Card.Root>

	{#if data.hasIdentity}
		<!-- Registries Card -->
		<Card.Root>
			<Card.Header>
				<Card.Title>Registries</Card.Title>
				<Card.Description>
					Manage where your identity is listed. Registries allow others to discover your provider.
				</Card.Description>
			</Card.Header>
			<Card.Content class="space-y-4">
				<!-- Add registry form -->
				<div class="flex gap-2">
					<input
						type="url"
						bind:value={newRegistryUrl}
						placeholder="https://registry.example.com"
						class="flex-1 rounded-md border px-3 py-2 text-sm"
					/>
					<button
						class={buttonVariants({ variant: 'default', size: 'sm' })}
						onclick={addRegistry}
						disabled={addingRegistry || !newRegistryUrl.trim()}
					>
						{addingRegistry ? 'Adding...' : 'Add registry'}
					</button>
				</div>

				<!-- Registry list -->
				{#if data.registries?.length}
					<ul class="space-y-2">
						{#each data.registries as reg (reg.id)}
							<li
								class="flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm"
							>
								<div class="flex flex-col gap-0.5">
									<span class="font-mono text-xs break-all">{reg.registryUrl}</span>
									<span class={statusColor(reg.status)}>
										{reg.status}
										{#if reg.lastSyncedAt}
											· synced {new Date(reg.lastSyncedAt).toLocaleDateString()}
										{/if}
									</span>
								</div>
								<button
									class={buttonVariants({ variant: 'destructive', size: 'sm' })}
									onclick={() => removeRegistry(reg.id)}
									disabled={removingRegistry === reg.id}
								>
									{removingRegistry === reg.id ? 'Removing...' : 'Remove'}
								</button>
							</li>
						{/each}
					</ul>
				{:else}
					<p class="text-sm text-muted-foreground">No registries configured.</p>
				{/if}

				{#if data.registries?.length}
					<button
						class={buttonVariants({ variant: 'destructive', size: 'sm' })}
						onclick={deleteAllRegistries}
						disabled={deletingAll}
					>
						{deletingAll ? 'Deleting...' : 'Remove from all registries'}
					</button>
				{/if}
			</Card.Content>
		</Card.Root>

		<!-- Outbox Card -->
		{#if data.outboxJobs?.length}
			<Card.Root>
				<Card.Header>
					<Card.Title>Pending sync jobs</Card.Title>
					<Card.Description>
						Registry sync operations in progress or queued for retry.
					</Card.Description>
				</Card.Header>
				<Card.Content>
					<ul class="space-y-2">
						{#each data.outboxJobs as job (job.id)}
							<li class="space-y-1 rounded-md border px-3 py-2 text-sm">
								<div class="flex flex-wrap items-center justify-between gap-2">
									<div class="flex flex-col gap-0.5">
										<span class="font-mono text-xs">
											{job.payload?.action ?? job.type} → {job.payload?.registryUrl ?? ''}
										</span>
										<span class={statusColor(job.status)}>
											{job.status} · attempt {job.attempts}/{job.maxAttempts}
										</span>
									</div>
									<div class="flex gap-1">
										<button
											class={buttonVariants({ variant: 'outline', size: 'sm' })}
											onclick={() => retryJob(job.id)}
											disabled={retryingJob === job.id || job.status === 'completed'}
										>
											{retryingJob === job.id ? 'Retrying...' : 'Retry now'}
										</button>
										<button
											class={buttonVariants({ variant: 'destructive', size: 'sm' })}
											onclick={() => cancelJob(job.id)}
											disabled={cancellingJob === job.id}
										>
											{cancellingJob === job.id ? 'Cancelling...' : 'Cancel'}
										</button>
									</div>
								</div>
								{#if job.lastError}
									<p class="text-xs break-all text-red-500">Error: {job.lastError}</p>
								{/if}
							</li>
						{/each}
					</ul>
				</Card.Content>
			</Card.Root>
		{/if}
	{/if}
</div>
