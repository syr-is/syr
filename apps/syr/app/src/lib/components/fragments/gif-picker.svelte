<script lang="ts">
	import * as Popover from '@syr-is/ui/popover';
	import * as Tabs from '@syr-is/ui/tabs';
	import { Input } from '@syr-is/ui/input';
	import { Button } from '@syr-is/ui/button';
	import { Film } from 'lucide-svelte';

	type GifEntry = {
		did?: string;
		local_id?: string;
		url: string;
		thumbnail_url?: string | null;
		tags: string[];
		size: number;
	};

	let {
		onSelect,
		triggerClass = '',
		onOpenChange
	}: {
		onSelect?: (gif: GifEntry) => void;
		triggerClass?: string;
		onOpenChange?: (open: boolean) => void;
	} = $props();

	let open = $state(false);

	$effect(() => {
		onOpenChange?.(open);
	});
	let search = $state('');
	let instanceGifs = $state<GifEntry[]>([]);
	let userGifs = $state<GifEntry[]>([]);
	let loading = $state(false);
	let activeTab = $state('instance');
	let searchTimeout: ReturnType<typeof setTimeout> | null = null;
	let hasLoaded = false;

	async function loadGifs(query?: string) {
		const isFirstLoad = !hasLoaded;
		hasLoaded = true;
		loading = true;
		try {
			const qs = query?.trim()
				? `?search=${encodeURIComponent(query.trim())}&limit=30`
				: '?limit=30';

			try {
				const instanceRes = await fetch(`/api/public/gifs${qs}`);
				if (instanceRes.ok) {
					const json = await instanceRes.json();
					if (json.status === 'success') instanceGifs = json.data ?? [];
				}
			} catch {
				/* instance GIFs unavailable */
			}

			// Load user GIFs on first open (not on search refreshes)
			if (isFirstLoad) {
				try {
					const userRes = await fetch('/api/gifs?limit=30');
					if (userRes.ok) {
						const json = await userRes.json();
						if (json.status === 'success') userGifs = json.data ?? [];
					}
				} catch {
					/* not logged in */
				}
			}
		} finally {
			loading = false;
		}
	}

	$effect(() => {
		if (open && !hasLoaded) loadGifs();
	});

	function handleSearch(e: Event) {
		const value = (e.target as HTMLInputElement).value;
		search = value;
		if (searchTimeout) clearTimeout(searchTimeout);
		searchTimeout = setTimeout(() => loadGifs(value), 300);
	}

	function selectGif(gif: GifEntry) {
		onSelect?.(gif);
		open = false;
	}
</script>

<Popover.Root bind:open>
	<Popover.Trigger>
		<Button variant="ghost" size="icon-sm" class={triggerClass} type="button">
			<Film class="h-4 w-4" />
		</Button>
	</Popover.Trigger>
	<Popover.Content class="w-96 p-0" align="start">
		<div class="flex flex-col">
			<div class="border-b p-2">
				<Input
					type="search"
					placeholder="Search GIFs..."
					class="h-8 text-xs"
					value={search}
					oninput={handleSearch}
				/>
			</div>
			<Tabs.Root bind:value={activeTab}>
				<Tabs.List class="w-full justify-start rounded-none border-b px-2">
					<Tabs.Trigger value="instance" class="text-xs">Instance</Tabs.Trigger>
					<Tabs.Trigger value="personal" class="text-xs">My GIFs</Tabs.Trigger>
				</Tabs.List>
				<Tabs.Content value="instance" class="max-h-72 overflow-y-auto p-2">
					{#if loading}
						<p class="py-4 text-center text-xs text-muted-foreground">Loading...</p>
					{:else if instanceGifs.length === 0}
						<p class="py-4 text-center text-xs text-muted-foreground">No GIFs found</p>
					{:else}
						<div class="grid grid-cols-3 gap-1">
							{#each instanceGifs as gif (gif.url)}
								<button
									type="button"
									class="overflow-hidden rounded hover:ring-2 hover:ring-primary"
									onclick={() => selectGif(gif)}
								>
									<img
										src={gif.thumbnail_url ?? gif.url}
										alt="GIF"
										class="aspect-square w-full object-cover"
										loading="lazy"
									/>
								</button>
							{/each}
						</div>
					{/if}
				</Tabs.Content>
				<Tabs.Content value="personal" class="max-h-72 overflow-y-auto p-2">
					{#if loading}
						<p class="py-4 text-center text-xs text-muted-foreground">Loading...</p>
					{:else if userGifs.length === 0}
						<p class="py-4 text-center text-xs text-muted-foreground">No personal GIFs</p>
					{:else}
						<div class="grid grid-cols-3 gap-1">
							{#each userGifs as gif (gif.url)}
								<button
									type="button"
									class="overflow-hidden rounded hover:ring-2 hover:ring-primary"
									onclick={() => selectGif(gif)}
								>
									<img
										src={gif.thumbnail_url ?? gif.url}
										alt="GIF"
										class="aspect-square w-full object-cover"
										loading="lazy"
									/>
								</button>
							{/each}
						</div>
					{/if}
				</Tabs.Content>
			</Tabs.Root>
		</div>
	</Popover.Content>
</Popover.Root>
