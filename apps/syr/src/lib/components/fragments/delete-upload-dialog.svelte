<script lang="ts">
	import * as Dialog from '$lib/components/ui/dialog';
	import { Button } from '$lib/components/ui/button';
	import type { Upload } from '@syr-is/types';
	import { toast } from 'svelte-sonner';
	import { Loader2, TriangleAlert, Trash2 } from 'lucide-svelte';

	let {
		upload = null,
		open = $bindable(false),
		onSuccess
	}: {
		upload?: Upload | null;
		open?: boolean;
		onSuccess?: () => void;
	} = $props();

	let deleting = $state(false);

	async function handleDelete() {
		if (!upload) return;

		deleting = true;
		try {
			const uploadId = typeof upload.id === 'string' ? upload.id : upload.id.toString();
			const response = await fetch(`/api/uploads/${uploadId}`, {
				method: 'DELETE'
			});

			if (!response.ok) {
				const errorData = await response.json();
				throw new Error(errorData.error?.message || 'Failed to delete file');
			}

			toast.success('File deleted successfully');
			open = false;
			onSuccess?.();
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Failed to delete file');
		} finally {
			deleting = false;
		}
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="max-w-sm">
		<Dialog.Header>
			<Dialog.Title class="flex items-center gap-2 text-destructive">
				<Trash2 class="h-5 w-5" />
				Delete File
			</Dialog.Title>
			<Dialog.Description>
				Are you sure you want to delete "{upload?.filename}"?
			</Dialog.Description>
		</Dialog.Header>
		<div class="py-4">
			<div class="flex items-start gap-2 rounded-md bg-destructive/10 p-3 text-sm text-destructive">
				<TriangleAlert class="mt-0.5 h-4 w-4 shrink-0" />
				<span>This action cannot be undone. The file will be permanently deleted.</span>
			</div>
		</div>
		<Dialog.Footer>
			<Button variant="outline" onclick={() => (open = false)} disabled={deleting}>Cancel</Button>
			<Button variant="destructive" onclick={handleDelete} disabled={deleting}>
				{#if deleting}
					<Loader2 class="mr-2 h-4 w-4 animate-spin" />
					Deleting...
				{:else}
					Delete File
				{/if}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
