<script lang="ts">
	import * as Card from '@syr-is/ui/card';
	import * as Table from '@syr-is/ui/table';
	import { Button } from '@syr-is/ui/button';
	import { Input } from '@syr-is/ui/input';
	import { toast } from 'svelte-sonner';
	import { Trash2, Upload } from 'lucide-svelte';
	import { computeSha256Hex } from '@syr-is/utils';

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
	let uploadStatus = $state('');
	let fileInput: HTMLInputElement | null = $state(null);

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

	async function uploadAndCreateGif() {
		const file = fileInput?.files?.[0];
		if (!file) {
			toast.error('Select a GIF file');
			return;
		}

		if (!['image/gif', 'image/webp'].includes(file.type)) {
			toast.error('Allowed formats: GIF, animated WebP');
			return;
		}

		uploading = true;
		try {
			uploadStatus = 'Computing hash...';
			const arrayBuffer = await file.arrayBuffer();
			const sha256 = await computeSha256Hex(arrayBuffer);

			uploadStatus = 'Getting upload URL...';
			const uploadRes = await fetch('/api/uploads', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					filename: file.name,
					mime_type: file.type,
					size: file.size,
					sha256
				})
			});
			if (!uploadRes.ok) throw new Error('Failed to get upload URL');
			const uploadResult = await uploadRes.json();
			const { signedUrl, uploadDid, uploadLocalId } = uploadResult.data;

			uploadStatus = 'Uploading to storage...';
			const putRes = await fetch(signedUrl, {
				method: 'PUT',
				headers: { 'Content-Type': file.type },
				body: file
			});
			if (!putRes.ok) throw new Error('Failed to upload file');

			uploadStatus = 'Finalizing upload...';
			const completeRes = await fetch('/api/uploads', {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ did: uploadDid, local_id: uploadLocalId, status: 'completed' })
			});
			if (!completeRes.ok) throw new Error('Failed to finalize upload');

			uploadStatus = 'Creating GIF entry...';
			const tagList = tags
				.split(',')
				.map((t) => t.trim().toLowerCase())
				.filter(Boolean);
			const gifRes = await fetch('/api/gifs', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					scope: 'user',
					mime_type: file.type,
					size: file.size,
					tags: tagList
				})
			});
			if (!gifRes.ok) {
				const err = await gifRes.json().catch(() => ({}));
				throw new Error(err.message ?? 'Failed to create GIF');
			}

			tags = '';
			if (fileInput) fileInput.value = '';
			toast.success('GIF uploaded');
			loadGifs();
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Failed to upload GIF');
		} finally {
			uploading = false;
			uploadStatus = '';
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
				Upload GIFs for use in comments, reactions, and posts. Files are stored in your upload
				space.
			</Card.Description>
		</Card.Header>
		<Card.Content class="space-y-4">
			<div class="space-y-3 rounded-lg border p-4">
				<div class="grid gap-3 sm:grid-cols-2">
					<div class="space-y-1">
						<label for="gif-file" class="text-sm font-medium">GIF file</label>
						<input
							id="gif-file"
							type="file"
							accept="image/gif,image/webp"
							bind:this={fileInput}
							class="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs file:border-0 file:bg-transparent file:text-sm file:font-medium"
						/>
					</div>
					<div class="space-y-1">
						<label for="gif-tags" class="text-sm font-medium">Tags (comma-separated)</label>
						<Input
							id="gif-tags"
							bind:value={tags}
							placeholder="funny, reaction, thumbsup"
							class="text-sm"
						/>
					</div>
				</div>
				<div class="flex justify-end">
					<Button onclick={uploadAndCreateGif} disabled={uploading}>
						{#if uploading}
							{uploadStatus || 'Uploading...'}
						{:else}
							<Upload class="mr-1.5 h-3.5 w-3.5" />
							Upload GIF
						{/if}
					</Button>
				</div>
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
								>No GIFs yet. Upload one above!</Table.Cell
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
