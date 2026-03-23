<script lang="ts">
	import { onMount } from 'svelte';
	import { invalidateAll } from '$app/navigation';
	import * as Card from '@syr-is/ui/card';
	import { buttonVariants } from '@syr-is/ui/button';
	import { Button } from '@syr-is/ui/button';
	import { toast } from 'svelte-sonner';
	import { seedHandler } from '$lib/services/seed-handler';
	import {
		processPendingRegistryJobs,
		startRegistrySynerSession
	} from '$lib/services/registry-sign.service';
	import { pollRegistrySignSessionResult } from '$lib/client/registry-sign-poll';
	import {
		getSigilSessionStatus,
		getLoadedSigilDid,
		unlockSigilSession,
		getUnlockedSigningSeed
	} from '$lib/client/sigil-session';
	import { getIdentityStore } from '$lib/stores/identity.svelte';
	import type { AegisBundle } from '@syr-is/crypto/aegis';
	import QRCode from 'qrcode';
	import type { PageData } from './$types';

	import RemoveRegistryDialog from '$lib/components/fragments/remove-registry-dialog.svelte';
	import DeleteAllRegistriesDialog from '$lib/components/fragments/delete-all-registries-dialog.svelte';
	import RevokeKeyDialog from '$lib/components/fragments/revoke-key-dialog.svelte';
	import * as DropdownMenu from '@syr-is/ui/dropdown-menu';
	import ExportKeyDialog from '$lib/components/fragments/export-key-dialog.svelte';
	import ImportIdentityDialog from '$lib/components/fragments/import-identity-dialog.svelte';
	import DeleteAegisDialog from '$lib/components/fragments/delete-aegis-dialog.svelte';
	import DeleteAccountDialog from '$lib/components/fragments/delete-account-dialog.svelte';
	import CancelOutboxJobDialog from '$lib/components/fragments/cancel-outbox-job-dialog.svelte';
	import { Input } from '@syr-is/ui/input';
	import { Label } from '@syr-is/ui/label';
	import { ChevronDown, Loader, Smartphone, KeyRound, LockKeyhole } from 'lucide-svelte';
	import type { ExportType } from '$lib/components/fragments/export-key-dialog.svelte';

	let { data }: { data: PageData } = $props();
	let exportIdentityDialogOpen = $state(false);
	let exportTypeForDialog = $state<ExportType>('syr');
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
	let deleteAegisDialogOpen = $state(false);
	let deleteAccountDialogOpen = $state(false);

	const identityStore = getIdentityStore();
	let registryBusy = $state(false);
	let registrySigilPassphrase = $state('');
	let registryAegisPassword = $state('');
	let registrySigilUiTick = $state(0);
	let registrySynerDeeplink = $state<string | null>(null);
	let registrySynerQr = $state<string | null>(null);
	let _registrySynerSessionId = $state<string | null>(null);
	let registrySynerPolling = $state(false);
	let registrySynerPollAbort: AbortController | null = null;

	const registryDid = $derived(identityStore.identityContext?.did ?? null);
	const registryIdentityPk = $derived(identityStore.identityContext?.identityPublicKey ?? null);
	const registryHasAegis = $derived(identityStore.identityContext?.hasAegis ?? false);

	const registrySigilStatus = $derived.by(() => {
		void registrySigilUiTick;
		return getSigilSessionStatus();
	});
	const registrySigilUnlocked = $derived(registrySigilStatus === 'unlocked');
	const registrySigilLocked = $derived(registrySigilStatus === 'loaded_locked');
	const registryShowSyner = $derived(!!registryIdentityPk);

	const firstPendingRegistryJobId = $derived(
		data.outboxJobs?.find((j) => j.type === 'registry_sync' && j.status === 'pending')?.id ?? null
	);

	function resetRegistrySynerUi() {
		registrySynerPollAbort?.abort();
		registrySynerPollAbort = null;
		registrySynerDeeplink = null;
		registrySynerQr = null;
		_registrySynerSessionId = null;
		registrySynerPolling = false;
	}

	async function runRegistrySyncWithSeed(seed: Uint8Array) {
		await processPendingRegistryJobs(seed);
	}

	async function signRegistryWithUnlockedSigil() {
		const did = registryDid;
		if (!did?.startsWith('did:syr:')) {
			toast.error('Not signed in with a DID.');
			return;
		}
		registryBusy = true;
		try {
			const loadedDid = await getLoadedSigilDid();
			if (loadedDid !== did) {
				throw new Error('Loaded Sigil is for a different identity.');
			}
			const seed = getUnlockedSigningSeed();
			if (!seed) throw new Error('Unlock your Sigil first.');
			await runRegistrySyncWithSeed(seed);
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Signing failed');
		} finally {
			registryBusy = false;
		}
	}

	async function signRegistryAfterUnlockSigil() {
		const did = registryDid;
		if (!did?.startsWith('did:syr:')) {
			toast.error('Not signed in with a DID.');
			return;
		}
		if (!registrySigilPassphrase.trim()) {
			toast.error('Enter your Sigil passphrase');
			return;
		}
		registryBusy = true;
		try {
			const loadedDid = await getLoadedSigilDid();
			if (loadedDid !== did) {
				throw new Error('Loaded Sigil is for a different identity.');
			}
			await unlockSigilSession(registrySigilPassphrase);
			registrySigilPassphrase = '';
			registrySigilUiTick++;
			const seed = getUnlockedSigningSeed();
			if (!seed) throw new Error('Unlock failed.');
			await runRegistrySyncWithSeed(seed);
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Signing failed');
		} finally {
			registryBusy = false;
		}
	}

	async function signRegistryWithAegis() {
		if (!registryAegisPassword.trim()) {
			toast.error('Enter your Aegis password');
			return;
		}
		registryBusy = true;
		try {
			const res = await fetch('/api/identity/aegis-bundle');
			const j = await res.json();
			if (!res.ok) {
				throw new Error(j.error?.message ?? 'Could not load Aegis bundle');
			}
			const bundle = j.data?.aegisBundle as AegisBundle;
			if (!bundle) throw new Error('No Aegis bundle');
			await seedHandler.run({
				bundle,
				password: registryAegisPassword,
				action: processPendingRegistryJobs
			});
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Aegis signing failed');
		} finally {
			registryAegisPassword = '';
			registryBusy = false;
		}
	}

	async function startRegistrySynerSigning() {
		const jobId = firstPendingRegistryJobId;
		if (!jobId) {
			toast.error('No pending registry job to sign.');
			return;
		}
		registryBusy = true;
		resetRegistrySynerUi();
		try {
			const start = await startRegistrySynerSession(jobId);
			_registrySynerSessionId = start.session_id;
			registrySynerDeeplink = start.deeplink_url;
			registrySynerQr = await QRCode.toDataURL(start.deeplink_url, { margin: 1, width: 220 });
			void pollRegistrySyner(start.session_id);
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Syner session failed');
		} finally {
			registryBusy = false;
		}
	}

	async function pollRegistrySyner(sessionId: string) {
		registrySynerPollAbort?.abort();
		registrySynerPollAbort = new AbortController();
		const signal = registrySynerPollAbort.signal;
		registrySynerPolling = true;
		try {
			await pollRegistrySignSessionResult(sessionId, { signal });
			registrySynerPolling = false;
			resetRegistrySynerUi();
			registrySigilUiTick++;
			toast.success('Registry synced via Syner');
			await invalidateAll();
		} catch (e) {
			registrySynerPolling = false;
			if (e instanceof DOMException && e.name === 'AbortError') return;
			toast.error(e instanceof Error ? e.message : 'Syner signing failed');
		}
	}

	function openExportIdentityDialog(type: ExportType = 'syr') {
		exportTypeForDialog = type;
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

	// SSE: subscribe to outbox updates when on this page with identity
	onMount(() => {
		if (!data.identityContext?.hasIdentity) return;

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
			{#if data.identityContext?.hasIdentity}
				<div class="space-y-2">
					<p class="text-sm font-medium">Your DID</p>
					<p class="font-mono text-sm break-all text-muted-foreground">
						{data.identityContext?.did}
					</p>
				</div>

				<div class="flex flex-wrap gap-2">
					<DropdownMenu.Root>
						<DropdownMenu.Trigger
							class={buttonVariants({ variant: 'default' })}
							disabled={exportIdentityDialogOpen}
						>
							Export
							<ChevronDown class="ml-1 h-4 w-4" />
						</DropdownMenu.Trigger>
						<DropdownMenu.Content align="start">
							<DropdownMenu.Item onclick={() => openExportIdentityDialog('syr')}>
								Export SYR
							</DropdownMenu.Item>
							{#if data.identityContext?.hasAegis}
								<DropdownMenu.Item onclick={() => openExportIdentityDialog('sigil')}>
									Export Sigil
								</DropdownMenu.Item>
								<DropdownMenu.Item onclick={() => openExportIdentityDialog('persona')}>
									Export Persona
								</DropdownMenu.Item>
							{/if}
						</DropdownMenu.Content>
					</DropdownMenu.Root>
				</div>

				<div class="space-y-2 rounded-md border p-3 text-sm">
					<p class="font-medium">Export methods</p>
					<ul class="space-y-1.5 text-muted-foreground">
						<li>
							<strong class="text-foreground">Export SYR</strong> —
							{#if data.identityContext?.hasAegis}
								Complete backup (.syr file). All posts, assets, manifest, and identity. Use for full
								migration or reclaim identity in SYR.
							{:else}
								Data backup (.syr file). Profile, posts, and assets. Verify with Syner to download.
								Keys stay in Syner.
							{/if}
						</li>
						{#if data.identityContext?.hasAegis}
							<li>
								<strong class="text-foreground">Export Sigil</strong> — Bare minimum identity backup
								(.sigil file). Single encrypted file. Use for key recovery or minimal backup.
							</li>
							<li>
								<strong class="text-foreground">Export Persona</strong> — Syner-readable profile (.persona
								file). Sigil, profile.json, avatar, banner. Open in Syner to import.
							</li>
						{/if}
					</ul>
				</div>

				{#if data.identityContext?.hasAegis}
					<div
						class="space-y-2 rounded-md border border-amber-200 bg-amber-50/50 p-3 dark:border-amber-800 dark:bg-amber-950/20"
					>
						<p class="text-sm font-medium text-amber-800 dark:text-amber-200">
							Remove server-stored key
						</p>
						<p class="text-xs text-muted-foreground">
							Delete Aegis removes your encrypted key backup from the server. Export your Sigil or
							Persona and import into Syner first — you must sign with Syner to prove you have
							backed up your keys. You will need Syner for signing afterward.
						</p>
						<button
							class={buttonVariants({ variant: 'destructive', size: 'sm' })}
							onclick={() => (deleteAegisDialogOpen = true)}
							disabled={deleteAegisDialogOpen}
						>
							Delete Aegis
						</button>
					</div>
				{/if}

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

	{#if data.identityContext?.hasIdentity}
		<!-- Registries Card -->
		<Card.Root>
			<Card.Header>
				<Card.Title>Publication registries</Card.Title>
				<Card.Description>
					Where <strong class="font-medium text-foreground"
						>your DID is registered and synced</strong
					>. This controls outbox jobs and listing of your provider — not which registries you use
					to search or to validate follows. For that, configure
					<a href="/settings/discovery" class="text-primary underline">Discovery registries</a>.
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
					<p class="text-sm text-muted-foreground">No publication registries configured.</p>
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
								Complete publication registry sync by signing pending jobs with your <strong
									class="font-medium text-foreground">root key</strong
								>: unlocked Sigil in this tab, Sigil passphrase, Aegis password (if enabled), or
								Syner (QR). Sigil and Aegis sign
								<strong class="font-medium text-foreground">all</strong>
								pending jobs in one go; Syner signs
								<strong class="font-medium text-foreground">one</strong> job per scan (repeat if several
								are queued).
							</p>
							<div class="flex flex-col gap-2">
								{#if registrySigilUnlocked}
									<Button
										type="button"
										variant="secondary"
										disabled={registryBusy}
										onclick={() => void signRegistryWithUnlockedSigil()}
										class="justify-start"
									>
										{#if registryBusy}
											<Loader class="mr-2 h-4 w-4 animate-spin" />
										{:else}
											<KeyRound class="mr-2 h-4 w-4" />
										{/if}
										Sign with unlocked Sigil (this browser)
									</Button>
								{/if}
								{#if registrySigilLocked}
									<div class="space-y-2 rounded-md border border-border bg-background/60 p-3">
										<Label for="reg-sigil-pass">Sigil passphrase</Label>
										<Input
											id="reg-sigil-pass"
											type="password"
											autocomplete="off"
											bind:value={registrySigilPassphrase}
											placeholder="Unlock Sigil in this tab…"
											disabled={registryBusy}
										/>
										<Button
											type="button"
											size="sm"
											disabled={registryBusy || !registrySigilPassphrase.trim()}
											onclick={() => void signRegistryAfterUnlockSigil()}
										>
											Unlock &amp; sign with Sigil
										</Button>
									</div>
								{:else if registrySigilStatus === 'empty'}
									<p class="text-sm text-muted-foreground">
										No Sigil loaded in this tab. Open <strong>Settings → Signing</strong> to load one,
										or use Aegis / Syner below.
									</p>
								{/if}
								{#if registryHasAegis}
									<div class="space-y-2 rounded-md border border-border bg-background/60 p-3">
										<Label for="reg-aegis-pass" class="flex items-center gap-2">
											<LockKeyhole class="h-4 w-4" />
											Aegis password
										</Label>
										<Input
											id="reg-aegis-pass"
											type="password"
											autocomplete="off"
											bind:value={registryAegisPassword}
											disabled={registryBusy}
										/>
										<Button
											type="button"
											size="sm"
											disabled={registryBusy || !registryAegisPassword.trim()}
											onclick={() => void signRegistryWithAegis()}
										>
											Sign with Aegis (custodial)
										</Button>
									</div>
								{/if}
								{#if registryShowSyner && firstPendingRegistryJobId}
									<div class="space-y-2">
										<Button
											type="button"
											variant="outline"
											disabled={registryBusy || registrySynerPolling}
											onclick={() => void startRegistrySynerSigning()}
											class="justify-start"
										>
											<Smartphone class="mr-2 h-4 w-4" />
											Sign with Syner (QR / app)
										</Button>
										{#if registrySynerQr && registrySynerDeeplink}
											<div class="flex flex-col items-center gap-2">
												<img
													src={registrySynerQr}
													alt="Syner registry signing QR"
													class="rounded-md border"
												/>
												<a
													href={registrySynerDeeplink}
													class="text-sm font-medium text-primary underline"
													rel="noopener noreferrer"
												>
													Open in Syner
												</a>
												<p class="text-center text-xs text-muted-foreground">
													Use the persona for this DID:
												</p>
												<p
													class="max-w-full text-center font-mono text-xs break-all text-foreground select-all"
												>
													{registryDid ?? ''}
												</p>
												{#if registrySynerPolling}
													<p class="flex items-center gap-2 text-sm text-muted-foreground">
														<Loader class="h-4 w-4 animate-spin" />
														Waiting for Syner…
													</p>
												{/if}
											</div>
										{/if}
									</div>
								{/if}
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

	<!-- Danger zone: Delete account -->
	<Card.Root class="border-red-200 dark:border-red-800">
		<Card.Header>
			<Card.Title class="text-red-600 dark:text-red-400">Danger zone</Card.Title>
			<Card.Description>
				Permanently delete your account and all data. This cannot be undone.
			</Card.Description>
		</Card.Header>
		<Card.Content>
			<button
				class={buttonVariants({ variant: 'destructive' })}
				onclick={() => (deleteAccountDialogOpen = true)}
				disabled={deleteAccountDialogOpen}
			>
				Delete account
			</button>
		</Card.Content>
	</Card.Root>
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
	exportType={exportTypeForDialog}
	identityContext={data.identityContext}
	onSuccess={invalidateAll}
/>

<ImportIdentityDialog bind:open={importIdentityDialogOpen} onSuccess={invalidateAll} />

<DeleteAegisDialog bind:open={deleteAegisDialogOpen} onSuccess={invalidateAll} />

<DeleteAccountDialog bind:open={deleteAccountDialogOpen} onSuccess={invalidateAll} />

<CancelOutboxJobDialog
	bind:open={cancelJobDialogOpen}
	jobId={jobToCancel}
	onSuccess={invalidateAll}
/>
