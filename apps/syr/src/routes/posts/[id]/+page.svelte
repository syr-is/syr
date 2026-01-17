<script lang="ts">
	import * as Card from '$lib/components/ui/card';
	import * as Tooltip from '$lib/components/ui/tooltip';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import { marked } from 'marked';
	import { goto } from '$app/navigation';
	import { toast } from 'svelte-sonner';
	import type { PageData } from './$types';
	import { Pencil, ArrowLeft, Pin, PinOff } from 'lucide-svelte';

	let { data }: { data: PageData } = $props();
	let isPinned = $state(false);
	let pinLoading = $state(false);

	// Check if post is pinned on mount
	$effect(() => {
		if (data.user) {
			checkPinStatus();
		}
	});

	async function checkPinStatus() {
		try {
			const response = await fetch('/api/posts/pinned');
			if (response.ok) {
				const result = await response.json();
				const pinnedIds: string[] = result.data?.post_ids || [];
				isPinned = pinnedIds.includes(data.post.id);
			}
		} catch {
			// Ignore errors
		}
	}

	async function handlePinToggle() {
		if (pinLoading) return;

		pinLoading = true;
		try {
			const response = await fetch('/api/posts/pinned', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					post_id: data.post.id,
					action: isPinned ? 'unpin' : 'pin'
				})
			});

			if (!response.ok) {
				const errorData = await response.json();
				throw new Error(errorData.error?.message || 'Failed to toggle pin');
			}

			isPinned = !isPinned;
			toast.success(isPinned ? 'Post pinned' : 'Post unpinned');
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Failed to toggle pin');
		} finally {
			pinLoading = false;
		}
	}

	// Format date (handles both Date objects and ISO strings)
	function formatDate(date: Date | string): string {
		const d = typeof date === 'string' ? new Date(date) : date;
		if (isNaN(d.getTime())) return 'Invalid date';
		return new Intl.DateTimeFormat('en-US', {
			year: 'numeric',
			month: 'long',
			day: 'numeric',
			hour: 'numeric',
			minute: '2-digit'
		}).format(d);
	}

	// Get visibility badge variant
	function getVisibilityVariant(
		visibility: string
	): 'default' | 'secondary' | 'destructive' | 'outline' {
		if (visibility === 'public') return 'default';
		if (visibility === 'unlisted') return 'secondary';
		return 'destructive';
	}

	// Render markdown to HTML (synchronous)
	function renderMarkdown(markdown: string | undefined): string {
		if (!markdown) return '';
		// Use marked.parse() synchronously with options
		const result = marked.parse(markdown, {
			gfm: true, // GitHub Flavored Markdown
			breaks: true // Convert line breaks to <br>
		});
		// Type guard: if result is a string, return it; otherwise return empty string
		return typeof result === 'string' ? result : '';
	}

	// Get post ID as string for navigation (already serialized as string)
	function getPostIdString(): string {
		return data.post.id;
	}
</script>

<div class="container mx-auto flex h-full max-w-4xl flex-col px-4 py-8">
	<Button
		variant="ghost"
		size="sm"
		class="mb-4 shrink-0 self-start"
		onclick={() => {
			// eslint-disable-next-line svelte/no-navigation-without-resolve
			goto('/');
		}}
	>
		<ArrowLeft class="mr-2 h-4 w-4" />
		Back to Home
	</Button>
	<Card.Root class="flex min-h-0 flex-1 flex-col">
		<Card.Header class="shrink-0">
			<div class="flex items-start justify-between gap-4">
				<div class="flex-1 space-y-2">
					<div class="flex items-center gap-2">
						<Card.Title class="text-3xl">
							{data.post.title || 'Untitled Post'}
						</Card.Title>
						<div class="flex gap-2">
							<Badge variant={getVisibilityVariant(data.post.visibility)} class="text-xs">
								{data.post.visibility}
							</Badge>
							<Badge variant="outline" class="text-xs">
								{data.post.content_type}
							</Badge>
						</div>
					</div>
					<Card.Description class="text-sm text-muted-foreground">
						Published on {formatDate(data.post.created_at)}
						{#if data.post.updated_at && data.post.updated_at !== data.post.created_at}
							<span class="ml-2">• Updated on {formatDate(data.post.updated_at)}</span>
						{/if}
					</Card.Description>
				</div>
				{#if data.user}
					{@const isOwner = data.post.author_id === data.user.id}
					{#if isOwner}
						<div class="flex gap-2">
							<Tooltip.Root>
								<Tooltip.Trigger>
									{#snippet child({ props })}
										<Button
											{...props}
											variant="outline"
											size="sm"
											onclick={handlePinToggle}
											disabled={pinLoading}
											class={isPinned ? 'text-primary' : ''}
										>
											{#if isPinned}
												<PinOff class="mr-2 h-4 w-4" />
												Unpin
											{:else}
												<Pin class="mr-2 h-4 w-4" />
												Pin
											{/if}
										</Button>
									{/snippet}
								</Tooltip.Trigger>
								<Tooltip.Content>
									{isPinned ? 'Remove from pinned posts' : 'Add to pinned posts'}
								</Tooltip.Content>
							</Tooltip.Root>
							<Button
								variant="outline"
								size="sm"
								onclick={() => {
									// eslint-disable-next-line svelte/no-navigation-without-resolve
									goto(`/posts/${getPostIdString()}/edit`);
								}}
							>
								<Pencil class="mr-2 h-4 w-4" />
								Edit
							</Button>
						</div>
					{/if}
				{/if}
			</div>
		</Card.Header>
		<Card.Content
			class="prose prose-slate dark:prose-invert min-h-0 max-w-none flex-1 overflow-y-auto"
		>
			<!-- eslint-disable svelte/no-at-html-tags -->
			<!-- This is a self hosted blog, so we can trust the content -->
			{#if data.post.content_type === 'html'}
				{@html data.post.content || ''}
			{:else if data.post.content_type === 'markdown'}
				{@html renderMarkdown(data.post.content)}
			{:else}
				<p class="text-muted-foreground">No content available.</p>
			{/if}
			<!-- eslint-enable svelte/no-at-html-tags -->
		</Card.Content>
	</Card.Root>
</div>
