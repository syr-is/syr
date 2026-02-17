<script lang="ts">
	import * as Dialog from '@syr-is/ui/dialog';
	import { Button } from '@syr-is/ui/button';
	import { toast } from 'svelte-sonner';
	import { Loader2, TriangleAlert, Trash2 } from 'lucide-svelte';
	import { storageEvents } from '$lib/stores/storage-events.svelte';

	let {
		open = $bindable(false),
		folderId = null,
		folderName = null,
		onSuccess
	}: {
		open?: boolean;
		folderId?: string | null;
		folderName?: string | null;
		onSuccess?: () => void;
	} = $props();

	let deleteWithContents = $state(false);
	let deleting = $state(false);

	async function handleDelete() {
		if (!folderId) return;

		deleting = true;
		try {
			const queryString = deleteWithContents ? '?delete_contents=true' : '';
			const response = await fetch(`/api/folders/${folderId}${queryString}`, {
				method: 'DELETE'
			});

			if (!response.ok) {
				const errorData = await response.json();
				throw new Error(errorData.error?.message || 'Failed to delete folder');
			}

			toast.success('Folder deleted successfully');
			open = false;
			storageEvents.refresh();
			onSuccess?.();
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Failed to delete folder');
		} finally {
			deleting = false;
		}
	}

	// Reset state when dialog opens
	$effect(() => {
		if (open) {
			deleteWithContents = false;
		}
	});
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="max-w-sm">
		<Dialog.Header>
			<Dialog.Title class="flex items-center gap-2 text-destructive">
				<Trash2 class="h-5 w-5" />
				Delete Folder
			</Dialog.Title>
			<Dialog.Description>
				Are you sure you want to delete "{folderName}"?
			</Dialog.Description>
		</Dialog.Header>
		<div class="py-4">
			<div class="flex items-start gap-2 rounded-md bg-destructive/10 p-3 text-sm text-destructive">
				<TriangleAlert class="mt-0.5 h-4 w-4 shrink-0" />
				<span>This action cannot be undone. The folder will be permanently deleted.</span>
			</div>

			<label class="mt-4 flex items-start gap-3 rounded-md border p-3">
				<input
					type="checkbox"
					bind:checked={deleteWithContents}
					class="mt-0.5 h-4 w-4 rounded border-gray-300"
					disabled={deleting}
				/>
				<div class="flex flex-col gap-1">
					<span class="text-sm font-medium">Delete all contents</span>
					<span class="text-xs text-muted-foreground">
						Delete all subfolders and files inside this folder. Required if the folder is not empty.
					</span>
				</div>
			</label>
		</div>
		<Dialog.Footer>
			<Button variant="outline" onclick={() => (open = false)} disabled={deleting}>Cancel</Button>
			<Button variant="destructive" onclick={handleDelete} disabled={deleting}>
				{#if deleting}
					<Loader2 class="mr-2 h-4 w-4 animate-spin" />
					Deleting...
				{:else}
					Delete Folder
				{/if}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
