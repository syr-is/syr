<script lang="ts">
	import PersonaDirectoryRow from '$lib/components/fragments/persona-directory-row.svelte';
	import { resolveProvider } from '@syr-is/resolver';
	import { registryApiRoot } from '$lib/registry-url';
	import { resolve } from '$app/paths';

	type FollowRow = {
		followed_did: string;
		source_registry: string | null;
		created_at: string;
	};

	type EnrichedFollow = FollowRow & {
		displayName: string;
		username: string;
		avatarUrl: string | null;
		bannerUrl: string | null;
		profileHref: string | null;
	};

	let { data } = $props();

	let enriched = $state<EnrichedFollow[]>([]);
	let loading = $state(true);

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

	function httpHttpsProviderUrl(raw: string): string | null {
		try {
			const u = new URL(raw.trim());
			if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
			return raw.trim().replace(/\/$/, '');
		} catch {
			return null;
		}
	}

	async function resolveProviderForFollow(
		f: FollowRow,
		discoveryBases: string[]
	): Promise<string | null> {
		const reg = f.source_registry?.trim();
		if (reg) {
			try {
				const root = registryApiRoot(reg);
				const p = await resolveProvider(f.followed_did, { registryUrl: root, timeout: 10_000 });
				const safe = httpHttpsProviderUrl(p);
				if (safe) return safe;
			} catch {
				/* fall through */
			}
		}
		for (const b of discoveryBases) {
			try {
				const p = await resolveProvider(f.followed_did, { registryUrl: b, timeout: 8_000 });
				const safe = httpHttpsProviderUrl(p);
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
			profileHref = `${provider}/u/${encodeURIComponent(f.followed_did)}`;
			try {
				const res = await fetch(
					`${provider}/api/public/profile/${encodeURIComponent(f.followed_did)}`,
					{ signal: AbortSignal.timeout(8_000) }
				);
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

		return {
			...f,
			displayName,
			username,
			avatarUrl,
			bannerUrl,
			profileHref
		};
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
						openDisabled={!row.profileHref}
						onOpen={() => {
							if (row.profileHref) {
								window.open(row.profileHref, '_blank', 'noopener,noreferrer');
							}
						}}
					/>
					{#if !row.profileHref}
						<p class="mt-1 px-1 text-xs text-muted-foreground">
							Could not resolve a profile URL—check Settings → Discovery and that this DID is listed
							on a registry you use.
						</p>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}
</div>
