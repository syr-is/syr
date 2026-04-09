<script lang="ts">
	import * as Popover from '@syr-is/ui/popover';
	import * as Tabs from '@syr-is/ui/tabs';
	import { Input } from '@syr-is/ui/input';
	import { Button } from '@syr-is/ui/button';
	import { Smile } from 'lucide-svelte';

	type EmojiEntry = {
		shortcode: string;
		url: string;
		is_sticker: boolean;
	};

	type EmojiPack = {
		slug: string;
		name: string;
		emojis: EmojiEntry[];
	};

	let {
		onSelect,
		triggerClass = ''
	}: {
		onSelect?: (emoji: EmojiEntry) => void;
		triggerClass?: string;
	} = $props();

	let open = $state(false);
	let search = $state('');
	let packs = $state<EmojiPack[]>([]);
	let userEmojis = $state<EmojiEntry[]>([]);
	let loading = $state(false);
	let activeTab = $state('instance');
	let hasLoaded = false;

	async function loadEmojis() {
		if (hasLoaded) return;
		hasLoaded = true;
		loading = true;
		try {
			const res = await fetch('/api/public/emojis');
			if (res.ok) {
				const json = await res.json();
				if (json.status === 'success') packs = json.data.packs ?? [];
			}

			// Try personal emojis — will 401 if not logged in, that's fine
			try {
				const userRes = await fetch('/api/emojis?limit=100');
				if (userRes.ok) {
					const json = await userRes.json();
					if (json.status === 'success') userEmojis = json.data ?? [];
				}
			} catch {
				// Not logged in or no personal emojis
			}
		} catch {
			// Instance emojis unavailable
		} finally {
			loading = false;
		}
	}

	$effect(() => {
		if (open && !hasLoaded) loadEmojis();
	});

	const allInstanceEmojis = $derived(packs.flatMap((p) => p.emojis));

	const filteredInstance = $derived(
		search.trim()
			? allInstanceEmojis.filter((e) =>
					e.shortcode.toLowerCase().includes(search.trim().toLowerCase())
				)
			: allInstanceEmojis
	);

	const filteredUser = $derived(
		search.trim()
			? userEmojis.filter((e) => e.shortcode.toLowerCase().includes(search.trim().toLowerCase()))
			: userEmojis
	);

	function selectEmoji(emoji: EmojiEntry) {
		onSelect?.(emoji);
		open = false;
	}
</script>

<Popover.Root bind:open>
	<Popover.Trigger>
		<Button variant="ghost" size="icon-sm" class={triggerClass} type="button">
			<Smile class="h-4 w-4" />
		</Button>
	</Popover.Trigger>
	<Popover.Content class="w-80 p-0" align="start">
		<div class="flex flex-col">
			<div class="border-b p-2">
				<Input
					type="search"
					placeholder="Search emojis..."
					class="h-8 text-xs"
					bind:value={search}
				/>
			</div>
			<Tabs.Root bind:value={activeTab}>
				<Tabs.List class="w-full justify-start rounded-none border-b px-2">
					<Tabs.Trigger value="instance" class="text-xs">Instance</Tabs.Trigger>
					<Tabs.Trigger value="personal" class="text-xs">My Emojis</Tabs.Trigger>
				</Tabs.List>
				<Tabs.Content value="instance" class="max-h-60 overflow-y-auto p-2">
					{#if loading}
						<p class="py-4 text-center text-xs text-muted-foreground">Loading...</p>
					{:else if filteredInstance.length === 0}
						<p class="py-4 text-center text-xs text-muted-foreground">No emojis found</p>
					{:else}
						<div class="grid grid-cols-8 gap-1">
							{#each filteredInstance as emoji (emoji.shortcode)}
								<button
									type="button"
									class="flex h-8 w-8 items-center justify-center rounded hover:bg-accent"
									title={`:${emoji.shortcode}:`}
									onclick={() => selectEmoji(emoji)}
								>
									<img
										src={emoji.url}
										alt={emoji.shortcode}
										class="h-6 w-6 object-contain"
										loading="lazy"
									/>
								</button>
							{/each}
						</div>
					{/if}
				</Tabs.Content>
				<Tabs.Content value="personal" class="max-h-60 overflow-y-auto p-2">
					{#if loading}
						<p class="py-4 text-center text-xs text-muted-foreground">Loading...</p>
					{:else if filteredUser.length === 0}
						<p class="py-4 text-center text-xs text-muted-foreground">No personal emojis</p>
					{:else}
						<div class="grid grid-cols-8 gap-1">
							{#each filteredUser as emoji (emoji.shortcode)}
								<button
									type="button"
									class="flex h-8 w-8 items-center justify-center rounded hover:bg-accent"
									title={`:${emoji.shortcode}:`}
									onclick={() => selectEmoji(emoji)}
								>
									<img
										src={emoji.url}
										alt={emoji.shortcode}
										class="h-6 w-6 object-contain"
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
