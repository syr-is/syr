<script lang="ts">
	import * as Dialog from '$lib/components/ui/dialog';
	import { Button } from '$lib/components/ui/button';
	import type { Upload, Folder } from '@syr-is/types';
	import { toast } from 'svelte-sonner';

	let {
		upload = null,
		folder = null,
		open = $bindable(false),
		onSuccess
	}: {
		upload?: Upload | null;
		folder?: Folder | null;
		open?: boolean;
		onSuccess?: () => void;
	} = $props();

	let deleting = $state(false);

	async function handleDeleteUpload() {
		if (!upload) return;

		deleting = true;
		try {
			const uploadId = typeof upload.id === 'string' ? upload.id : upload.id.toString();
			const response = await fetch(`/api/uploads/${uploadId}`, {
				method: 'DELETE'
			});

			if (!response.ok) {
				const errorData = await response.json();
				throw new Error(errorData.error?.message || 'Failed to delete upload');
			}

			toast.success('Upload deleted successfully');
			open = false;
			onSuccess?.();
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Failed to delete upload');
		} finally {
			deleting = false;
		}
	}

	async function handleDeleteFolder() {
		if (!folder) return;

		deleting = true;
		try {
			const folderId = typeof folder.id === 'string' ? folder.id : folder.id.toString();
			const response = await fetch(`/api/folders/${folderId}?delete_contents=true`, {
				method: 'DELETE'
			});

			if (!response.ok) {
				const errorData = await response.json();
				throw new Error(errorData.error?.message || 'Failed to delete folder');
			}

			toast.success('Folder deleted successfully');
			open = false;
			onSuccess?.();
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Failed to delete folder');
		} finally {
			deleting = false;
		}
	}

	function handleOpenChange(newOpen: boolean) {
		open = newOpen;
	}
</script>

<Dialog.Root bind:open onOpenChange={handleOpenChange}>
	<Dialog.Content>
		<Dialog.Header>
			<Dialog.Title>
				{#if upload}
					Delete Upload
				{:else}
					Delete Folder
				{/if}
			</Dialog.Title>
			<Dialog.Description>
				{#if upload}
					Are you sure you want to delete "{upload.filename}"? This action cannot be undone.
				{:else if folder}
					Are you sure you want to delete the folder "{folder.name}" and all its contents? This
					action cannot be undone.
				{/if}
			</Dialog.Description>
		</Dialog.Header>
		<Dialog.Footer>
			<Button variant="outline" onclick={() => (open = false)}>Cancel</Button>
			<Button
				variant="destructive"
				onclick={upload ? handleDeleteUpload : handleDeleteFolder}
				disabled={deleting}
			>
				{deleting ? 'Deleting...' : 'Delete'}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
