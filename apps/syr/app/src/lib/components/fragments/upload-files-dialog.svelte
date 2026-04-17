<script lang="ts">
	import * as Dialog from '@syr-is/ui/dialog';
	import { Button } from '@syr-is/ui/button';
	import { computeSha256Hex } from '@syr-is/utils';
	import { Input } from '@syr-is/ui/input';
	import { toast } from 'svelte-sonner';
	import { Loader2 } from 'lucide-svelte';
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

	let uploading = $state(false);
	let uploadProgress = $state<string>('');
	let fileInputRef = $state<HTMLInputElement | null>(null);

	async function handleFileSelect(event: Event) {
		const input = event.target as HTMLInputElement;
		const files = input.files;
		if (!files || files.length === 0) return;

		uploading = true;
		uploadProgress = 'Preparing upload...';

		try {
			for (let i = 0; i < files.length; i++) {
				const file = files[i];
				uploadProgress = `Uploading ${file.name} (${i + 1}/${files.length})...`;

				// Calculate SHA256 hash
				const arrayBuffer = await file.arrayBuffer();
				const sha256 = await computeSha256Hex(arrayBuffer);

				// Get signed URL
				const response = await fetch('/api/uploads', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						filename: file.name,
						mime_type: file.type || 'application/octet-stream',
						size: file.size,
						sha256,
						folder_id: currentFolderId
					})
				});

				if (!response.ok) {
					throw new Error(`Failed to get upload URL for ${file.name}`);
				}

				const result = await response.json();
				const { signedUrl, uploadDid, uploadLocalId } = result.data;

				// Upload to S3
				uploadProgress = `Uploading ${file.name} to storage...`;
				const checksumBase64 = btoa(
					sha256
						.match(/.{2}/g)!
						.map((b: string) => String.fromCharCode(parseInt(b, 16)))
						.join('')
				);
				const uploadResponse = await fetch(signedUrl, {
					method: 'PUT',
					headers: {
						'Content-Type': file.type || 'application/octet-stream',
						'x-amz-checksum-sha256': checksumBase64
					},
					body: file
				});

				if (!uploadResponse.ok) {
					throw new Error(`Failed to upload ${file.name}`);
				}

				// Complete upload
				uploadProgress = `Finalizing ${file.name}...`;
				const completeResponse = await fetch('/api/uploads', {
					method: 'PATCH',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ did: uploadDid, local_id: uploadLocalId, status: 'completed' })
				});

				if (!completeResponse.ok) {
					throw new Error(`Failed to complete upload for ${file.name}`);
				}
			}

			toast.success(`Successfully uploaded ${files.length} file${files.length > 1 ? 's' : ''}`);
			open = false;
			storageEvents.refresh();
			onSuccess?.();
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Upload failed');
		} finally {
			uploading = false;
			uploadProgress = '';
			if (input) input.value = '';
		}
	}

	function handleOpenChange(newOpen: boolean) {
		open = newOpen;
	}
</script>

<Dialog.Root bind:open onOpenChange={handleOpenChange}>
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
			{#if uploading}
				<div class="flex flex-col items-center justify-center gap-4 py-8">
					<Loader2 class="h-8 w-8 animate-spin text-primary" />
					<p class="text-sm text-muted-foreground">{uploadProgress}</p>
				</div>
			{:else}
				<div class="flex flex-col gap-4">
					<Input
						bind:ref={fileInputRef}
						type="file"
						multiple
						onchange={handleFileSelect}
						class="cursor-pointer"
					/>
					<p class="text-xs text-muted-foreground">
						You can select multiple files to upload at once.
					</p>
				</div>
			{/if}
		</div>
		<Dialog.Footer>
			<Button variant="outline" onclick={() => (open = false)} disabled={uploading}>Cancel</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
