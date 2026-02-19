<script lang="ts">
	import { onMount } from 'svelte';
	import { invalidateAll } from '$app/navigation';
	import * as Card from '@syr-is/ui/card';
	import { buttonVariants } from '@syr-is/ui/button';
	import { toast } from 'svelte-sonner';
	import { seedHandler } from '$lib/services/seed-handler';
	import { processPendingRegistryJobs } from '$lib/services/registry-sign.service';
	import type { PageData } from './$types';

	import RemoveRegistryDialog from '$lib/components/fragments/remove-registry-dialog.svelte';
	import DeleteAllRegistriesDialog from '$lib/components/fragments/delete-all-registries-dialog.svelte';
	import RevokeKeyDialog from '$lib/components/fragments/revoke-key-dialog.svelte';
	import ExportKeyDialog from '$lib/components/fragments/export-key-dialog.svelte';
	import ImportIdentityDialog from '$lib/components/fragments/import-identity-dialog.svelte';
	import CancelOutboxJobDialog from '$lib/components/fragments/cancel-outbox-job-dialog.svelte';
	import { Input } from '@syr-is/ui/input';
	import { Loader2 } from 'lucide-svelte';

	let { data }: { data: PageData } = $props();
	let exportIdentityDialogOpen = $state(false);
	let importIdentityDialogOpen = $state(false);
	let newRegistryUrl = $state('');
	let addingRegistry = $state(false);
	let retryingJob = $state<string | null>(null);

	let removeRegistryDialogOpen = $state(false);
	let registryToRemove = $state<{ id: string; registryUrl: string } | null>(null);
	let deleteAllRegistriesDialogOpen = $state(false);
	let revokeKeyDialogOpen = $state(false);
	let keyToRevoke = $state<string | null>(null);
	let cancelJobDialogOpen = $state(false);
	let jobToCancel = $state<string | null>(null);
	let unlockPassword = $state('');
	let unlockingForSync = $state(false);

	function openExportIdentityDialog() {
		exportIdentityDialogOpen = true;
	}

	function openImportIdentityDialog() {
		importIdentityDialogOpen = true;
	}

	function openRevokeKeyDialog(publicKey: string) {
		keyToRevoke = publicKey;
		revokeKeyDialogOpen = true;
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

	function openRemoveRegistryDialog(reg: { id: string; registryUrl: string }) {
		registryToRemove = { id: reg.id, registryUrl: reg.registryUrl };
		removeRegistryDialogOpen = true;
	}

	function openDeleteAllRegistriesDialog() {
		deleteAllRegistriesDialogOpen = true;
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

	function openCancelJobDialog(job: { id: string }) {
		jobToCancel = job.id;
		cancelJobDialogOpen = true;
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

	async function unlockForSync() {
		if (!unlockPassword || unlockPassword.length < 1) return;

		unlockingForSync = true;
		try {
			const res = await fetch('/api/identity/aegis-bundle');
			if (!res.ok) throw new Error('Failed to fetch identity');
			const bundleData = await res.json();
			const bundle = bundleData.data?.aegisBundle;
			if (!bundle) throw new Error('No Aegis bundle found');

			await seedHandler.run({
				bundle,
				password: unlockPassword,
				action: processPendingRegistryJobs
			});
			toast.success('Registry sync complete');
			await invalidateAll();
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Unlock failed');
		} finally {
			unlockingForSync = false;
			unlockPassword = '';
		}
	}

	// SSE: subscribe to outbox updates when on this page with identity
	onMount(() => {
		if (!data.hasIdentity) return;

		const es = new EventSource('/api/identity/outbox/sse', { withCredentials: true });

		es.addEventListener('outbox', () => {
			invalidateAll();
		});

		es.onerror = () => {
			es.close();
		};

		return () => {
			es.close();
		};
	});
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
						onclick={openExportIdentityDialog}
						disabled={exportIdentityDialogOpen}
					>
						Export identity
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
											onclick={() => openRevokeKeyDialog(key.publicKey)}
											disabled={revokeKeyDialogOpen && keyToRevoke === key.publicKey}
										>
											Revoke
										</button>
									{/if}
								</li>
							{/each}
						</ul>
					</div>
				{/if}
			{:else}
				<p class="text-muted-foreground">
					You do not have an identity yet. Import from a backup if you have one.
				</p>
				<button
					class={buttonVariants({ variant: 'default' })}
					onclick={openImportIdentityDialog}
					disabled={importIdentityDialogOpen}
				>
					Import identity
				</button>
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
									onclick={() => openRemoveRegistryDialog(reg)}
									disabled={removeRegistryDialogOpen && registryToRemove?.id === reg.id}
								>
									Remove
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
						onclick={openDeleteAllRegistriesDialog}
						disabled={deleteAllRegistriesDialogOpen}
					>
						Remove from all registries
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
					{#if data.outboxJobs?.some((j) => j.type === 'registry_sync' && j.status === 'pending')}
						<div
							class="mb-4 space-y-3 rounded-md border border-amber-200 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-950/30"
						>
							<p class="text-sm text-amber-800 dark:text-amber-200">
								Unlock your identity to complete registry sync. Enter your account password to
								decrypt and sign.
							</p>
							<div class="flex items-end gap-2">
								<div class="flex-1 space-y-1">
									<label for="unlock-sync-password" class="sr-only text-sm font-medium"
										>Password</label
									>
									<Input
										id="unlock-sync-password"
										type="password"
										bind:value={unlockPassword}
										placeholder="Account password"
										autocomplete="current-password"
										disabled={unlockingForSync}
										class="w-full"
										onkeydown={(e) => e.key === 'Enter' && unlockForSync()}
									/>
								</div>
								<button
									class={buttonVariants({ variant: 'default' })}
									onclick={unlockForSync}
									disabled={unlockingForSync || !unlockPassword}
								>
									{#if unlockingForSync}
										<Loader2 class="mr-2 h-4 w-4 animate-spin" />
										Unlocking...
									{:else}
										Unlock
									{/if}
								</button>
							</div>
						</div>
					{/if}
					<ul class="space-y-2">
						{#each data.outboxJobs as job (job.id)}
							<li class="space-y-1 rounded-md border px-3 py-2 text-sm">
								<div class="flex flex-wrap items-center justify-between gap-2">
									<div class="flex flex-col gap-0.5">
										<span class="font-mono text-xs">
											{job.payload?.action ?? job.type} → {job.payload?.registryUrl ?? ''}
										</span>
										<span class={statusColor(job.status)}>
											{job.status}
											{#if job.type === 'registry_sync' && job.status === 'pending'}
												· Waiting for unlock
											{:else}
												· attempt {job.attempts}/{job.maxAttempts}
											{/if}
										</span>
									</div>
									<div class="flex gap-1">
										<button
											class={buttonVariants({ variant: 'outline', size: 'sm' })}
											onclick={() => retryJob(job.id)}
											disabled={retryingJob === job.id ||
												job.status === 'completed' ||
												(job.type === 'registry_sync' && job.status === 'pending')}
										>
											{retryingJob === job.id ? 'Retrying...' : 'Retry now'}
										</button>
										<button
											class={buttonVariants({ variant: 'destructive', size: 'sm' })}
											onclick={() => openCancelJobDialog(job)}
											disabled={cancelJobDialogOpen && jobToCancel === job.id}
										>
											Cancel
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

<RemoveRegistryDialog
	bind:open={removeRegistryDialogOpen}
	registry={registryToRemove}
	onSuccess={invalidateAll}
/>

<DeleteAllRegistriesDialog bind:open={deleteAllRegistriesDialogOpen} onSuccess={invalidateAll} />

<RevokeKeyDialog
	bind:open={revokeKeyDialogOpen}
	publicKey={keyToRevoke}
	onSuccess={invalidateAll}
/>

<ExportKeyDialog
	bind:open={exportIdentityDialogOpen}
	hasIdentity={data.hasIdentity}
	onSuccess={invalidateAll}
/>

<ImportIdentityDialog bind:open={importIdentityDialogOpen} onSuccess={invalidateAll} />

<CancelOutboxJobDialog
	bind:open={cancelJobDialogOpen}
	jobId={jobToCancel}
	onSuccess={invalidateAll}
/>
