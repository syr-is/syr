<script lang="ts">
	import { Button } from '@syr-is/ui/button';
	import { Input } from '@syr-is/ui/input';
	import { Progress } from '@syr-is/ui/progress';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import PersonaDirectoryRow from '$lib/components/fragments/persona-directory-row.svelte';
	import { Loader2 } from 'lucide-svelte';
	import { SvelteMap, SvelteURLSearchParams } from 'svelte/reactivity';

	type DirectoryRow = {
		did: string;
		username: string;
		displayName: string;
		provider: string;
		updatedAt: string;
		registryUrl: string;
		avatarUrl?: string | null;
		bannerUrl?: string | null;
	};

	let q = $state('');
	let loading = $state(false);
	let searchError = $state<string | null>(null);
	let directoryHint = $state<string | null>(null);

	let totalRegistries = $state(0);
	let completedRegistries = $state(0);

	/** Internal map keyed by DID for dedup — not reactive. */
	let mergedMap = new SvelteMap<string, DirectoryRow>();
	/** Reactive sorted result list, rebuilt on each registry response. */
	let results = $state<DirectoryRow[]>([]);

	let activeAbort: AbortController | null = null;

	function parseUpdatedAtMs(iso: string): number {
		const t = Date.parse(iso);
		return Number.isNaN(t) ? 0 : t;
	}

	function rebuildResults() {
		results = [...mergedMap.values()].sort((a, b) => {
			const tb = parseUpdatedAtMs(b.updatedAt);
			const ta = parseUpdatedAtMs(a.updatedAt);
			if (tb !== ta) return tb - ta;
			return a.did.localeCompare(b.did);
		});
	}

	const ENRICH_BATCH = 4;
	const ENRICH_TIMEOUT_MS = 8_000;

	/** Enrich a single row with avatar/banner via manifest → profile fetch. */
	async function enrichRow(row: DirectoryRow, signal: AbortSignal): Promise<void> {
		const base = row.provider.replace(/\/$/, '');
		let profileUrl = `${base}/api/public/profile/${encodeURIComponent(row.did)}`;
		try {
			const mRes = await fetch(`${base}/.well-known/syr/${encodeURIComponent(row.did)}`, {
				headers: { Accept: 'application/json' },
				signal
			});
			if (mRes.ok) {
				const manifest = await mRes.json();
				if (manifest.endpoints?.profile) profileUrl = manifest.endpoints.profile;
			}
		} catch {
			/* fallback */
		}

		const pRes = await fetch(profileUrl, { signal, headers: { Accept: 'application/json' } });
		if (!pRes.ok) return;
		const body = (await pRes.json()) as {
			data?: { avatar_url?: string | null; banner_url?: string | null };
		};
		row.avatarUrl = body.data?.avatar_url ?? null;
		row.bannerUrl = body.data?.banner_url ?? null;
	}

	/** Enrich results in queued batches of 4, each batch with an 8s timeout. */
	async function enrichResults(ac: AbortController) {
		const toEnrich = [...mergedMap.values()].filter((r) => r.avatarUrl === undefined && r.provider);
		for (let i = 0; i < toEnrich.length; i += ENRICH_BATCH) {
			if (ac.signal.aborted) return;
			const batch = toEnrich.slice(i, i + ENRICH_BATCH);

			const batchAc = new AbortController();
			const timeout = setTimeout(() => batchAc.abort(), ENRICH_TIMEOUT_MS);
			// Also abort if the search itself is cancelled
			const onSearchAbort = () => batchAc.abort();
			ac.signal.addEventListener('abort', onSearchAbort, { once: true });

			await Promise.allSettled(
				batch.map(async (row) => {
					try {
						await enrichRow(row, batchAc.signal);
					} catch {
						/* timeout or network error */
					}
					// Mark as attempted even on failure
					if (row.avatarUrl === undefined) row.avatarUrl = null;
					if (row.bannerUrl === undefined) row.bannerUrl = null;
					mergedMap.set(row.did, { ...row });
				})
			);

			clearTimeout(timeout);
			ac.signal.removeEventListener('abort', onSearchAbort);
			if (!ac.signal.aborted) rebuildResults();
		}
	}

	async function runSearch() {
		activeAbort?.abort();
		const ac = new AbortController();
		activeAbort = ac;

		loading = true;
		searchError = null;
		directoryHint = null;
		totalRegistries = 0;
		completedRegistries = 0;
		mergedMap = new SvelteMap();
		results = [];

		try {
			// 1. Fetch registry list
			const regRes = await fetch(resolve('/api/user/discovery-registries'), {
				signal: ac.signal
			});
			if (!regRes.ok) {
				searchError = 'Failed to load discovery registries';
				loading = false;
				return;
			}
			const regBody = (await regRes.json()) as { data?: { registry_url: string }[] };
			const registries = regBody.data ?? [];
			totalRegistries = registries.length;

			if (registries.length === 0) {
				directoryHint =
					'No discovery registries configured. Add registries under Settings → Discovery or ask your admin to add instance-wide registries.';
				loading = false;
				return;
			}

			// 2. Query each registry in parallel via proxy
			const trimmed = q.trim();
			await Promise.allSettled(
				registries.map(async (reg) => {
					if (ac.signal.aborted) return;
					try {
						const qs = new SvelteURLSearchParams();
						qs.set('registryUrl', reg.registry_url);
						if (trimmed) qs.set('q', trimmed);
						qs.set('limit', '50');

						const res = await fetch(`${resolve('/api/search/directory')}?${qs.toString()}`, {
							signal: ac.signal
						});
						if (!res.ok) return;

						const body = (await res.json()) as { data?: DirectoryRow[] };
						const rows = body.data ?? [];

						for (const row of rows) {
							const existing = mergedMap.get(row.did);
							if (
								!existing ||
								parseUpdatedAtMs(row.updatedAt) > parseUpdatedAtMs(existing.updatedAt)
							) {
								mergedMap.set(row.did, row);
							}
						}
						rebuildResults();
					} catch (err) {
						if (err instanceof DOMException && err.name === 'AbortError') return;
						console.debug('Registry query failed', { registry: reg.registry_url, err });
					} finally {
						if (!ac.signal.aborted) {
							completedRegistries++;
						}
					}
				})
			);

			if (!ac.signal.aborted && results.length === 0 && !searchError) {
				directoryHint = trimmed
					? 'No results found. Try a different search term.'
					: 'No users found in the directory.';
			}

			// Enrich with avatars/banners in the background
			if (!ac.signal.aborted && mergedMap.size > 0) {
				void enrichResults(ac);
			}
		} catch (err) {
			if (err instanceof DOMException && err.name === 'AbortError') return;
			console.error(err);
			searchError = err instanceof Error ? err.message : 'Network error';
		} finally {
			if (activeAbort === ac) {
				activeAbort = null;
				loading = false;
			}
		}
	}

	let progressPercent = $derived(
		totalRegistries > 0 ? Math.round((completedRegistries / totalRegistries) * 100) : 0
	);
