<script lang="ts">
	import * as Dialog from '@syr-is/ui/dialog';
	import { Button } from '@syr-is/ui/button';
	import { computeSha256Hex } from '@syr-is/utils';
	import { Input } from '@syr-is/ui/input';
	import { toast } from 'svelte-sonner';
	import { Loader2 } from 'lucide-svelte';

	let {
		open = $bindable(false),
		currentFolderId = null,
		onSuccess
	}: {
		open?: boolean;
		currentFolderId?: string | null;
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

				const arrayBuffer = await file.arrayBuffer();
				const sha256 = await computeSha256Hex(arrayBuffer);

				const response = await fetch('/api/admin/media', {
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
					const err = await response.json().catch(() => ({}));
					throw new Error(err.message || `Failed to get upload URL for ${file.name}`);
				}

				const result = await response.json();
				const { signedUrl, uploadDid, uploadLocalId } = result.data;

				uploadProgress = `Uploading ${file.name} to storage...`;
				const uploadResponse = await fetch(signedUrl, {
					method: 'PUT',
					headers: { 'Content-Type': file.type || 'application/octet-stream' },
					body: file
				});

				if (!uploadResponse.ok) {
					throw new Error(`Failed to upload ${file.name}`);
				}

				uploadProgress = `Finalizing ${file.name}...`;
				const completeResponse = await fetch('/api/admin/media', {
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
			onSuccess?.();
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Upload failed');
		} finally {
			uploading = false;
			uploadProgress = '';
			if (input) input.value = '';
		}
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content>
		<Dialog.Header>
			<Dialog.Title>Upload Instance Media</Dialog.Title>
			<Dialog.Description>
				Upload files to the shared instance media storage. These files will be publicly accessible
				and can be designated as emojis, stickers, or GIFs.
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
