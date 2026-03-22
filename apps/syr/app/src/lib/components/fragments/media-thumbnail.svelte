<script lang="ts">
	import { Play, Music, FileDown, ImageIcon } from 'lucide-svelte';
	import { Skeleton } from '@syr-is/ui/skeleton';
	import { getMediaType, fetchAlbumArt, trackAlbumArt } from '$lib/utils/media';
	import { type DisplayItem, resolveItemUrl } from '$lib/types/display-item';

	let {
		url,
		mimeType,
		item,
		mode = 'card',
		alt = '',
		class: className = '',
		onImageClick,
		blockSubresourceLoad = false
	}: {
		url: string;
		mimeType?: string;
		/** When provided and kind === 'file', resolves a signed URL lazily */
		item?: DisplayItem;
		mode?: 'card' | 'full';
		alt?: string;
		class?: string;
		onImageClick?: () => void;
		/** When true, do not load remote media (feed); same-origin still loads after mount. */
		blockSubresourceLoad?: boolean;
	} = $props();

	// --- Lazy URL resolution for private 'file' items ---
	let resolvedUrl = $state<string | null>(null);
	let urlLoading = $state(false);
	let urlRequestId = 0;

	$effect(() => {
		resolvedUrl = null;
		urlLoading = false;
		if (blockSubresourceLoad) return;
		if (!item || item.kind !== 'file') return;

		urlLoading = true;
		const requestId = ++urlRequestId;
		resolveItemUrl(item)
			.then((result) => {
				if (requestId !== urlRequestId) return;
				resolvedUrl = result?.url ?? null;
			})
			.catch(() => {
				if (requestId !== urlRequestId) return;
				resolvedUrl = null;
			})
			.finally(() => {
				if (requestId !== urlRequestId) return;
				urlLoading = false;
			});
	});

	// The effective URL: resolved for 'file' items, raw url prop otherwise
	const effectiveUrl = $derived(item?.kind === 'file' ? (resolvedUrl ?? '') : url);

	const mediaType = $derived(getMediaType(effectiveUrl || url, mimeType));
	let albumArtUrl = $state<string | null>(null);
	let albumArtRequestId = 0;

	$effect(() => {
		albumArtUrl = null;
		const artSourceUrl = effectiveUrl;
		if (blockSubresourceLoad || mediaType !== 'audio' || !artSourceUrl) return;

		const requestId = ++albumArtRequestId;
		fetchAlbumArt(artSourceUrl)
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

{#if blockSubresourceLoad}
	{#if mode === 'card'}
		<div
			class="flex h-full w-full flex-col items-center justify-center gap-2 bg-muted text-muted-foreground"
		>
			<ImageIcon class="h-10 w-10 opacity-60" />
			<span class="px-2 text-center text-[10px]">Open post to load</span>
		</div>
	{:else}
		<div
			class="flex h-48 w-full flex-col items-center justify-center gap-2 rounded-md bg-muted text-muted-foreground {className}"
		>
			<ImageIcon class="h-12 w-12 opacity-60" />
			<span class="text-xs">Open post to load external media</span>
		</div>
	{/if}
{:else if urlLoading}
	<!-- Skeleton placeholder while resolving a signed URL -->
	{#if mode === 'card'}
		<Skeleton class="h-full w-full" />
	{:else}
		<Skeleton class="h-48 w-full rounded-md {className}" />
	{/if}
{:else if mode === 'card'}
	<!-- Card: square thumbnail, no controls, play overlay on video, album art or icon for audio -->
	{#if mediaType === 'image'}
		<img
			src={effectiveUrl}
			{alt}
			class="h-full w-full object-cover"
			loading="lazy"
			onerror={(e) => {
				const el = e.currentTarget as HTMLImageElement;
				if (el) el.style.display = 'none';
			}}
		/>
	{:else if mediaType === 'video'}
		<video src={effectiveUrl} class="h-full w-full object-cover" preload="metadata" muted>
			<track kind="captions" />
		</video>
		<div class="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/20">
			<div class="rounded-full bg-black/60 p-2">
				<Play class="h-6 w-6 text-white" />
			</div>
		</div>
	{:else if mediaType === 'audio'}
		<div class="h-full w-full" use:trackAlbumArt={effectiveUrl}>
			{#if albumArtUrl}
				<img
					src={albumArtUrl}
					alt="Album art"
					class="h-full w-full object-cover"
					onerror={(e) => {
						const el = e.currentTarget as HTMLImageElement;
						if (el) el.style.display = 'none';
					}}
				/>
			{:else}
				<div class="flex h-full w-full flex-col items-center justify-center gap-2 bg-muted">
					<Music class="h-10 w-10 text-muted-foreground" />
				</div>
			{/if}
		</div>
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
					src={effectiveUrl}
					{alt}
					class="max-h-[500px] w-full rounded-md object-contain {className}"
					loading="lazy"
					onerror={(e) => {
						const el = e.currentTarget as HTMLImageElement;
						if (el) el.style.display = 'none';
					}}
				/>
			</button>
		{:else}
			<img
				src={effectiveUrl}
				{alt}
				class="max-h-[500px] w-full rounded-md object-contain {className}"
				loading="lazy"
				onerror={(e) => {
					const el = e.currentTarget as HTMLImageElement;
					if (el) el.style.display = 'none';
				}}
			/>
		{/if}
	{:else if mediaType === 'video'}
		<video
			src={effectiveUrl}
			controls
			class="max-h-[500px] w-full rounded-md object-contain {className}"
			preload="metadata"
		>
			<track kind="captions" />
		</video>
	{:else if mediaType === 'audio'}
		<div class="flex flex-col items-center gap-4 py-4 {className}" use:trackAlbumArt={effectiveUrl}>
			{#if albumArtUrl}
				<img
					src={albumArtUrl}
					alt="Album art"
					class="h-48 w-48 rounded-lg object-cover shadow-md"
					onerror={(e) => {
						const el = e.currentTarget as HTMLImageElement;
						if (el) el.style.display = 'none';
					}}
				/>
			{:else}
				<div class="flex h-48 w-48 items-center justify-center rounded-lg bg-muted">
					<Music class="h-16 w-16 text-muted-foreground" />
				</div>
			{/if}
			<audio src={effectiveUrl} controls class="w-full max-w-md" preload="metadata">
				<track kind="captions" />
			</audio>
		</div>
	{:else}
		<a
			href={effectiveUrl}
			download={alt || undefined}
			class="flex flex-col items-center gap-2 rounded-md bg-muted/50 p-8 text-muted-foreground transition-colors hover:bg-muted {className}"
		>
			<FileDown class="h-10 w-10" />
			<span class="text-sm font-medium">{alt || 'File'}</span>
			<span class="text-xs">Click to download</span>
		</a>
	{/if}
{/if}
