<script lang="ts">
	import * as Popover from '@syr-is/ui/popover';
	import * as Tabs from '@syr-is/ui/tabs';
	import { Input } from '@syr-is/ui/input';
	import { Button } from '@syr-is/ui/button';
	import { Smile } from 'lucide-svelte';
	import { getInstanceEmojis } from '$lib/stores/emoji-cache';

	type EmojiEntry = {
		shortcode: string;
		url: string;
		is_sticker: boolean;
	};

	let {
		onSelect,
		triggerClass = '',
		triggerIcon = Smile,
		triggerTitle = 'Emoji',
		onOpenChange
	}: {
		onSelect?: (emoji: EmojiEntry) => void;
		triggerClass?: string;
		triggerIcon?: typeof Smile;
		triggerTitle?: string;
		onOpenChange?: (open: boolean) => void;
	} = $props();

	let open = $state(false);

	$effect(() => {
		onOpenChange?.(open);
	});
	let search = $state('');
	let instanceEmojis = $state<EmojiEntry[]>([]);
	let userEmojis = $state<EmojiEntry[]>([]);
	let loading = $state(false);
	let activeTab = $state('instance');
	let hasLoaded = false;

	async function loadEmojis() {
		if (hasLoaded) return;
		hasLoaded = true;
		loading = true;
		try {
			instanceEmojis = await getInstanceEmojis();

			try {
				const userRes = await fetch('/api/emojis?limit=100');
				if (userRes.ok) {
					const json = await userRes.json();
					if (json.status === 'success') userEmojis = json.data ?? [];
				}
			} catch {
				/* not logged in */
			}
		} catch {
			/* skip */
		} finally {
			loading = false;
		}
	}

	$effect(() => {
		if (open && !hasLoaded) loadEmojis();
	});

	const filteredInstance = $derived(
		search.trim()
			? instanceEmojis.filter((e) =>
					e.shortcode.toLowerCase().includes(search.trim().toLowerCase())
				)
			: instanceEmojis
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
		<Button variant="ghost" size="icon-sm" class={triggerClass} type="button" title={triggerTitle}>
			<svelte:component this={triggerIcon} class="h-4 w-4" />
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
