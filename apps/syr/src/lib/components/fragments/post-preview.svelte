<script lang="ts">
	import * as Card from '$lib/components/ui/card';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import * as Tooltip from '$lib/components/ui/tooltip';
	import DeletePostDialog from '$lib/components/fragments/delete-post-dialog.svelte';
	import { Trash2, Pin, PinOff } from 'lucide-svelte';
	import type { Post } from '@syr-is/types';

	interface Props {
		post: Post;
		isPinned?: boolean;
		onPinToggle?: (postId: string, isPinned: boolean) => void;
		showPinButton?: boolean;
	}

	let { post, isPinned = false, onPinToggle, showPinButton = true }: Props = $props();
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

	// Get display text - prefer description, fall back to truncated content
	function getDisplayText(post: Post): string {
		if (post.description) {
			return post.description;
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

<Card.Root class="transition-all hover:border-primary/50 hover:shadow-md">
	<Card.Header>
		<div class="flex items-start justify-between gap-2">
			<Card.Title class="line-clamp-2 flex-1">
				{post.title || 'Untitled Post'}
			</Card.Title>
			<div class="flex flex-shrink-0 gap-2">
				<Badge variant={getVisibilityVariant(post.visibility)} class="text-xs">
					{post.visibility}
				</Badge>
				<Badge variant="outline" class="text-xs">
					{post.content_type}
				</Badge>
			</div>
		</div>
		<Card.Description class="text-xs text-muted-foreground">
			{formatDate(post.created_at)}
		</Card.Description>
	</Card.Header>
	<Card.Content>
		<div class="flex items-start justify-between gap-2">
			<p class="line-clamp-3 flex-1 text-sm text-muted-foreground">{getDisplayText(post)}</p>
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
