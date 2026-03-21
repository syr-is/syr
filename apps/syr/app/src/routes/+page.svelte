<script lang="ts">
	import * as Card from '@syr-is/ui/card';
	import * as Avatar from '@syr-is/ui/avatar';
	import * as Select from '@syr-is/ui/select';
	import * as Pagination from '@syr-is/ui/pagination';
	import { Skeleton } from '@syr-is/ui/skeleton';
	import { Badge } from '@syr-is/ui/badge';
	import NewPost from '$lib/components/fragments/new-post.svelte';
	import PostPreview from '$lib/components/fragments/post-preview.svelte';
	import { getPostId, type Post } from '@syr-is/types';
	import { resolveProvider } from '@syr-is/resolver';
	import { registryApiRoot } from '$lib/registry-url';
	import { goto } from '$app/navigation';
	import { toast } from 'svelte-sonner';
	import { Pin } from 'lucide-svelte';
	import { SvelteMap } from 'svelte/reactivity';
	import DraggableItem from '$lib/components/fragments/draggable-item.svelte';

	let { data } = $props();

	// Posts state
	let posts = $state<Post[]>([]);
	let loading = $state(false);
	let error = $state<string | null>(null);

	// Pinned posts state
	let pinnedPosts = $state<Post[]>([]);
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

	type TimelineRow = {
		did: string;
		provider: string;
		title?: string;
		description?: string;
		created_at: string;
		local_id: string;
		fullUrl: string;
	};

	type TimelinePostDetail =
		| { status: 'idle' }
		| { status: 'loading' }
		| { status: 'error'; message: string }
		| { status: 'ready'; contentPreview?: string; mediaCount?: number };

	let timelineRows = $state<TimelineRow[]>([]);
	let timelinePostDetailByUrl = new SvelteMap<string, TimelinePostDetail>();

	function setTimelineDetail(url: string, detail: TimelinePostDetail) {
		timelinePostDetailByUrl.set(url, detail);
	}
	let timelineLoading = $state(false);
	let timelineError = $state<string | null>(null);

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

			const response = await fetch(`/api/posts?${params.toString()}`);
			if (!response.ok) {
				const errorData = await response.json();
				throw new Error(errorData.error?.message || 'Failed to fetch posts');
			}

			const result = await response.json();
			posts = result.data || [];
			total = result.pagination?.total || 0;
			const newMimeTypes: Record<string, string> = result.mediaUrlMimeTypes || {};
			const newFilenames: Record<string, string> = result.mediaUrlFilenames || {};
			mediaUrlMimeTypes = { ...mediaUrlMimeTypes, ...newMimeTypes };
			mediaUrlFilenames = { ...mediaUrlFilenames, ...newFilenames };
		} catch (err) {
			error = err instanceof Error ? err.message : 'An unexpected error occurred';
			posts = [];
		} finally {
			loading = false;
		}
	}

	// Fetch pinned posts function
	async function fetchPinnedPosts() {
		if (!data.user) return;

		_pinnedLoading = true;
		try {
			const response = await fetch('/api/posts/pinned');
			if (!response.ok) {
				const errorData = await response.json();
				throw new Error(errorData.error?.message || 'Failed to fetch pinned posts');
			}

			const result = await response.json();
			pinnedPosts = result.data?.posts || [];
			pinnedPostIds = result.data?.post_ids || [];
			const newMimeTypes: Record<string, string> = result.data?.mediaUrlMimeTypes || {};
			const newFilenames: Record<string, string> = result.data?.mediaUrlFilenames || {};
			mediaUrlMimeTypes = { ...mediaUrlMimeTypes, ...newMimeTypes };
			mediaUrlFilenames = { ...mediaUrlFilenames, ...newFilenames };
		} catch (err) {
			console.error('Failed to fetch pinned posts:', err);
			pinnedPosts = [];
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

		// Reorder the array locally first for immediate feedback
		const newOrder = [...pinnedPostIds];
		const [removed] = newOrder.splice(draggedIndex, 1);
		newOrder.splice(targetIndex, 0, removed);

		// Update local state immediately
		pinnedPostIds = newOrder;

		// Reorder pinnedPosts array to match
		const newPinnedPosts = [...pinnedPosts];
		const [removedPost] = newPinnedPosts.splice(draggedIndex, 1);
		newPinnedPosts.splice(targetIndex, 0, removedPost);
		pinnedPosts = newPinnedPosts;

		draggedIndex = null;
		dragOverIndex = null;

		// Send to server
		try {
			const response = await fetch('/api/posts/pinned', {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ post_ids: newOrder })
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
		if (!postId) {
			toast.error('Post link not available');
			return;
		}
		// eslint-disable-next-line svelte/no-navigation-without-resolve
		goto(`/posts/${postId}`);
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

	async function loadFollowingTimeline() {
		if (!data.user?.did) return;
		timelineLoading = true;
		timelineError = null;
		timelinePostDetailByUrl.clear();
		try {
			const [fr, rr] = await Promise.all([
				fetch('/api/follows'),
				fetch('/api/identity/registries')
			]);
			if (!fr.ok || !rr.ok) {
				timelineError = 'Could not load follows or registries';
				return;
			}
			const fj = await fr.json();
			const rj = await rr.json();
			const follows: { followed_did: string }[] = fj.data ?? [];
			const registries: { registry_url: string }[] = rj.data ?? [];
			const bases: string[] = [];
			for (const r of registries) {
				try {
					bases.push(registryApiRoot(r.registry_url));
				} catch {
					/* skip invalid registry URL */
				}
			}

			const RESOLVE_BASES_BATCH = 3;
			const FOLLOWS_CONCURRENCY = 4;

			async function loadFollowTimelineRows(f: { followed_did: string }): Promise<TimelineRow[]> {
				let provider: string | null = null;
				for (let i = 0; i < bases.length; i += RESOLVE_BASES_BATCH) {
					const chunk = bases.slice(i, i + RESOLVE_BASES_BATCH);
					const settled = await Promise.allSettled(
						chunk.map((b) => resolveProvider(f.followed_did, { registryUrl: b, timeout: 10_000 }))
					);
					const hit = settled.find(
						(s): s is PromiseFulfilledResult<string> => s.status === 'fulfilled'
					);
					if (hit) {
						provider = hit.value;
						break;
					}
				}
				if (!provider) return [];
				const origin = provider.replace(/\/$/, '');
				let metaRes: Response;
				try {
					metaRes = await fetch(
						`${origin}/api/public/posts/${encodeURIComponent(f.followed_did)}?limit=20`,
						{ signal: AbortSignal.timeout(12_000) }
					);
				} catch {
					return [];
				}
				if (!metaRes.ok) return [];
				const mj = await metaRes.json();
				const items = mj.data ?? [];
				const out: TimelineRow[] = [];
				for (const it of items) {
					if (!it.local_id) continue;
					out.push({
						did: f.followed_did,
						provider: origin,
						title: it.title,
						description: it.description,
						created_at: it.created_at,
						local_id: it.local_id,
						fullUrl: `${origin}/api/public/posts/${encodeURIComponent(f.followed_did)}/${encodeURIComponent(it.local_id)}`
					});
				}
				return out;
			}

			const rowChunks: TimelineRow[][] = [];
			for (let i = 0; i < follows.length; i += FOLLOWS_CONCURRENCY) {
				const batch = follows.slice(i, i + FOLLOWS_CONCURRENCY);
				const settled = await Promise.allSettled(batch.map((f) => loadFollowTimelineRows(f)));
				for (const s of settled) {
					if (s.status === 'fulfilled') rowChunks.push(s.value);
				}
			}
			const merged = rowChunks.flat();
			merged.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
			timelineRows = merged.slice(0, 100);
		} catch (e) {
			timelineError = e instanceof Error ? e.message : 'Timeline failed';
		} finally {
			timelineLoading = false;
		}
	}

	async function loadPostDetail(row: TimelineRow) {
		const key = row.fullUrl;
		const cur = timelinePostDetailByUrl.get(key);
		if (cur?.status === 'loading' || cur?.status === 'ready') return;
		setTimelineDetail(key, { status: 'loading' });
		try {
			const res = await fetch(row.fullUrl, { signal: AbortSignal.timeout(12_000) });
			if (!res.ok) throw new Error('Could not load post');
			const payload = await res.json();
			const d = payload?.data;
			if (d?.type === 'blog' && typeof d.content === 'string' && d.content) {
				setTimelineDetail(key, { status: 'ready', contentPreview: d.content });
			} else if (d?.type === 'media' && Array.isArray(d.media_urls) && d.media_urls.length > 0) {
				setTimelineDetail(key, { status: 'ready', mediaCount: d.media_urls.length });
			} else {
				setTimelineDetail(key, { status: 'ready' });
			}
		} catch (e) {
			setTimelineDetail(key, {
				status: 'error',
				message: e instanceof Error ? e.message : 'Failed to load'
			});
		}
	}

	$effect(() => {
		if (data.user?.did) {
			void loadFollowingTimeline();
		}
	});
</script>

{#if data.user}
	<div class="flex flex-col gap-4 space-y-6 p-4 sm:p-6 lg:flex-row lg:space-y-8 lg:p-8">
		<div class="min-w-0 flex-1 space-y-6 lg:w-[calc(100%-24rem)]">
			<!-- Controls Row -->
			<div class="flex flex-wrap items-center justify-between gap-2">
				<div class="flex items-center gap-2">
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

			{#if data.user?.did}
				<div class="space-y-2 rounded-lg border p-4">
					<div class="flex items-center justify-between gap-2">
						<h2 class="text-lg font-semibold">Following (remote)</h2>
						<button
							type="button"
							class="text-xs text-muted-foreground underline"
							onclick={() => loadFollowingTimeline()}
						>
							Refresh
						</button>
					</div>
					{#if timelineLoading}
						<p class="text-sm text-muted-foreground">Loading merged public posts…</p>
					{:else if timelineError}
						<p class="text-sm text-destructive">{timelineError}</p>
					{:else if timelineRows.length === 0}
						<p class="text-sm text-muted-foreground">
							Follow identities from <span class="font-mono">u/…</span> and ensure your registries can
							resolve them. Public posts load client-side from each provider (CORS applies).
						</p>
					{:else}
						<ul class="max-h-96 space-y-2 overflow-y-auto">
							{#each timelineRows as row (row.fullUrl)}
								{@const d = timelinePostDetailByUrl.get(row.fullUrl)}
								<li class="rounded-md border px-3 py-2 text-sm">
									<p class="font-medium">{row.title || 'Untitled'}</p>
									<p class="font-mono text-xs text-muted-foreground">{row.did}</p>
									<p class="text-xs text-muted-foreground">
										{new Date(row.created_at).toLocaleString()}
									</p>
									{#if d?.status === 'ready' && d.contentPreview}
										<p class="mt-2 line-clamp-3 text-xs">{d.contentPreview}</p>
									{:else if d?.status === 'ready' && d.mediaCount != null}
										<p class="mt-1 text-xs text-muted-foreground">
											Media post ({d.mediaCount} items)
										</p>
									{:else if d?.status === 'error'}
										<p class="mt-1 text-xs text-destructive">{d.message}</p>
									{:else if d?.status === 'loading'}
										<p class="mt-1 text-xs text-muted-foreground">Loading full post…</p>
									{:else}
										<button
											type="button"
											class="mt-1 text-xs text-muted-foreground underline"
											onclick={() => loadPostDetail(row)}
										>
											Load details
										</button>
									{/if}
								</li>
							{/each}
						</ul>
					{/if}
				</div>
			{/if}

			<!-- Pinned Posts Section -->
			{#if pinnedPosts.length > 0}
				<div class="space-y-3">
					<div class="flex items-center gap-2">
						<Pin class="h-4 w-4 text-primary" />
						<h2 class="text-lg font-semibold">Pinned Posts</h2>
						<Badge variant="secondary" class="text-xs">{pinnedPosts.length}/10</Badge>
					</div>
					<div class="grid gap-4 md:grid-cols-2">
						{#each pinnedPosts as post, index (getPostId(post))}
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
								<button
									type="button"
									class="w-full text-left"
									onclick={() => handlePostClick(post)}
									onkeydown={(e) => {
										if (e.key === 'Enter' || e.key === ' ') {
											e.preventDefault();
											handlePostClick(post);
										}
									}}
								>
									<PostPreview
										{post}
										isPinned={true}
										onPinToggle={handlePinToggle}
										showPinButton={true}
										{mediaUrlMimeTypes}
										{mediaUrlFilenames}
									/>
								</button>
							</DraggableItem>
						{/each}
					</div>
				</div>
			{/if}

			<!-- Posts List -->
			{#if loading}
				<div class="grid gap-4 md:grid-cols-2">
					{#each Array(6) as _, i (i)}
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
			{:else if posts.length === 0}
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
					<div class="grid gap-4 md:grid-cols-2">
						{#each posts as post (getPostId(post))}
							<button
								type="button"
								class="w-full text-left"
								onclick={() => handlePostClick(post)}
								onkeydown={(e) => {
									if (e.key === 'Enter' || e.key === ' ') {
										e.preventDefault();
										handlePostClick(post);
									}
								}}
							>
								<PostPreview
									{post}
									isPinned={isPostPinned(getPostId(post))}
									onPinToggle={handlePinToggle}
									showPinButton={true}
									{mediaUrlMimeTypes}
									{mediaUrlFilenames}
								/>
							</button>
						{/each}
					</div>
				</div>
			{/if}
		</div>
		<!-- Discord-style Profile Card -->
		<Card.Root class="w-full shrink-0 overflow-hidden lg:w-96">
			<!-- Banner -->
			{#if data.user.profile?.banner_url}
				<div class="relative h-32 bg-gradient-to-r from-blue-500 to-purple-600">
					<img
						src={data.user.profile.banner_url}
						alt="Profile banner"
						class="h-full w-full object-cover"
					/>
				</div>
			{:else}
				<div class="h-32 bg-gradient-to-r from-blue-500 to-purple-600"></div>
			{/if}

			<Card.Content class="relative pt-16 pb-6">
				<!-- Avatar positioned over banner -->
				<div class="absolute -top-12 left-6">
					<Avatar.Root class="h-24 w-24 border-4 border-background">
						<Avatar.Image
							src={data.user.profile?.avatar_url}
							alt={data.user.profile?.display_name ?? data.user.username}
						/>
						<Avatar.Fallback class="text-2xl">
							{data.user.profile?.display_name?.charAt(0).toUpperCase() ??
								data.user.username.charAt(0).toUpperCase()}
						</Avatar.Fallback>
					</Avatar.Root>
				</div>

				<!-- Profile Info -->
				<div class="space-y-4">
					<div class="space-y-2">
						<div class="flex items-center gap-2">
							<h2 class="text-2xl font-bold">
								{data.user.profile?.display_name ?? data.user.username}
							</h2>
							{#if data.user.role === 'ADMIN'}
								<span
									class="inline-flex items-center rounded-full bg-primary/10 px-2 py-1 text-xs font-medium text-primary"
								>
									Admin
								</span>
							{/if}
						</div>
						<p class="text-lg text-muted-foreground">@{data.user.username}</p>
						{#if data.user.did}
							<p class="font-mono text-xs break-all text-muted-foreground/70">{data.user.did}</p>
						{/if}
					</div>

					{#if data.user.profile?.bio}
						<div class="rounded-lg bg-muted/50 p-4">
							<p class="text-sm leading-relaxed">
								{data.user.profile.bio}
							</p>
						</div>
					{/if}
				</div>
			</Card.Content>
		</Card.Root>
	</div>
{:else}
	<!-- Logged Out View -->
	<div class="mt-4 space-y-4 p-4 text-center sm:p-6">
		<h1 class="text-4xl font-bold tracking-tight sm:text-6xl">
			Welcome to <span class="text-primary">SYR</span>
		</h1>
		<p class="text-xl text-muted-foreground">Self-Yield Representation</p>
		<p class="text-lg text-muted-foreground">
			Your sovereign digital presence. No algorithms, no lock-in, just you.
		</p>
		<p class="text-lg text-muted-foreground">Login to get started or register a new account.</p>
	</div>
{/if}
