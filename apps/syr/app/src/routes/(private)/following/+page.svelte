<script lang="ts">
	import PersonaDirectoryRow from '$lib/components/fragments/persona-directory-row.svelte';
	import { resolveProvider } from '@syr-is/resolver';
	import { registryApiRoot } from '$lib/registry-url';
	import { normalizeProviderBaseUrl } from '$lib/normalize-provider-base-url';
	import { resolve } from '$app/paths';
	import { fetchManifest } from '$lib/manifest-cache.js';
	import {
		endpointsFromManifest,
		fallbackEndpoints,
		manifestUrl,
		type RemoteEndpoints
	} from '$lib/remote-endpoints.js';
	import * as Dialog from '@syr-is/ui/dialog';
	import { Input } from '@syr-is/ui/input';
	import { Label } from '@syr-is/ui/label';
	import { Button } from '@syr-is/ui/button';
	import { toast } from 'svelte-sonner';
	import { invalidateAll } from '$app/navigation';
	import { RefreshCw, Pencil } from 'lucide-svelte';

	type FollowRow = {
		followed_did: string;
		source_registry: string | null;
		/** Persisted provider base URL; may be absent on legacy rows. */
		followed_provider_url?: string | null;
		is_public?: boolean;
		created_at: string;
	};

	type EnrichedFollow = FollowRow & {
		displayName: string;
		username: string;
		avatarUrl: string | null;
		bannerUrl: string | null;
		profileHref: string | null;
		instanceHost: string | null;
	};

	let { data } = $props();

	let enriched = $state<EnrichedFollow[]>([]);
	let loading = $state(true);

	let editUrlOpen = $state(false);
	let editUrlDid = $state('');
	let editUrlValue = $state('');
	let editUrlSaving = $state(false);
	let refreshBusyDid = $state<string | null>(null);

	const editUrlWarningId = 'follow-edit-provider-warning';

	async function loadDiscoveryBases(): Promise<string[]> {
		const res = await fetch('/api/user/discovery-registries');
		if (!res.ok) return [];
		const j = (await res.json()) as { data?: { registry_url: string }[] };
		const bases: string[] = [];
		for (const r of j.data ?? []) {
			try {
				bases.push(registryApiRoot(r.registry_url));
			} catch {
				/* skip */
			}
		}
		return bases;
	}

	async function resolveProviderForFollow(
		f: FollowRow,
		discoveryBases: string[]
	): Promise<string | null> {
		const stored = f.followed_provider_url
			? normalizeProviderBaseUrl(f.followed_provider_url)
			: null;
		if (stored) return stored;

		const reg = f.source_registry?.trim();
		if (reg) {
			try {
				const root = registryApiRoot(reg);
				const p = await resolveProvider(f.followed_did, { registryUrl: root, timeout: 10_000 });
				const safe = normalizeProviderBaseUrl(p);
				if (safe) return safe;
			} catch {
				/* fall through */
			}
		}
		for (const b of discoveryBases) {
			try {
				const p = await resolveProvider(f.followed_did, { registryUrl: b, timeout: 8_000 });
				const safe = normalizeProviderBaseUrl(p);
				if (safe) return safe;
			} catch {
				/* try next */
			}
		}
		return null;
	}

	async function enrichFollow(f: FollowRow, discoveryBases: string[]): Promise<EnrichedFollow> {
		const provider = await resolveProviderForFollow(f, discoveryBases);
		let displayName =
			f.followed_did.length > 20 ? `${f.followed_did.slice(0, 14)}…` : f.followed_did;
		let username = '—';
		let avatarUrl: string | null = null;
		let bannerUrl: string | null = null;
		let profileHref: string | null = null;

		if (provider) {
			const mUrl = manifestUrl(provider, f.followed_did);
			const manifest = await fetchManifest(mUrl, 8_000);
			const ep: RemoteEndpoints = manifest
				? endpointsFromManifest(manifest)
				: fallbackEndpoints(provider, f.followed_did);
			profileHref = ep.web_profile;
			try {
				const res = await fetch(ep.profile, { signal: AbortSignal.timeout(8_000) });
				if (res.ok) {
					const j = (await res.json()) as {
						data?: {
							username?: string;
							display_name?: string | null;
							avatar_url?: string | null;
							banner_url?: string | null;
						};
					};
					const d = j.data;
					if (d) {
						const u = d.username?.trim() || '';
						displayName = (d.display_name?.trim() || u || displayName) as string;
						username = u || '—';
						avatarUrl = d.avatar_url ?? null;
						bannerUrl = d.banner_url ?? null;
					}
				}
			} catch {
				/* keep DID fallback */
			}
		}

		let instanceHost: string | null = null;
		if (provider) {
			try {
				instanceHost = new URL(provider).host;
			} catch {
				/* skip */
			}
		}

		return {
			...f,
			displayName,
			username,
			avatarUrl,
			bannerUrl,
			profileHref,
			instanceHost
		};
	}

	function openEditProviderUrl(row: EnrichedFollow) {
		editUrlDid = row.followed_did;
		editUrlValue = row.followed_provider_url ?? '';
		editUrlOpen = true;
	}

	async function saveEditProviderUrl() {
		if (!editUrlDid) return;
		editUrlSaving = true;
		try {
			const res = await fetch('/api/follows', {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				credentials: 'include',
				body: JSON.stringify({
					followed_did: editUrlDid,
					followed_provider_url: editUrlValue.trim()
				})
			});
			const j = (await res.json()) as { message?: string; error?: { message?: string } };
			if (!res.ok) {
				toast.error(j.error?.message ?? j.message ?? 'Could not update instance URL');
				return;
			}
			toast.success('Instance URL updated');
			editUrlOpen = false;
			await invalidateAll();
		} catch {
			toast.error('Could not update instance URL');
		} finally {
			editUrlSaving = false;
		}
	}

	async function refreshProviderFromRegistry(did: string) {
		refreshBusyDid = did;
		try {
			const res = await fetch('/api/follows/refresh', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				credentials: 'include',
				body: JSON.stringify({ followed_did: did })
			});
			const j = (await res.json()) as { message?: string; error?: { message?: string } };
			if (!res.ok) {
				toast.error(j.error?.message ?? j.message ?? 'Could not refresh from registry');
				return;
			}
			toast.success('Provider URL refreshed from registry');
			await invalidateAll();
		} catch {
			toast.error('Could not refresh from registry');
		} finally {
			refreshBusyDid = null;
		}
	}

	async function togglePublic(row: EnrichedFollow) {
		const newVal = !row.is_public;
		try {
			const res = await fetch('/api/follows/visibility', {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				credentials: 'include',
				body: JSON.stringify({
					followed_did: row.followed_did,
					followed_provider_url: row.followed_provider_url ?? undefined,
					is_public: newVal
				})
			});
			if (!res.ok) {
				const j = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
				toast.error(j.error?.message ?? 'Could not update visibility');
				return;
			}
			row.is_public = newVal;
			enriched = [...enriched];
			toast.success(newVal ? 'Follow is now public' : 'Follow is now private');
		} catch {
			toast.error('Could not update visibility');
		}
	}

	$effect(() => {
		const raw = data.follows;
		if (!raw?.length) {
			enriched = [];
			loading = false;
			return;
		}

		loading = true;
		let cancelled = false;

		void (async () => {
			try {
				const discoveryBases = await loadDiscoveryBases();
				const out: EnrichedFollow[] = [];
				for (const f of raw) {
					if (cancelled) return;
					out.push(await enrichFollow(f, discoveryBases));
					enriched = [...out];
				}
			} catch (e) {
				console.error('Following enrich failed:', e);
				if (!cancelled) enriched = [];
			} finally {
				if (!cancelled) loading = false;
			}
		})();

		return () => {
			cancelled = true;
		};
	});
