<script lang="ts">
	import * as Card from '$lib/components/ui/card';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import { marked } from 'marked';
	import { goto } from '$app/navigation';
	import type { PageData } from './$types';
	import { Pencil, ArrowLeft } from 'lucide-svelte';

	let { data }: { data: PageData } = $props();

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
					<Card.Description class="text-muted-foreground text-sm">
						Published on {formatDate(data.post.created_at)}
						{#if data.post.updated_at && data.post.updated_at !== data.post.created_at}
							<span class="ml-2">• Updated on {formatDate(data.post.updated_at)}</span>
						{/if}
					</Card.Description>
				</div>
				{#if data.user}
					{@const isOwner = data.post.author_id === data.user.id}
					{#if isOwner}
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
					{/if}
				{/if}
			</div>
		</Card.Header>
		<Card.Content
			class="prose prose-slate dark:prose-invert min-h-0 max-w-none flex-1 overflow-y-auto"
		>
			{#if data.post.content_type === 'html'}
				{@html data.post.content || ''}
			{:else if data.post.content_type === 'markdown'}
				{@html renderMarkdown(data.post.content)}
			{:else}
				<p class="text-muted-foreground">No content available.</p>
			{/if}
		</Card.Content>
	</Card.Root>
</div>
