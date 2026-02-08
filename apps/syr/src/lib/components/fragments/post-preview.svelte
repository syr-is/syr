<script lang="ts">
	import * as Card from '$lib/components/ui/card';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import * as Tooltip from '$lib/components/ui/tooltip';
	import DeletePostDialog from '$lib/components/fragments/delete-post-dialog.svelte';
	import { Trash2, Pin, PinOff, FilePen, ImageIcon } from 'lucide-svelte';
	import type { Post } from '@syr-is/types';
	import { isVideo } from '$lib/utils/media';

	interface Props {
		post: Post;
		isPinned?: boolean;
		onPinToggle?: (postId: string, isPinned: boolean) => void;
		showPinButton?: boolean;
	}

	let { post, isPinned = false, onPinToggle, showPinButton = true }: Props = $props();

	// Check if post is a draft
	const isDraft = $derived(post.status === 'draft');
	let deleteDialogOpen = $state(false);
	let pinLoading = $state(false);

	async function handlePinToggle(e: MouseEvent) {
		e.stopPropagation();
		if (!onPinToggle || pinLoading) return;

		pinLoading = true;
		try {
			const postId = typeof post.id === 'string' ? post.id : post.id.toString();
			await onPinToggle(postId, isPinned);
		} finally {
			pinLoading = false;
		}
	}

	// Format date
	function formatDate(date: Date | string): string {
		const d = typeof date === 'string' ? new Date(date) : date;
		return new Intl.DateTimeFormat('en-US', {
			year: 'numeric',
			month: 'short',
			day: 'numeric'
		}).format(d);
	}

	// Get display text - prefer description, fall back to truncated content or media count
	function getDisplayText(post: Post): string {
		if (post.description) {
			return post.description;
		}
		if (post.type === 'media') {
			const count = post.media_urls?.length ?? 0;
			return count === 0 ? 'No media items' : `${count} media item${count === 1 ? '' : 's'}`;
		}
		if (!post.content) return 'No content';
		// Strip markdown syntax and HTML tags for fallback
		const plainText = post.content
			.replace(/[#*_`~[\]()]/g, '')
			.replace(/<[^>]*>/g, '')
			.replace(/\n/g, ' ')
			.trim();
		return plainText.length > 150 ? plainText.substring(0, 150) + '...' : plainText;
	}

	// Get visibility badge variant
	function getVisibilityVariant(
		visibility: string
	): 'default' | 'secondary' | 'destructive' | 'outline' {
		if (visibility === 'public') return 'default';
		if (visibility === 'unlisted') return 'secondary';
		return 'destructive';
	}
</script>

<Card.Root
	class="transition-all hover:border-primary/50 hover:shadow-md {isDraft
		? 'border-warning/50 border-dashed'
		: ''}"
>
	<Card.Header>
		<div class="flex flex-wrap items-start gap-2">
			<Card.Title class="line-clamp-2 min-w-0 flex-1">
				{post.title || 'Untitled Post'}
			</Card.Title>
			<div class="ml-auto flex flex-wrap gap-1">
				{#if isDraft}
					<Badge variant="outline" class="border-warning text-warning gap-1 text-xs">
						<FilePen class="h-3 w-3" />
						Draft
					</Badge>
				{/if}
				<Badge variant={getVisibilityVariant(post.visibility)} class="text-xs">
					{post.visibility}
				</Badge>
				<Badge variant="outline" class="text-xs">
					{post.type === 'media' ? 'media' : post.content_type}
				</Badge>
			</div>
		</div>
		<Card.Description class="text-xs text-muted-foreground">
			{#if isDraft}
				Last edited {formatDate(post.updated_at)}
			{:else}
				{formatDate(post.created_at)}
			{/if}
		</Card.Description>
	</Card.Header>
	<Card.Content>
		{#if post.type === 'media' && post.media_urls && post.media_urls.length > 0}
			<!-- Media preview: stacked vertical layout -->
			<div class="relative mb-3 overflow-hidden rounded-lg bg-muted">
				{#if isVideo(post.media_urls[0])}
					<video src={post.media_urls[0]} class="h-40 w-full object-cover" preload="metadata">
						<track kind="captions" />
					</video>
				{:else}
					<img
						src={post.media_urls[0]}
						alt="Preview"
						class="h-40 w-full object-cover"
						loading="lazy"
					/>
				{/if}
				{#if post.media_urls.length > 1}
					<div
						class="absolute right-2 bottom-2 rounded-md bg-black/60 px-2 py-0.5 text-xs font-medium text-white"
					>
						+{post.media_urls.length - 1} more
					</div>
				{/if}
			</div>
		{/if}

		<div class="flex items-start justify-between gap-2">
			{#if post.type === 'media' && post.media_urls && post.media_urls.length > 0}
				<p class="flex-1 text-sm text-muted-foreground">
					<ImageIcon class="mr-1 inline h-3.5 w-3.5" />
					{getDisplayText(post)}
				</p>
			{:else}
				<p class="line-clamp-3 flex-1 text-sm text-muted-foreground">{getDisplayText(post)}</p>
			{/if}
			<div class="flex gap-1">
				{#if showPinButton && onPinToggle}
					<Tooltip.Root>
						<Tooltip.Trigger>
							{#snippet child({ props })}
								<Button
									{...props}
									variant="ghost"
									size="icon"
									class="h-8 w-8 {isPinned
										? 'text-primary hover:bg-primary/10'
										: 'text-muted-foreground hover:bg-muted'}"
									onclick={handlePinToggle}
									disabled={pinLoading}
								>
									{#if isPinned}
										<PinOff class="h-4 w-4" />
									{:else}
										<Pin class="h-4 w-4" />
									{/if}
								</Button>
							{/snippet}
						</Tooltip.Trigger>
						<Tooltip.Content>
							{isPinned ? 'Unpin post' : 'Pin post'}
						</Tooltip.Content>
					</Tooltip.Root>
				{/if}
				<Button
					variant="ghost"
					size="icon"
					class="h-8 w-8 text-destructive hover:bg-destructive/10 hover:text-destructive"
					onclick={(e) => {
						e.stopPropagation();
						deleteDialogOpen = true;
					}}
				>
					<Trash2 class="h-4 w-4" />
				</Button>
			</div>
		</div>
	</Card.Content>
</Card.Root>

<DeletePostDialog bind:open={deleteDialogOpen} {post} />
