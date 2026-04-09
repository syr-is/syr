<script lang="ts">
	import * as Card from '@syr-is/ui/card';
	import * as Table from '@syr-is/ui/table';
	import { Button } from '@syr-is/ui/button';
	import { Input } from '@syr-is/ui/input';
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

	// Upload form
	let shortcode = $state('');
	let isSticker = $state(false);
	let uploading = $state(false);

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

	async function createEmoji() {
		if (!shortcode.trim()) {
			toast.error('Enter a shortcode');
			return;
		}
		uploading = true;
		try {
			const res = await fetch('/api/emojis', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					shortcode: shortcode.trim().toLowerCase(),
					is_sticker: isSticker,
					scope: 'user',
					mime_type: 'image/png',
					size: 0
				})
			});
			const json = await res.json();
			if (!res.ok) {
				toast.error(json.message ?? 'Failed to create emoji');
				return;
			}
			shortcode = '';
			isSticker = false;
			toast.success('Emoji created');
			loadEmojis();
		} catch {
			toast.error('Failed to create emoji');
		} finally {
			uploading = false;
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
				Manage your personal emojis and stickers. These are available in your comments and
				reactions, and visible to other users who view your content.
			</Card.Description>
		</Card.Header>
		<Card.Content class="space-y-4">
			<div class="flex flex-col gap-3 rounded-lg border p-3 sm:flex-row sm:items-end">
				<div class="flex-1 space-y-1">
					<label for="emoji-shortcode" class="text-sm font-medium">Shortcode</label>
					<Input
						id="emoji-shortcode"
						bind:value={shortcode}
						placeholder="my_emoji"
						class="font-mono text-sm"
					/>
				</div>
				<label class="flex items-center gap-2 text-sm">
					<input type="checkbox" bind:checked={isSticker} class="rounded" />
					Sticker (large)
				</label>
				<Button onclick={createEmoji} disabled={uploading || !shortcode.trim()}>
					{uploading ? 'Creating...' : 'Create Emoji'}
				</Button>
			</div>

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
							<Table.Cell colspan={4} class="py-4 text-center text-muted-foreground"
								>No custom emojis yet</Table.Cell
							>
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
