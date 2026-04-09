<script lang="ts">
	import * as Card from '@syr-is/ui/card';
	import * as Table from '@syr-is/ui/table';
	import { Button } from '@syr-is/ui/button';
	import { toast } from 'svelte-sonner';
	import { Trash2 } from 'lucide-svelte';

	type EmojiRow = {
		id: string;
		did: string;
		local_id: string;
		shortcode: string;
		url: string;
		is_sticker: boolean;
		mime_type: string;
		size: number;
	};

	let emojis = $state<EmojiRow[]>([]);
	let loading = $state(true);

	async function loadEmojis() {
		loading = true;
		try {
			const res = await fetch('/api/emojis?limit=100');
			if (res.ok) {
				const json = await res.json();
				if (json.status === 'success') emojis = json.data ?? [];
			}
		} finally {
			loading = false;
		}
	}

	async function deleteEmoji(did: string, localId: string) {
		try {
			const res = await fetch(
				`/api/emojis/${encodeURIComponent(did)}/${encodeURIComponent(localId)}`,
				{ method: 'DELETE' }
			);
			if (!res.ok) {
				toast.error('Failed to delete');
				return;
			}
			toast.success('Emoji deleted');
			loadEmojis();
		} catch {
			toast.error('Failed to delete');
		}
	}

	$effect(() => {
		loadEmojis();
	});
</script>

<svelte:head>
	<title>Emojis & Stickers | Settings | SYR</title>
</svelte:head>

<div class="mx-auto max-w-2xl space-y-6">
	<Card.Root>
		<Card.Header>
			<Card.Title>My Custom Emojis & Stickers</Card.Title>
			<Card.Description>
				Your personal emojis and stickers. To add new ones, go to your
				<a href="/uploads" class="font-medium text-primary underline-offset-4 hover:underline"
					>Uploads</a
				>
				page, find an image, and select "Add as Emoji" or "Add as Sticker" from its menu.
			</Card.Description>
		</Card.Header>
		<Card.Content>
			<Table.Root>
				<Table.Header>
					<Table.Row>
						<Table.Head>Preview</Table.Head>
						<Table.Head>Shortcode</Table.Head>
						<Table.Head>Type</Table.Head>
						<Table.Head class="text-right">Actions</Table.Head>
					</Table.Row>
				</Table.Header>
				<Table.Body>
					{#if loading}
						<Table.Row>
							<Table.Cell colspan={4} class="py-4 text-center text-muted-foreground"
								>Loading...</Table.Cell
							>
						</Table.Row>
					{:else if emojis.length === 0}
						<Table.Row>
							<Table.Cell colspan={4} class="py-4 text-center text-muted-foreground">
								No custom emojis yet. Add them from the
								<a
									href="/uploads"
									class="font-medium text-primary underline-offset-4 hover:underline">Uploads</a
								> page.
							</Table.Cell>
						</Table.Row>
					{:else}
						{#each emojis as emoji (emoji.id)}
							<Table.Row>
								<Table.Cell>
									{#if emoji.url}
										<img src={emoji.url} alt={emoji.shortcode} class="h-8 w-8 object-contain" />
									{:else}
										<span class="text-xs text-muted-foreground">No image</span>
									{/if}
								</Table.Cell>
								<Table.Cell class="font-mono text-sm">:{emoji.shortcode}:</Table.Cell>
								<Table.Cell class="text-xs">{emoji.is_sticker ? 'Sticker' : 'Emoji'}</Table.Cell>
								<Table.Cell class="text-right">
									<Button
										variant="destructive"
										size="sm"
										onclick={() => deleteEmoji(emoji.did, emoji.local_id)}
									>
										<Trash2 class="h-3.5 w-3.5" />
									</Button>
								</Table.Cell>
							</Table.Row>
						{/each}
					{/if}
				</Table.Body>
			</Table.Root>
		</Card.Content>
	</Card.Root>
</div>
