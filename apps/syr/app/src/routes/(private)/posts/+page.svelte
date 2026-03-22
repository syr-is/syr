<script lang="ts">
	import * as Card from '@syr-is/ui/card';
	import * as Select from '@syr-is/ui/select';
	import * as Pagination from '@syr-is/ui/pagination';
	import { Skeleton } from '@syr-is/ui/skeleton';
	import { Badge } from '@syr-is/ui/badge';
	import NewPost from '$lib/components/fragments/new-post.svelte';
	import PostPreview from '$lib/components/fragments/post-preview.svelte';
	import OversizedPostPlaceholder from '$lib/components/fragments/oversized-post-placeholder.svelte';
	import {
		buildOrderedFeedEntries,
		fetchJsonWithByteLimit,
		type FeedEntry
	} from '$lib/client/fetch-with-content-limit.js';
	import { MAX_JSON_RESPONSE_BYTES } from '$lib/client/content-limit-config.js';
	import {
		hasPostSizeOverride,
		postSizeOverrideKeyForPost,
		setPostSizeOverride
	} from '$lib/client/post-size-override.js';
	import { getPostId, type Post } from '@syr-is/types';
	import { goto } from '$app/navigation';
	import { toast } from 'svelte-sonner';
	import { Pin } from 'lucide-svelte';
	import DraggableItem from '$lib/components/fragments/draggable-item.svelte';

	let { data } = $props();

	// Posts state
	let feedEntries = $state<FeedEntry[]>([]);
	let loading = $state(false);
	let error = $state<string | null>(null);

	// Pinned posts state
	let pinnedFeedEntries = $state<FeedEntry[]>([]);
	let pinnedPostIds = $state<string[]>([]);
	let _pinnedLoading = $state(false);

	// Mime type and filename maps for media URLs (shared across all posts)
	let mediaUrlMimeTypes = $state<Record<string, string>>({});
	let mediaUrlFilenames = $state<Record<string, string>>({});

	// Drag and drop state
	let draggedIndex = $state<number | null>(null);
	let dragOverIndex = $state<number | null>(null);

	// Pagination state
	let currentPage = $state(1);
	let limit = $state(20);
	let total = $state(0);

	// Sorting state
	let sortField = $state<'created_at' | 'updated_at' | 'title'>('created_at');
	let sortOrder = $state<'asc' | 'desc'>('desc');

	// Fetch posts function
	async function fetchPosts() {
		if (!data.user) return;

		loading = true;
		error = null;
		try {
			const offset = (currentPage - 1) * limit;
			const params = new URLSearchParams({
				limit: limit.toString(),
				offset: offset.toString(),
				sort_field: sortField,
				sort_order: sortOrder
			});

			const r = await fetchJsonWithByteLimit(`/api/posts?${params.toString()}`, {
				maxRawBytes: MAX_JSON_RESPONSE_BYTES
			});
			if (!r.ok) {
				if (r.error === 'too_large') {
					throw new Error(
						'The posts response is too large to load safely. Try a smaller page size or raise your limit in Settings → Content trust.'
					);
				}
				throw new Error(r.message);
			}
			const result = r.json as {
				data?: unknown[];
				pagination?: { total?: number };
				mediaUrlMimeTypes?: Record<string, string>;
				mediaUrlFilenames?: Record<string, string>;
			};
			const raw = result.data || [];
			let entries = buildOrderedFeedEntries(raw, data.maxPostPayloadBytes, (rec) =>
				hasPostSizeOverride(postSizeOverrideKeyForPost(rec as Post))
			);
			if (data.feedHideUnsignedPosts) {
				entries = entries.filter((e) => {
					const p = e.post as Post;
					return !!(p.content_signature && String(p.content_signature).trim());
				});
			}
			feedEntries = entries;
			total = result.pagination?.total || 0;
			const newMimeTypes: Record<string, string> = result.mediaUrlMimeTypes || {};
			const newFilenames: Record<string, string> = result.mediaUrlFilenames || {};
			mediaUrlMimeTypes = { ...mediaUrlMimeTypes, ...newMimeTypes };
			mediaUrlFilenames = { ...mediaUrlFilenames, ...newFilenames };
		} catch (err) {
			error = err instanceof Error ? err.message : 'An unexpected error occurred';
			feedEntries = [];
		} finally {
			loading = false;
		}
	}

	// Fetch pinned posts function
	async function fetchPinnedPosts() {
		if (!data.user) return;

		_pinnedLoading = true;
		try {
			const r = await fetchJsonWithByteLimit('/api/posts/pinned', {
				maxRawBytes: MAX_JSON_RESPONSE_BYTES
			});
			if (!r.ok) {
				if (r.error === 'too_large') {
					throw new Error('Pinned posts response is too large to load safely.');
				}
				throw new Error(r.message);
			}
			const result = r.json as {
				data?: {
					posts?: unknown[];
					post_ids?: string[];
					mediaUrlMimeTypes?: Record<string, string>;
					mediaUrlFilenames?: Record<string, string>;
				};
			};
			const raw = result.data?.posts || [];
			let pinnedEntries = buildOrderedFeedEntries(raw, data.maxPostPayloadBytes, (rec) =>
				hasPostSizeOverride(postSizeOverrideKeyForPost(rec as Post))
			);
			if (data.feedHideUnsignedPosts) {
				pinnedEntries = pinnedEntries.filter((e) => {
					const p = e.post as Post;
					return !!(p.content_signature && String(p.content_signature).trim());
				});
			}
			pinnedFeedEntries = pinnedEntries;
			pinnedPostIds = result.data?.post_ids || [];
			const newMimeTypes: Record<string, string> = result.data?.mediaUrlMimeTypes || {};
			const newFilenames: Record<string, string> = result.data?.mediaUrlFilenames || {};
			mediaUrlMimeTypes = { ...mediaUrlMimeTypes, ...newMimeTypes };
			mediaUrlFilenames = { ...mediaUrlFilenames, ...newFilenames };
		} catch (err) {
			console.error('Failed to fetch pinned posts:', err);
			pinnedFeedEntries = [];
			pinnedPostIds = [];
		} finally {
			_pinnedLoading = false;
		}
	}

	// Check if a post is pinned
	function isPostPinned(postId: string): boolean {
		return pinnedPostIds.includes(postId);
	}

	// Handle pin/unpin toggle
	async function handlePinToggle(postId: string, currentlyPinned: boolean) {
		try {
			const response = await fetch('/api/posts/pinned', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					post_id: postId,
					action: currentlyPinned ? 'unpin' : 'pin'
				})
			});

			if (!response.ok) {
				const errorData = await response.json();
				throw new Error(errorData.error?.message || 'Failed to toggle pin');
			}

			const result = await response.json();
			pinnedPostIds = result.data?.post_ids || [];

			// Refresh pinned posts to get full data
			await fetchPinnedPosts();

			toast.success(currentlyPinned ? 'Post unpinned' : 'Post pinned');
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Failed to toggle pin');
		}
	}

	// Drag and drop handlers
	function handleDragStart(index: number) {
		draggedIndex = index;
	}

	function handleDragOver(e: DragEvent, index: number) {
		e.preventDefault();
		dragOverIndex = index;
	}

	function handleDragLeave() {
		dragOverIndex = null;
	}

	async function handleDrop(e: DragEvent, targetIndex: number) {
		e.preventDefault();
		if (draggedIndex === null || draggedIndex === targetIndex) {
			draggedIndex = null;
			dragOverIndex = null;
			return;
		}

		const newEntries = [...pinnedFeedEntries];
		const [removedEntry] = newEntries.splice(draggedIndex, 1);
		newEntries.splice(targetIndex, 0, removedEntry);
		pinnedFeedEntries = newEntries;
		const reorderedIds = newEntries.map((e) => getPostId(e.post));
		pinnedPostIds = reorderedIds;

		draggedIndex = null;
		dragOverIndex = null;

		// Send to server
		try {
			const response = await fetch('/api/posts/pinned', {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ post_ids: reorderedIds })
			});

			if (!response.ok) {
				const errorData = await response.json();
				throw new Error(errorData.error?.message || 'Failed to reorder');
			}

			toast.success('Pinned posts reordered');
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Failed to reorder');
			// Refresh to get correct order from server
			await fetchPinnedPosts();
		}
	}

	function handleDragEnd() {
		draggedIndex = null;
		dragOverIndex = null;
	}

	// Track previous sort values to detect changes
	let prevSortField = $state<string | undefined>(undefined);
	let prevSortOrder = $state<string | undefined>(undefined);

	// Initialize previous values inside effect to avoid capturing initial values
	$effect(() => {
		if (prevSortField === undefined) {
			prevSortField = sortField;
		}
		if (prevSortOrder === undefined) {
			prevSortOrder = sortOrder;
		}
	});

	// Watch for changes and refetch
	$effect(() => {
		if (!data.user) return;

		// Track current values for reactivity
		const currentSortField = sortField;
		const currentSortOrder = sortOrder;
		const currentPageValue = currentPage;

		// Reset to first page when sorting changes (but not on initial load)
		if (prevSortField !== undefined && prevSortOrder !== undefined) {
			if (prevSortField !== currentSortField || prevSortOrder !== currentSortOrder) {
				currentPage = 1;
			}
		}

		// Update previous values
		prevSortField = currentSortField;
		prevSortOrder = currentSortOrder;

		// Use tracked values to ensure reactivity
		void currentPageValue;
		void currentSortField;
		void currentSortOrder;

		fetchPosts();
	});

	// Fetch pinned posts on mount
	$effect(() => {
		if (!data.user) return;
		fetchPinnedPosts();
	});

	// Handle post click - navigate to viewing page
	function handlePostClick(post: Post) {
		const postId = getPostId(post);
		// eslint-disable-next-line svelte/no-navigation-without-resolve
		goto(`/posts/${postId}`);
	}

	function handleOversizeOverride(post: Post) {
		setPostSizeOverride(postSizeOverrideKeyForPost(post));
		void fetchPosts();
		void fetchPinnedPosts();
	}

	// Calculate total pages
	const totalPages = $derived(Math.ceil(total / limit));

	// Helper functions for sort field labels
	function getSortFieldLabel(field: string): string {
		if (field === 'created_at') return 'Created';
		if (field === 'updated_at') return 'Updated';
		if (field === 'title') return 'Title';
		return field;
	}

	function getSortOrderLabel(order: string): string {
		return order === 'asc' ? 'Ascending' : 'Descending';
	}
