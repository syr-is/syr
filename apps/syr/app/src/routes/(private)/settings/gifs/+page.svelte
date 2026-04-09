<script lang="ts">
	import * as Card from '@syr-is/ui/card';
	import * as Table from '@syr-is/ui/table';
	import { Button } from '@syr-is/ui/button';
	import { Input } from '@syr-is/ui/input';
	import { toast } from 'svelte-sonner';
	import { Trash2 } from 'lucide-svelte';

	type GifRow = {
		id: string;
		did: string;
		local_id: string;
		url: string;
		thumbnail_url: string | null;
		tags: string[];
		size: number;
	};

	let gifs = $state<GifRow[]>([]);
	let loading = $state(true);
	let tags = $state('');
	let uploading = $state(false);

	async function loadGifs() {
		loading = true;
		try {
			const res = await fetch('/api/gifs?limit=100');
			if (res.ok) {
				const json = await res.json();
				if (json.status === 'success') gifs = json.data ?? [];
			}
		} finally {
			loading = false;
		}
	}

	async function createGif() {
		uploading = true;
		try {
			const tagList = tags
				.split(',')
				.map((t) => t.trim().toLowerCase())
				.filter(Boolean);
			const res = await fetch('/api/gifs', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					scope: 'user',
					mime_type: 'image/gif',
					size: 0,
					tags: tagList
				})
			});
			const json = await res.json();
			if (!res.ok) {
				toast.error(json.message ?? 'Failed to create GIF entry');
				return;
			}
			tags = '';
			toast.success('GIF entry created');
			loadGifs();
		} catch {
			toast.error('Failed to create GIF entry');
		} finally {
			uploading = false;
		}
	}

	async function deleteGif(did: string, localId: string) {
		try {
			const res = await fetch(
				`/api/gifs/${encodeURIComponent(did)}/${encodeURIComponent(localId)}`,
				{ method: 'DELETE' }
			);
			if (!res.ok) {
				toast.error('Failed to delete');
				return;
			}
			toast.success('GIF deleted');
			loadGifs();
		} catch {
			toast.error('Failed to delete');
		}
	}

	$effect(() => {
		loadGifs();
	});
</script>

<svelte:head>
	<title>GIFs | Settings | SYR</title>
</svelte:head>

<div class="mx-auto max-w-2xl space-y-6">
	<Card.Root>
		<Card.Header>
			<Card.Title>My GIF Library</Card.Title>
			<Card.Description>
				Manage your personal GIF collection. GIFs can be used in comments, reactions, and posts.
			</Card.Description>
		</Card.Header>
		<Card.Content class="space-y-4">
			<div class="flex flex-col gap-3 rounded-lg border p-3 sm:flex-row sm:items-end">
				<div class="flex-1 space-y-1">
					<label for="gif-tags" class="text-sm font-medium">Tags (comma-separated)</label>
					<Input
						id="gif-tags"
						bind:value={tags}
						placeholder="funny, reaction, thumbsup"
						class="text-sm"
					/>
				</div>
				<Button onclick={createGif} disabled={uploading}>
					{uploading ? 'Creating...' : 'Create GIF Entry'}
				</Button>
			</div>

			<Table.Root>
				<Table.Header>
					<Table.Row>
						<Table.Head>Preview</Table.Head>
						<Table.Head>Tags</Table.Head>
						<Table.Head>Size</Table.Head>
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
					{:else if gifs.length === 0}
						<Table.Row>
							<Table.Cell colspan={4} class="py-4 text-center text-muted-foreground"
								>No GIFs yet</Table.Cell
							>
						</Table.Row>
					{:else}
						{#each gifs as gif (gif.id)}
							<Table.Row>
								<Table.Cell>
									{#if gif.url || gif.thumbnail_url}
										<img
											src={gif.thumbnail_url ?? gif.url}
											alt="GIF"
											class="h-12 w-12 rounded object-cover"
										/>
									{:else}
										<span class="text-xs text-muted-foreground">No preview</span>
									{/if}
								</Table.Cell>
								<Table.Cell class="text-xs">{gif.tags.join(', ') || '—'}</Table.Cell>
								<Table.Cell class="text-xs"
									>{gif.size > 0 ? `${(gif.size / 1024).toFixed(1)} KB` : '—'}</Table.Cell
								>
								<Table.Cell class="text-right">
									<Button
										variant="destructive"
										size="sm"
										onclick={() => deleteGif(gif.did, gif.local_id)}
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
