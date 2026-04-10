<script lang="ts">
	import * as Popover from '@syr-is/ui/popover';
	import * as Tabs from '@syr-is/ui/tabs';
	import { Input } from '@syr-is/ui/input';
	import { Button } from '@syr-is/ui/button';
	import { Smile } from 'lucide-svelte';
	import { getInstanceEmojis } from '$lib/stores/emoji-cache';
	import { UNICODE_EMOJI_CATEGORIES, ALL_UNICODE_EMOJIS } from '$lib/data/unicode-emojis';

	export type EmojiSelection = {
		shortcode: string;
		url: string;
		is_sticker: boolean;
		/** When true this is a native unicode emoji (shortcode is the character itself) */
		unicode: boolean;
	};

	type CustomEntry = {
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
		onSelect?: (emoji: EmojiSelection) => void;
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
	let instanceEmojis = $state<CustomEntry[]>([]);
	let userEmojis = $state<CustomEntry[]>([]);
	let loading = $state(false);
	let activeTab = $state('unicode');
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

	const filteredUnicode = $derived(
		search.trim() ? ALL_UNICODE_EMOJIS.filter((e) => e.includes(search.trim())) : null
	);

	function selectCustom(emoji: CustomEntry) {
		onSelect?.({ ...emoji, unicode: false });
		open = false;
	}

	function selectUnicode(char: string) {
		onSelect?.({ shortcode: char, url: '', is_sticker: false, unicode: true });
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
					<Tabs.Trigger value="unicode" class="text-xs">Emoji</Tabs.Trigger>
					<Tabs.Trigger value="instance" class="text-xs">Instance</Tabs.Trigger>
					<Tabs.Trigger value="personal" class="text-xs">Mine</Tabs.Trigger>
				</Tabs.List>

				<Tabs.Content value="unicode" class="max-h-60 overflow-y-auto p-2">
					{#if filteredUnicode}
						{#if filteredUnicode.length === 0}
							<p class="py-4 text-center text-xs text-muted-foreground">No emojis found</p>
						{:else}
							<div class="grid grid-cols-8 gap-1">
								{#each filteredUnicode as char (char)}
									<button
										type="button"
										class="flex h-8 w-8 items-center justify-center rounded text-lg hover:bg-accent"
										title={char}
										onclick={() => selectUnicode(char)}
									>
										{char}
									</button>
								{/each}
							</div>
						{/if}
					{:else}
						{#each UNICODE_EMOJI_CATEGORIES as cat (cat.name)}
							<p class="mt-2 mb-1 text-[10px] font-medium text-muted-foreground first:mt-0">
								{cat.name}
							</p>
							<div class="grid grid-cols-8 gap-1">
								{#each cat.emojis as char (char)}
									<button
										type="button"
										class="flex h-8 w-8 items-center justify-center rounded text-lg hover:bg-accent"
										title={char}
										onclick={() => selectUnicode(char)}
									>
										{char}
									</button>
								{/each}
							</div>
						{/each}
					{/if}
				</Tabs.Content>

				<Tabs.Content value="instance" class="max-h-60 overflow-y-auto p-2">
					{#if loading}
						<p class="py-4 text-center text-xs text-muted-foreground">Loading...</p>
					{:else if filteredInstance.length === 0}
						<p class="py-4 text-center text-xs text-muted-foreground">No instance emojis</p>
					{:else}
						<div class="grid grid-cols-8 gap-1">
							{#each filteredInstance as emoji (emoji.shortcode)}
								<button
									type="button"
									class="flex h-8 w-8 items-center justify-center rounded hover:bg-accent"
									title={`:${emoji.shortcode}:`}
									onclick={() => selectCustom(emoji)}
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
									onclick={() => selectCustom(emoji)}
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
