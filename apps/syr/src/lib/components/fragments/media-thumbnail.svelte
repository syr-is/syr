<script lang="ts">
	import { Play, Music, FileDown } from 'lucide-svelte';
	import { getMediaType, fetchAlbumArt } from '$lib/utils/media';

	let {
		url,
		mimeType,
		mode = 'card',
		alt = '',
		class: className = '',
		onImageClick
	}: {
		url: string;
		mimeType?: string;
		mode?: 'card' | 'full';
		alt?: string;
		class?: string;
		onImageClick?: () => void;
	} = $props();

	const mediaType = $derived(getMediaType(url, mimeType));
	let albumArtUrl = $state<string | null>(null);
	let albumArtRequestId = 0;

	$effect(() => {
		albumArtUrl = null;
		if (mediaType !== 'audio' || !url) return;

		const requestId = ++albumArtRequestId;
		fetchAlbumArt(url)
			.then((artUrl) => {
				if (requestId === albumArtRequestId) {
					albumArtUrl = artUrl;
				}
			})
			.catch(() => {
				if (requestId === albumArtRequestId) {
					albumArtUrl = null;
				}
			});
	});
</script>

{#if mode === 'card'}
	<!-- Card: square thumbnail, no controls, play overlay on video, album art or icon for audio -->
	{#if mediaType === 'image'}
		<img src={url} {alt} class="h-full w-full object-cover" loading="lazy" />
	{:else if mediaType === 'video'}
		<video src={url} class="h-full w-full object-cover" preload="metadata" muted>
			<track kind="captions" />
		</video>
		<div class="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/20">
			<div class="rounded-full bg-black/60 p-2">
				<Play class="h-6 w-6 text-white" />
			</div>
		</div>
	{:else if mediaType === 'audio'}
		{#if albumArtUrl}
			<img src={albumArtUrl} alt="Album art" class="h-full w-full object-cover" />
		{:else}
			<div class="flex h-full w-full flex-col items-center justify-center gap-2 bg-muted">
				<Music class="h-10 w-10 text-muted-foreground" />
			</div>
		{/if}
	{:else}
		<div class="flex h-full w-full flex-col items-center justify-center gap-2 bg-muted">
			<FileDown class="h-10 w-10 text-muted-foreground" />
		</div>
	{/if}
{:else}
	<!-- Full: with controls, album art for audio, optional image click -->
	{#if mediaType === 'image'}
		{#if onImageClick}
			<button type="button" class="w-full cursor-pointer" onclick={onImageClick}>
				<img
					src={url}
					{alt}
					class="max-h-[500px] w-full rounded-md object-contain {className}"
					loading="lazy"
				/>
			</button>
		{:else}
			<img
				src={url}
				{alt}
				class="max-h-[500px] w-full rounded-md object-contain {className}"
				loading="lazy"
			/>
		{/if}
	{:else if mediaType === 'video'}
		<video
			src={url}
			controls
			class="max-h-[500px] w-full rounded-md object-contain {className}"
			preload="metadata"
		>
			<track kind="captions" />
		</video>
	{:else if mediaType === 'audio'}
		<div class="flex flex-col items-center gap-4 py-4 {className}">
			{#if albumArtUrl}
				<img
					src={albumArtUrl}
					alt="Album art"
					class="h-48 w-48 rounded-lg object-cover shadow-md"
				/>
			{:else}
				<div class="flex h-48 w-48 items-center justify-center rounded-lg bg-muted">
					<Music class="h-16 w-16 text-muted-foreground" />
				</div>
			{/if}
			<audio src={url} controls class="w-full max-w-md" preload="metadata">
				<track kind="captions" />
			</audio>
		</div>
	{:else}
		<a
			href={url}
			download={alt || undefined}
			class="flex flex-col items-center gap-2 rounded-md bg-muted/50 p-8 text-muted-foreground transition-colors hover:bg-muted {className}"
		>
			<FileDown class="h-10 w-10" />
			<span class="text-sm font-medium">{alt || 'File'}</span>
			<span class="text-xs">Click to download</span>
		</a>
	{/if}
{/if}