</script>

<div class="mx-auto max-w-3xl space-y-6 p-4">
	<div>
		<h1 class="text-2xl font-semibold tracking-tight">Following</h1>
		<p class="mt-1 text-sm text-muted-foreground">
			Identities you follow from this account ({data.follows.length} total). Open a profile on its home
			instance.
		</p>
	</div>

	{#if loading && enriched.length === 0}
		<p class="text-sm text-muted-foreground">Loading profiles…</p>
	{:else if data.follows.length === 0}
		<div class="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
			You are not following anyone yet. Use
			<a href={resolve('/search')} class="font-medium text-primary underline">Search</a>
			to find people on your discovery registries.
		</div>
	{:else}
		<ul class="space-y-4">
			{#each enriched as row (row.followed_did)}
				<li>
					<PersonaDirectoryRow
						displayName={row.displayName}
						username={row.username}
						did={row.followed_did}
						avatarUrl={row.avatarUrl}
						bannerUrl={row.bannerUrl}
						instanceHost={row.instanceHost}
						openDisabled={!row.profileHref}
						onOpen={() => {
							if (row.profileHref) {
								window.open(row.profileHref, '_blank', 'noopener,noreferrer');
							}
						}}
					>
						{#snippet cardFooter()}
							{#if row.followed_provider_url}
								<p class="font-mono text-[11px] break-all text-muted-foreground">
									Instance: {row.followed_provider_url}
								</p>
							{/if}
							{#if !row.profileHref}
								<p class="text-xs text-muted-foreground">
									Could not resolve a profile URL—set the instance URL manually, refresh from
									registry, or check Settings → Discovery.
								</p>
							{/if}
							<div class="flex flex-wrap gap-2">
								<Button
									type="button"
									variant={row.is_public ? 'default' : 'outline'}
									size="sm"
									class="gap-1.5"
									onclick={() => togglePublic(row)}
								>
									{row.is_public ? 'Public' : 'Private'}
								</Button>
								<Button
									type="button"
									variant="outline"
									size="sm"
									class="gap-1.5"
									onclick={() => openEditProviderUrl(row)}
								>
									<Pencil class="h-3.5 w-3.5" aria-hidden="true" />
									Edit instance URL
								</Button>
								<Button
									type="button"
									variant="secondary"
									size="sm"
									class="gap-1.5"
									disabled={refreshBusyDid === row.followed_did}
									onclick={() => refreshProviderFromRegistry(row.followed_did)}
								>
									<RefreshCw
										class="h-3.5 w-3.5 {refreshBusyDid === row.followed_did ? 'animate-spin' : ''}"
										aria-hidden="true"
									/>
									Refresh from registry
								</Button>
							</div>
						{/snippet}
					</PersonaDirectoryRow>
				</li>
			{/each}
		</ul>
	{/if}
</div>

<Dialog.Root bind:open={editUrlOpen}>
	<Dialog.Content class="max-w-md" aria-describedby={editUrlWarningId}>
		<Dialog.Header>
			<Dialog.Title>Edit instance URL</Dialog.Title>
			<Dialog.Description>
				Base URL of the Syr instance that hosts this identity (e.g. https://social.example.com).
			</Dialog.Description>
		</Dialog.Header>
		<div
			id={editUrlWarningId}
			class="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm"
		>
			<strong class="text-foreground">Warning:</strong> Manual changes can <strong>break</strong>
			this follow—wrong hosts, typos, or servers that are not the real home for this DID will fail or
			show the wrong content. Only do this if you know what you are doing. If this identity moved hosts
			and the registry is up to date, use <strong>Refresh from registry</strong> instead.
		</div>
		<div class="space-y-2 py-2">
			<Label for="follow-provider-url">Instance base URL</Label>
			<Input
				id="follow-provider-url"
				type="url"
				placeholder="https://…"
				bind:value={editUrlValue}
				disabled={editUrlSaving}
				autocomplete="off"
			/>
		</div>
		<Dialog.Footer class="gap-2 sm:gap-0">
			<Button
				type="button"
				variant="outline"
				disabled={editUrlSaving}
				onclick={() => (editUrlOpen = false)}
			>
				Cancel
			</Button>
			<Button
				type="button"
				variant="default"
				disabled={editUrlSaving}
				onclick={() => saveEditProviderUrl()}
			>
				{editUrlSaving ? 'Saving…' : 'Save anyway'}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
