<script lang="ts">
	import * as Card from '$lib/components/ui/card';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
	import { FolderIcon, Globe, MoreVertical, Trash2 } from 'lucide-svelte';
	import type { Folder } from '@syr-is/types';

	let {
		folder,
		isPublic = false,
		onclick,
		onDelete
	}: {
		folder: Folder;
		isPublic?: boolean;
		onclick?: () => void;
		onDelete?: (folder: Folder) => void;
	} = $props();
</script>

<Card.Root
	class="cursor-pointer transition-colors hover:bg-accent"
	role="button"
	tabindex={0}
	{onclick}
	onkeydown={(e) => {
		if (e.key === 'Enter' || e.key === ' ') {
			e.preventDefault();
			onclick?.();
		}
	}}
>
	<Card.Content class="flex items-center gap-3 p-4">
		<div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted">
			{#if isPublic}
				<Globe class="h-5 w-5 text-primary" />
			{:else}
				<FolderIcon class="h-5 w-5 text-muted-foreground" />
			{/if}
		</div>
		<div class="min-w-0 flex-1">
			<p class="truncate font-medium">{folder.name}</p>
			{#if isPublic}
				<p class="text-xs text-muted-foreground">Public folder</p>
			{/if}
		</div>
		{#if onDelete}
			<DropdownMenu.Root>
				<DropdownMenu.Trigger
					class="rounded-md p-1 hover:bg-background"
					onclick={(e) => e.stopPropagation()}
				>
					<MoreVertical class="h-4 w-4" />
				</DropdownMenu.Trigger>
				<DropdownMenu.Content>
					<DropdownMenu.Item
						class="text-destructive"
						onclick={(e) => {
							e.stopPropagation();
							onDelete?.(folder);
						}}
					>
						<Trash2 class="mr-2 h-4 w-4" />
						Delete
					</DropdownMenu.Item>
				</DropdownMenu.Content>
			</DropdownMenu.Root>
		{/if}
	</Card.Content>
</Card.Root>
