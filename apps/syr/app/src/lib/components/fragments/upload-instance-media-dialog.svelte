<script lang="ts">
	import * as Dialog from '@syr-is/ui/dialog';
	import { Button } from '@syr-is/ui/button';
	import { Progress } from '@syr-is/ui/progress';
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
	let uploadLabel = $state('');
	let uploadPercent = $state(0);
	let fileInputRef = $state<HTMLInputElement | null>(null);

	function hexToBase64(hex: string): string {
		return btoa(
			hex
				.match(/.{2}/g)!
				.map((b: string) => String.fromCharCode(parseInt(b, 16)))
				.join('')
		);
	}

	function putWithProgress(url: string, file: File, checksumBase64: string): Promise<void> {
		return new Promise((resolve, reject) => {
			const xhr = new XMLHttpRequest();
			xhr.open('PUT', url, true);
			xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
			xhr.setRequestHeader('x-amz-checksum-sha256', checksumBase64);
			xhr.upload.onprogress = (e) => {
				if (e.lengthComputable) uploadPercent = Math.round((e.loaded / e.total) * 100);
			};
			xhr.onload = () => {
				if (xhr.status >= 200 && xhr.status < 300) resolve();
				else reject(new Error(`Upload failed: ${xhr.status}`));
			};
			xhr.onerror = () => reject(new Error('Upload network error'));
			xhr.send(file);
		});
	}

	async function handleFileSelect(event: Event) {
		const input = event.target as HTMLInputElement;
		const files = input.files;
		if (!files || files.length === 0) return;

		uploading = true;

		try {
			for (let i = 0; i < files.length; i++) {
				const file = files[i];
				uploadLabel = `Hashing ${file.name} (${i + 1}/${files.length})...`;
				uploadPercent = 0;

				const arrayBuffer = await file.arrayBuffer();
				const sha256 = await computeSha256Hex(arrayBuffer);

				uploadLabel = `Requesting upload URL...`;
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

				uploadLabel = `Uploading ${file.name} (${i + 1}/${files.length})...`;
				uploadPercent = 0;
				await putWithProgress(signedUrl, file, hexToBase64(sha256));

				uploadLabel = `Finalizing ${file.name}...`;
				uploadPercent = 100;
				const completeBody = JSON.stringify({ did: uploadDid, local_id: uploadLocalId, status: 'completed' });
				let completeResponse = await fetch('/api/admin/media', {
					method: 'PATCH',
					headers: { 'Content-Type': 'application/json' },
					body: completeBody
				});

				if (completeResponse.status === 202) {
					uploadLabel = `Finalizing ${file.name} (waiting for storage sync)...`;
					const maxPollMs = 5 * 60 * 1000;
					const started = Date.now();
					let delay = 3000;

					while (Date.now() - started < maxPollMs) {
						await new Promise((r) => setTimeout(r, delay));
						delay = Math.min(delay * 1.3, 10000);

						completeResponse = await fetch('/api/admin/media', {
							method: 'PATCH',
							headers: { 'Content-Type': 'application/json' },
							body: completeBody
						});

						if (completeResponse.status === 200) break;
						if (completeResponse.status !== 202) {
							throw new Error(`Failed to complete upload for ${file.name}`);
						}
					}

					if (completeResponse.status === 202) {
						throw new Error(`Upload finalization timed out for ${file.name}`);
					}
				}

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
			uploadLabel = '';
			uploadPercent = 0;
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
					<p class="text-sm text-muted-foreground">{uploadLabel}</p>
					<div class="w-full max-w-xs">
						<Progress value={uploadPercent} max={100} />
					</div>
					<p class="text-xs text-muted-foreground">{uploadPercent}%</p>
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