</script>

<div class="mx-auto max-w-3xl space-y-6 p-4">
	<h1 class="text-2xl font-semibold">Search directory</h1>
	<p class="text-sm text-muted-foreground">
		Queries each <strong class="font-medium text-foreground">discovery registry</strong> you added under
		Settings → Discovery and merges public, opted-in listings. This list is separate from publication
		registries (where your own DID is listed).
	</p>
	<form
		class="flex gap-2"
		onsubmit={(e) => {
			e.preventDefault();
			void runSearch();
		}}
	>
		<Input
			id="directory-search-q"
			placeholder="Username, display name, or DID fragment"
			aria-label="Search users in directory"
			bind:value={q}
			class="flex-1"
		/>
		<Button type="submit" disabled={loading}>{loading ? 'Searching…' : 'Search'}</Button>
	</form>

	{#if loading && totalRegistries > 0}
		<div class="space-y-2">
			<div class="flex items-center gap-2 text-sm text-muted-foreground">
				<Loader2 class="h-4 w-4 animate-spin" />
				<span>
					Searching {completedRegistries} of {totalRegistries}
					{totalRegistries === 1 ? 'registry' : 'registries'}…
				</span>
			</div>
			<Progress value={progressPercent} class="h-1.5" />
		</div>
	{/if}

	{#if searchError}
		<p class="text-sm text-destructive" role="alert" aria-live="assertive">{searchError}</p>
	{/if}

	{#if directoryHint && !searchError}
		<p class="text-sm text-muted-foreground">{directoryHint}</p>
	{/if}

	{#if results.length > 0}
		<ul class="space-y-4">
			{#each results as row (row.did)}
				<li>
					<PersonaDirectoryRow
						displayName={row.displayName}
						username={row.username}
						did={row.did}
						avatarUrl={row.avatarUrl}
						bannerUrl={row.bannerUrl}
						onOpen={() => goto(resolve(`/u/${encodeURIComponent(row.did)}`))}
					/>
				</li>
			{/each}
		</ul>
	{/if}
</div>
