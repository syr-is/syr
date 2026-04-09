<script lang="ts">
	import * as Card from '@syr-is/ui/card';
	import * as Table from '@syr-is/ui/table';
	import { Button } from '@syr-is/ui/button';
	import { Input } from '@syr-is/ui/input';
	import { toast } from 'svelte-sonner';
	import { Trash2, Upload } from 'lucide-svelte';
	import { computeSha256Hex } from '@syr-is/utils';

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

	let shortcode = $state('');
	let isSticker = $state(false);
	let uploading = $state(false);
	let uploadStatus = $state('');
	let fileInput: HTMLInputElement | null = $state(null);

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

	async function uploadAndCreateEmoji() {
		if (!shortcode.trim()) {
			toast.error('Enter a shortcode');
			return;
		}
		const file = fileInput?.files?.[0];
		if (!file) {
			toast.error('Select an image file');
			return;
		}

		const allowedTypes = ['image/png', 'image/gif', 'image/webp', 'image/svg+xml'];
		if (!allowedTypes.includes(file.type)) {
			toast.error('Allowed formats: PNG, GIF, WebP, SVG');
			return;
		}

		uploading = true;
		try {
			// Step 1: Upload file via existing upload system
			uploadStatus = 'Computing hash...';
			const arrayBuffer = await file.arrayBuffer();
			const sha256 = await computeSha256Hex(arrayBuffer);

			uploadStatus = 'Getting upload URL...';
			const uploadRes = await fetch('/api/uploads', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					filename: `emoji_${shortcode.trim().toLowerCase()}.${file.name.split('.').pop()}`,
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
			const completeResult = await completeRes.json();
			const fileUrl = completeResult.data?.url ?? completeResult.data?.downloadUrl;

			// Step 2: Create emoji record
			uploadStatus = 'Creating emoji...';
			const emojiRes = await fetch('/api/emojis', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					shortcode: shortcode.trim().toLowerCase(),
					is_sticker: isSticker,
					scope: 'user',
					mime_type: file.type,
					size: file.size
				})
			});
			if (!emojiRes.ok) {
				const err = await emojiRes.json().catch(() => ({}));
				throw new Error(err.message ?? 'Failed to create emoji');
			}

			// Step 3: Update emoji with the upload URL
			const emojiResult = await emojiRes.json();
			if (emojiResult.data?.did && emojiResult.data?.local_id && fileUrl) {
				await fetch(
					`/api/emojis/${encodeURIComponent(emojiResult.data.did)}/${encodeURIComponent(emojiResult.data.local_id)}`,
					{ method: 'GET' }
				);
			}

			shortcode = '';
			isSticker = false;
			if (fileInput) fileInput.value = '';
			toast.success(`Emoji :${emojiResult.data?.shortcode ?? shortcode}: created`);
			loadEmojis();
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Failed to create emoji');
		} finally {
			uploading = false;
			uploadStatus = '';
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
				Upload custom emojis and stickers. These are available in your comments and reactions, and
				visible to other users who view your content. Files are stored in your upload space.
			</Card.Description>
		</Card.Header>
		<Card.Content class="space-y-4">
			<div class="space-y-3 rounded-lg border p-4">
				<div class="grid gap-3 sm:grid-cols-2">
					<div class="space-y-1">
						<label for="emoji-shortcode" class="text-sm font-medium">Shortcode</label>
						<Input
							id="emoji-shortcode"
							bind:value={shortcode}
							placeholder="my_emoji"
							class="font-mono text-sm"
						/>
					</div>
					<div class="space-y-1">
						<label for="emoji-file" class="text-sm font-medium">Image file</label>
						<input
							id="emoji-file"
							type="file"
							accept="image/png,image/gif,image/webp,image/svg+xml"
							bind:this={fileInput}
							class="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs file:border-0 file:bg-transparent file:text-sm file:font-medium"
						/>
					</div>
				</div>
				<div class="flex items-center justify-between">
					<label class="flex items-center gap-2 text-sm">
						<input type="checkbox" bind:checked={isSticker} class="rounded" />
						Sticker (larger display)
					</label>
					<Button onclick={uploadAndCreateEmoji} disabled={uploading || !shortcode.trim()}>
						{#if uploading}
							{uploadStatus || 'Uploading...'}
						{:else}
							<Upload class="mr-1.5 h-3.5 w-3.5" />
							Upload Emoji
						{/if}
					</Button>
				</div>
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
								>No custom emojis yet. Upload one above!</Table.Cell
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
