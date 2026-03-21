<script lang="ts">
	import { Button } from '@syr-is/ui/button';
	import { Input } from '@syr-is/ui/input';
	import * as Card from '@syr-is/ui/card';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';

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
		}>
	>([]);

	async function runSearch() {
		loading = true;
		searchError = null;
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
			const j = (await res.json()) as { data?: typeof results };
			results = j.data ?? [];
		} finally {
			loading = false;
		}
	}
</script>

<div class="mx-auto max-w-3xl space-y-6 p-4">
	<h1 class="text-2xl font-semibold">Search directory</h1>
	<p class="text-sm text-muted-foreground">
		Queries each registry you have configured for your identity and merges public, opted-in
		listings.
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

	<ul class="space-y-2">
		{#each results as row (row.did)}
			<li>
				<Card.Root>
					<Card.Header class="flex flex-row items-center justify-between gap-2 py-3">
						<div>
							<Card.Title class="text-base">{row.displayName}</Card.Title>
							<Card.Description class="font-mono text-xs">@{row.username}</Card.Description>
							<p class="mt-1 font-mono text-xs text-muted-foreground">{row.did}</p>
						</div>
						<Button
							size="sm"
							variant="outline"
							onclick={() => goto(resolve(`/u/${encodeURIComponent(row.did)}`))}
						>
							Open
						</Button>
					</Card.Header>
				</Card.Root>
			</li>
		{/each}
	</ul>
</div>
