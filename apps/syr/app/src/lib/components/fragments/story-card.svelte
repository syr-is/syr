<script lang="ts">
	import { Button } from '@syr-is/ui/button';
	import { Badge } from '@syr-is/ui/badge';
	import {
		Eye,
		EyeOff,
		Trash2,
		Loader2,
		VideoIcon,
		ImageIcon,
		Clock,
		Lock,
		Unlock
	} from 'lucide-svelte';
	import type { UploadWithCompositeId } from '@syr-is/types';

	let {
		story,
		displayUrl,
		age = '',
		expiry = null,
		badgeText,
		badgeClass = '',
		badgeVariant = 'default' as 'default' | 'secondary' | 'outline' | 'destructive',
		cardClass = '',
		imageClass = '',
		showPublish = false,
		showUnpublish = false,
		showPrivacyToggle = false,
		publishing = false,
		privacyToggling = false,
		onPublish,
		onUnpublish,
		onTogglePrivacy,
		onDelete
	}: {
		story: UploadWithCompositeId;
		displayUrl: string;
		age?: string;
		expiry?: string | null;
		badgeText: string;
		badgeClass?: string;
		badgeVariant?: 'default' | 'secondary' | 'outline' | 'destructive';
		cardClass?: string;
		imageClass?: string;
		showPublish?: boolean;
		showUnpublish?: boolean;
		showPrivacyToggle?: boolean;
		publishing?: boolean;
		privacyToggling?: boolean;
		onPublish?: () => void;
		onUnpublish?: () => void;
		onTogglePrivacy?: () => void;
		onDelete?: () => void;
	} = $props();
</script>

<article class="overflow-hidden rounded-lg border bg-card {cardClass}">
	<div class="relative aspect-[3/4] bg-muted">
		{#if story.mime_type?.startsWith('image/') && story.url}
			<img src={displayUrl} alt={story.filename} class="h-full w-full object-cover {imageClass}" />
		{:else if story.mime_type?.startsWith('video/') && story.url}
			<video
				src={displayUrl}
				class="h-full w-full object-cover {imageClass}"
				muted
				playsinline
				preload="metadata"
			></video>
			<VideoIcon class="absolute top-2 right-2 h-4 w-4 text-white drop-shadow" />
		{:else}
			<div class="flex h-full w-full items-center justify-center text-muted-foreground">
				<ImageIcon class="h-6 w-6" />
			</div>
		{/if}
		<Badge class="absolute top-2 left-2 {badgeClass}" variant={badgeVariant}>
			{badgeText}
		</Badge>
		{#if expiry}
			<div
				class="absolute bottom-2 left-2 flex items-center gap-1 rounded bg-black/60 px-1.5 py-0.5 text-[11px] text-white"
			>
				<Clock class="h-3 w-3" />
				{expiry}
			</div>
		{/if}
	</div>
	<div class="space-y-1 p-1.5">
		<p class="line-clamp-1 text-xs font-medium">{story.filename}</p>
		{#if age}
			<p class="text-[11px] text-muted-foreground">{age}</p>
		{/if}
		<div class="flex gap-1">
			{#if showPublish && onPublish}
				<Button
					size="icon-sm"
					title="Publish"
					aria-label="Publish story"
					onclick={onPublish}
					disabled={publishing}
				>
					{#if publishing}
						<Loader2 class="h-3.5 w-3.5 animate-spin" />
					{:else}
						<Eye class="h-3.5 w-3.5" />
					{/if}
				</Button>
			{/if}
			{#if showUnpublish && onUnpublish}
				<Button
					size="icon-sm"
					variant="outline"
					title="Unpublish"
					aria-label="Unpublish story"
					onclick={onUnpublish}
					disabled={publishing}
				>
					{#if publishing}
						<Loader2 class="h-3.5 w-3.5 animate-spin" />
					{:else}
						<EyeOff class="h-3.5 w-3.5" />
					{/if}
				</Button>
			{/if}
			{#if showPrivacyToggle && onTogglePrivacy}
				<Button
					size="icon-sm"
					variant="outline"
					title={story.is_public ? 'Make private' : 'Make public'}
					aria-label={story.is_public ? 'Make file private' : 'Make file public'}
					onclick={onTogglePrivacy}
					disabled={privacyToggling}
				>
					{#if privacyToggling}
						<Loader2 class="h-3.5 w-3.5 animate-spin" />
					{:else if story.is_public}
						<Lock class="h-3.5 w-3.5" />
					{:else}
						<Unlock class="h-3.5 w-3.5" />
					{/if}
				</Button>
			{/if}
			{#if onDelete}
				<Button
					size="icon-sm"
					variant="destructive"
					title="Delete"
					aria-label={`Delete story ${story.filename}`}
					onclick={onDelete}
				>
					<Trash2 class="h-3.5 w-3.5" />
				</Button>
			{/if}
		</div>
	</div>
</article>