</script>

<svelte:head>
	<title>Posts | SYR</title>
</svelte:head>

{#if data.user}
	<div class="space-y-6 p-4 sm:p-6 lg:p-8">
		<!-- Page Header -->
		<div class="space-y-1">
			<h1 class="text-3xl font-bold tracking-tight">Posts</h1>
			<p class="text-muted-foreground">Manage and organize all your posts</p>
		</div>

		<!-- Controls Row -->
		<div class="flex flex-wrap items-center justify-between gap-2">
			<div class="flex flex-wrap items-center gap-2">
				<Select.Root type="single" bind:value={sortField}>
					<Select.Trigger class="w-[140px]">
						{getSortFieldLabel(sortField)}
					</Select.Trigger>
					<Select.Content>
						<Select.Item value="created_at">Created</Select.Item>
						<Select.Item value="updated_at">Updated</Select.Item>
						<Select.Item value="title">Title</Select.Item>
					</Select.Content>
				</Select.Root>

				<Select.Root type="single" bind:value={sortOrder}>
					<Select.Trigger class="w-[140px]">
						{getSortOrderLabel(sortOrder)}
					</Select.Trigger>
					<Select.Content>
						<Select.Item value="desc">Descending</Select.Item>
						<Select.Item value="asc">Ascending</Select.Item>
					</Select.Content>
				</Select.Root>

				{#if totalPages > 1}
					<Pagination.Root bind:page={currentPage} count={total} perPage={limit} siblingCount={1}>
						{#snippet children({ pages, currentPage: activePage })}
							<Pagination.Content>
								<Pagination.Item>
									<Pagination.PrevButton />
								</Pagination.Item>
								{#each pages as page (page.key)}
									{#if page.type === 'ellipsis'}
										<Pagination.Item>
											<Pagination.Ellipsis />
										</Pagination.Item>
									{:else}
										<Pagination.Item>
											<Pagination.Link {page} isActive={activePage === page.value}>
												{page.value}
											</Pagination.Link>
										</Pagination.Item>
									{/if}
								{/each}
								<Pagination.Item>
									<Pagination.NextButton />
								</Pagination.Item>
							</Pagination.Content>
						{/snippet}
					</Pagination.Root>
				{/if}
			</div>
			<NewPost onDraftCreated={fetchPosts} onDraftDeleted={fetchPosts} />
		</div>

		<!-- Pinned Posts Section -->
		{#if pinnedFeedEntries.length > 0}
			<div class="space-y-3">
				<div class="flex items-center gap-2">
					<Pin class="h-4 w-4 text-primary" />
					<h2 class="text-lg font-semibold">Pinned Posts</h2>
					<Badge variant="secondary" class="text-xs">{pinnedFeedEntries.length}/10</Badge>
				</div>
				<div class="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
					{#each pinnedFeedEntries as entry, index (getPostId(entry.post))}
						<DraggableItem
							{index}
							{draggedIndex}
							{dragOverIndex}
							onDragStart={handleDragStart}
							onDragOver={handleDragOver}
							onDragLeave={handleDragLeave}
							onDrop={handleDrop}
							onDragEnd={handleDragEnd}
						>
							<div class="w-full">
								{#if entry.kind === 'post'}
									<button
										type="button"
										class="w-full text-left"
										onclick={() => handlePostClick(entry.post)}
										onkeydown={(e) => {
											if (e.key === 'Enter' || e.key === ' ') {
												e.preventDefault();
												handlePostClick(entry.post);
											}
										}}
									>
										<PostPreview
											post={entry.post}
											isPinned={true}
											onPinToggle={handlePinToggle}
											showPinButton={true}
											{mediaUrlMimeTypes}
											{mediaUrlFilenames}
										/>
									</button>
								{:else}
									<OversizedPostPlaceholder
										post={entry.post}
										estimatedBytes={entry.estimatedBytes}
										limitBytes={data.maxPostPayloadBytes}
										onLoadAnyway={() => handleOversizeOverride(entry.post)}
									/>
								{/if}
							</div>
						</DraggableItem>
					{/each}
				</div>
			</div>
		{/if}

		<!-- Posts List -->
		{#if loading}
			<div class="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
				{#each Array(8) as _, i (i)}
					<Card.Root>
						<Card.Header>
							<Skeleton class="h-6 w-3/4" />
							<Skeleton class="mt-2 h-4 w-1/2" />
						</Card.Header>
						<Card.Content>
							<Skeleton class="h-4 w-full" />
							<Skeleton class="mt-2 h-4 w-5/6" />
						</Card.Content>
					</Card.Root>
				{/each}
			</div>
		{:else if error}
			<Card.Root>
				<Card.Content class="py-6">
					<p class="text-center text-destructive">{error}</p>
				</Card.Content>
			</Card.Root>
		{:else if feedEntries.length === 0}
			<Card.Root>
				<Card.Content class="py-12">
					<div class="space-y-2 text-center">
						<h3 class="text-lg font-semibold">No posts yet</h3>
						<p class="text-sm text-muted-foreground">Get started by creating your first post!</p>
					</div>
				</Card.Content>
			</Card.Root>
		{:else}
			<div class="space-y-3">
				<h2 class="text-lg font-semibold">All Posts</h2>
				<div class="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
					{#each feedEntries as entry (getPostId(entry.post))}
						<div class="w-full">
							{#if entry.kind === 'post'}
								<button
									type="button"
									class="w-full text-left"
									onclick={() => handlePostClick(entry.post)}
									onkeydown={(e) => {
										if (e.key === 'Enter' || e.key === ' ') {
											e.preventDefault();
											handlePostClick(entry.post);
										}
									}}
								>
									<PostPreview
										post={entry.post}
										isPinned={isPostPinned(getPostId(entry.post))}
										onPinToggle={handlePinToggle}
										showPinButton={true}
										{mediaUrlMimeTypes}
										{mediaUrlFilenames}
									/>
								</button>
							{:else}
								<OversizedPostPlaceholder
									post={entry.post}
									estimatedBytes={entry.estimatedBytes}
									limitBytes={data.maxPostPayloadBytes}
									onLoadAnyway={() => handleOversizeOverride(entry.post)}
								/>
							{/if}
						</div>
					{/each}
				</div>
			</div>
		{/if}
	</div>
{:else}
	<!-- Not Logged In View -->
	<div class="flex h-full items-center justify-center p-4 sm:p-6">
		<Card.Root class="max-w-md">
			<Card.Header>
				<Card.Title>Sign in required</Card.Title>
				<Card.Description>You need to be logged in to manage your posts.</Card.Description>
			</Card.Header>
		</Card.Root>
	</div>
{/if}
