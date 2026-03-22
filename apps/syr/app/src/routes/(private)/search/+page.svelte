<script lang="ts">
	import { Button } from '@syr-is/ui/button';
	import { Input } from '@syr-is/ui/input';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import PersonaDirectoryRow from '$lib/components/fragments/persona-directory-row.svelte';

	let q = $state('');
	let loading = $state(false);
	let searchError = $state<string | null>(null);
	let results = $state<
		Array<{
			did: string;
			username: string;
			displayName: string;
			provider: string;
			registryUrl: string;
			avatarUrl: string | null;
			bannerUrl: string | null;
		}>
	>([]);
	let directoryHint = $state<string | null>(null);

	async function runSearch() {
		loading = true;
		searchError = null;
		directoryHint = null;
		try {
			const trimmed = q.trim();
			const qs = trimmed ? `?q=${encodeURIComponent(trimmed)}` : '';
			const res = await fetch(`${resolve('/api/search/directory')}${qs}`);
			if (!res.ok) {
				results = [];
				let msg = 'Search failed';
				try {
					const j = (await res.json()) as { error?: { message?: string }; message?: string };
					msg = j.error?.message ?? j.message ?? msg;
				} catch {
					/* non-JSON body */
				}
				searchError = msg;
				return;
			}
			const j = (await res.json()) as {
				data?: typeof results;
				meta?: { message?: string };
			};
			results = j.data ?? [];
			directoryHint =
				results.length === 0 && j.meta?.message?.trim() ? j.meta.message.trim() : null;
		} finally {
			loading = false;
		}
	}
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
		<Input placeholder="Username, display name, or DID fragment" bind:value={q} class="flex-1" />
		<Button type="submit" disabled={loading}>{loading ? 'Searching…' : 'Search'}</Button>
	</form>

	{#if searchError}
		<p class="text-sm text-destructive">{searchError}</p>
	{/if}

	{#if directoryHint && !searchError}
		<p class="text-sm text-muted-foreground">{directoryHint}</p>
	{/if}

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
</div>
