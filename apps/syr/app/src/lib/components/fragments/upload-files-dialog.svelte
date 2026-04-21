<script lang="ts">
	import * as Dialog from '@syr-is/ui/dialog';
	import { Button } from '@syr-is/ui/button';
	import { Input } from '@syr-is/ui/input';
	import { enqueueUploads } from '$lib/stores/upload-queue.svelte';
	import { storageEvents } from '$lib/stores/storage-events.svelte';

	let {
		currentFolderId = null,
		isInPublicFolder = false,
		open = $bindable(false),
		onSuccess
	}: {
		currentFolderId?: string | null;
		isInPublicFolder?: boolean;
		open?: boolean;
		onSuccess?: () => void;
	} = $props();

	function handleFileSelect(event: Event) {
		const input = event.target as HTMLInputElement;
		const files = input.files;
		if (!files || files.length === 0) return;

		open = false;

		enqueueUploads(files, {
			endpoint: '/api/uploads',
			folderId: currentFolderId,
			onFileCompleted: () => {
				storageEvents.refresh();
				onSuccess?.();
			}
		});

		input.value = '';
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content>
		<Dialog.Header>
			<Dialog.Title>Upload Files</Dialog.Title>
			<Dialog.Description>
				Select files to upload to
				{#if currentFolderId}
					the current folder.
				{:else}
					your root directory.
				{/if}
				{#if isInPublicFolder}
					<br /><span class="font-medium text-primary"
						>Files in public folders are accessible without authentication.</span
					>
				{/if}
			</Dialog.Description>
		</Dialog.Header>
		<div class="py-4">
			<div class="flex flex-col gap-4">
				<Input
					type="file"
					multiple
					onchange={handleFileSelect}
					class="cursor-pointer"
				/>
				<p class="text-xs text-muted-foreground">
					You can select multiple files. Uploads continue in the background.
				</p>
			</div>
		</div>
		<Dialog.Footer>
			<Button variant="outline" onclick={() => (open = false)}>Cancel</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
