<script lang="ts">
	import * as Dialog from '@syr-is/ui/dialog';
	import { Button } from '@syr-is/ui/button';
	import { Input } from '@syr-is/ui/input';
	import { toast } from 'svelte-sonner';
	import { Loader2 } from 'lucide-svelte';

	let {
		open = $bindable(false),
		imageUrl = null,
		mimeType = null,
		fileSize = 0,
		onSuccess
	}: {
		open?: boolean;
		imageUrl?: string | null;
		mimeType?: string | null;
		fileSize?: number;
		onSuccess?: () => void;
	} = $props();

	let tags = $state('');
	let saving = $state(false);

	$effect(() => {
		if (!open) tags = '';
	});

	async function handleSave() {
		saving = true;
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
					mime_type: mimeType ?? 'image/gif',
					size: fileSize,
					tags: tagList
				})
			});
			if (!res.ok) {
				const err = await res.json().catch(() => ({}));
				throw new Error(err.message ?? 'Failed to add as GIF');
			}
			toast.success('Added to GIF library');
			open = false;
			onSuccess?.();
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Failed to save');
		} finally {
			saving = false;
		}
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="max-w-sm">
		<Dialog.Header>
			<Dialog.Title>Add as GIF</Dialog.Title>
			<Dialog.Description>
				Add this image to your GIF library. You can tag it for easier search.
			</Dialog.Description>
		</Dialog.Header>
		<div class="space-y-3 py-2">
			{#if imageUrl}
				<div class="flex justify-center">
					<img src={imageUrl} alt="Preview" class="h-20 rounded object-contain" />
				</div>
			{/if}
			<div class="space-y-1">
				<label for="gif-tags-input" class="text-sm font-medium">Tags (comma-separated)</label>
				<Input id="gif-tags-input" bind:value={tags} placeholder="funny, reaction, thumbsup" />
			</div>
		</div>
		<Dialog.Footer>
			<Button variant="outline" onclick={() => (open = false)} disabled={saving}>Cancel</Button>
			<Button onclick={handleSave} disabled={saving}>
				{#if saving}
					<Loader2 class="mr-2 h-4 w-4 animate-spin" />
					Saving...
				{:else}
					Add GIF
				{/if}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
