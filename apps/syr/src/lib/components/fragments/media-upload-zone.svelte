<script lang="ts">
	import MediaThumbnail from '$lib/components/fragments/media-thumbnail.svelte';
	import { Label } from '$lib/components/ui/label';
	import { ImageIcon, Upload, Trash2 } from 'lucide-svelte';

	interface Props {
		mediaUrls: string[];
		mediaMimeTypes: Record<string, string>;
		uploading?: boolean;
		onUpload: (files: FileList | File[]) => void | Promise<void>;
		onRemove: (index: number) => void;
		inputId?: string;
	}

	let {
		mediaUrls,
		mediaMimeTypes,
		uploading = false,
		onUpload,
		onRemove,
		inputId = 'media-file-input'
	}: Props = $props();

	let dragOver = $state(false);

	function handleDrop(e: DragEvent) {
		e.preventDefault();
		dragOver = false;
		if (e.dataTransfer?.files) {
			onUpload(e.dataTransfer.files);
		}
	}

	function handleDragOver(e: DragEvent) {
		e.preventDefault();
		dragOver = true;
	}

	function handleDragLeave() {
		dragOver = false;
	}

	function handleFileInput(e: Event) {
		const input = e.target as HTMLInputElement;
		if (input.files) {
			onUpload(input.files);
			input.value = '';
		}
	}
</script>

<div>
	<Label>Media</Label>
	<div
		class="mt-2 flex min-h-[200px] cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed p-6 transition-colors {dragOver
			? 'border-primary bg-primary/5'
			: 'border-muted-foreground/25 hover:border-primary/50'}"
		ondrop={handleDrop}
		ondragover={handleDragOver}
		ondragleave={handleDragLeave}
		role="button"
		tabindex="0"
		onclick={() => document.getElementById(inputId)?.click()}
		onkeydown={(e) => {
			if (e.key === 'Enter' || e.key === ' ') {
				e.preventDefault();
				document.getElementById(inputId)?.click();
			}
		}}
	>
		{#if uploading}
			<div class="flex flex-col items-center gap-2 text-muted-foreground">
				<Upload class="h-8 w-8 animate-pulse" />
				<p class="text-sm">Uploading...</p>
			</div>
		{:else}
			<div class="flex flex-col items-center gap-2 text-muted-foreground">
				<ImageIcon class="h-8 w-8" />
				<p class="text-sm font-medium">Drop files here or click to browse</p>
				<p class="text-xs">Supports all file types</p>
			</div>
		{/if}
	</div>
	<input id={inputId} type="file" accept="*/*" multiple class="hidden" onchange={handleFileInput} />
</div>

{#if mediaUrls.length > 0}
	<div>
		<Label>Uploaded Media ({mediaUrls.length})</Label>
		<div class="mt-2 grid grid-cols-3 gap-3 sm:grid-cols-4">
			{#each mediaUrls as url, i (`${url}-${i}`)}
				<div
					class="group relative aspect-square w-full overflow-hidden rounded-lg border bg-muted/30"
				>
					<MediaThumbnail {url} mimeType={mediaMimeTypes[url]} mode="card" alt="Upload {i + 1}" />
					<button
						type="button"
						class="text-destructive-foreground absolute top-1 right-1 rounded-full bg-destructive/90 p-1 opacity-0 transition-opacity group-hover:opacity-100"
						onclick={(e) => {
							e.stopPropagation();
							onRemove(i);
						}}
					>
						<Trash2 class="h-3 w-3" />
					</button>
				</div>
			{/each}
		</div>
	</div>
{/if}
