<script lang="ts">
	import * as Dialog from '$lib/components/ui/dialog';
	import { Button } from '$lib/components/ui/button';
	import { Skeleton } from '$lib/components/ui/skeleton';
	import type { Upload } from '@syr-is/types';
	import { toast } from 'svelte-sonner';
	import { Download, Link, FileAudio } from 'lucide-svelte';

	let {
		upload = null,
		open = $bindable(false),
		onOpenShareDialog
	}: {
		upload?: Upload | null;
		open?: boolean;
		onOpenShareDialog?: (upload: Upload) => void;
	} = $props();

	let previewUrl = $state<string | null>(null);
	let previewIsPublic = $state(false);
	let loading = $state(false);

	// Format file size
	function formatFileSize(bytes: number): string {
		if (bytes === 0) return '0 Bytes';
		const k = 1024;
		const sizes = ['Bytes', 'KB', 'MB', 'GB'];
		const i = Math.floor(Math.log(bytes) / Math.log(k));
		return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
	}

	// Get preview type for rendering the appropriate element
	function getPreviewType(mimeType: string): 'image' | 'video' | 'audio' | 'pdf' | null {
		if (mimeType.startsWith('image/')) return 'image';
		if (mimeType.startsWith('video/')) return 'video';
		if (mimeType.startsWith('audio/')) return 'audio';
		if (mimeType === 'application/pdf') return 'pdf';
		return null;
	}

	// Download file
	async function downloadFile() {
		if (!upload) return;

		try {
			const uploadId = typeof upload.id === 'string' ? upload.id : upload.id.toString();
			const response = await fetch(`/api/uploads/${uploadId}`);
			if (!response.ok) {
				throw new Error('Failed to get download URL');
			}

			const result = await response.json();
			const downloadUrl = result.data?.downloadUrl;

			if (downloadUrl) {
				window.open(downloadUrl, '_blank');
			} else {
				toast.error('Download URL not available');
			}
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Failed to download file');
		}
	}

	// Copy preview link directly
	async function copyPreviewLink() {
		if (!previewUrl) {
			toast.error('URL not available');
			return;
		}

		if (previewIsPublic) {
			try {
				await navigator.clipboard.writeText(previewUrl);
				toast.success('Link copied to clipboard');
			} catch {
				toast.error('Failed to copy link');
			}
			return;
		}

		// For private files, open share dialog for custom expiry
		if (upload) {
			onOpenShareDialog?.(upload);
		}
	}

	// Fetch preview URL when dialog opens
	async function fetchPreviewUrl() {
		if (!upload) return;

		loading = true;
		previewUrl = null;
		previewIsPublic = upload.is_public;

		try {
			const uploadId = typeof upload.id === 'string' ? upload.id : upload.id.toString();
			const response = await fetch(`/api/uploads/${uploadId}`);
			if (response.ok) {
				const result = await response.json();
				previewUrl = result.data?.downloadUrl || null;
				previewIsPublic = result.data?.isPublic ?? upload.is_public;
			}
		} catch {
			// Silently fail, preview just won't work
		} finally {
			loading = false;
		}
	}

	function handleOpenChange(newOpen: boolean) {
		open = newOpen;
		if (newOpen && upload) {
			fetchPreviewUrl();
		}
	}

	// Fetch when upload changes while open
	$effect(() => {
		if (open && upload) {
			fetchPreviewUrl();
		}
	});
</script>

<Dialog.Root bind:open onOpenChange={handleOpenChange}>
	<Dialog.Content class="max-w-3xl">
		<Dialog.Header>
			<Dialog.Title class="max-w-[500px] truncate">{upload?.filename}</Dialog.Title>
			<Dialog.Description>
				{upload?.mime_type} • {upload ? formatFileSize(upload.size) : ''}
			</Dialog.Description>
		</Dialog.Header>
		<div class="flex items-center justify-center overflow-hidden py-4">
			{#if loading}
				<Skeleton class="h-64 w-full" />
			{:else if previewUrl && upload}
				{@const previewType = getPreviewType(upload.mime_type)}
				{#if previewType === 'image'}
					<img
						src={previewUrl}
						alt={upload.filename}
						class="max-h-[60vh] w-auto max-w-full rounded-lg object-contain"
					/>
				{:else if previewType === 'video'}
					<video
						src={previewUrl}
						controls
						class="max-h-[60vh] w-auto max-w-full rounded-lg"
						preload="metadata"
					>
						<track kind="captions" />
						Your browser does not support video playback.
					</video>
				{:else if previewType === 'audio'}
					<div class="flex w-full flex-col items-center gap-4 py-8">
						<FileAudio class="h-16 w-16 text-muted-foreground" />
						<audio src={previewUrl} controls class="w-full max-w-md" preload="metadata">
							Your browser does not support audio playback.
						</audio>
					</div>
				{:else if previewType === 'pdf'}
					<iframe
						src={previewUrl}
						title={upload.filename}
						class="h-[60vh] w-full rounded-lg border"
					>
						Your browser does not support PDF preview.
					</iframe>
				{:else}
					<p class="text-muted-foreground">Preview not available for this file type</p>
				{/if}
			{:else}
				<p class="text-muted-foreground">Preview not available</p>
			{/if}
		</div>
		{#if upload?.url}
			<Dialog.Footer>
				<Button variant="outline" onclick={copyPreviewLink}>
					<Link class="mr-2 h-4 w-4" />
					{previewIsPublic ? 'Copy Link' : 'Share...'}
				</Button>
				<Button onclick={downloadFile}>
					<Download class="mr-2 h-4 w-4" />
					Download
				</Button>
			</Dialog.Footer>
		{/if}
	</Dialog.Content>
</Dialog.Root>
