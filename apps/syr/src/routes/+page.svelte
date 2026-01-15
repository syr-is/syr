<script lang="ts">
	import * as Card from '$lib/components/ui/card';
	import * as Avatar from '$lib/components/ui/avatar';
	import * as Select from '$lib/components/ui/select';
	import * as Pagination from '$lib/components/ui/pagination';
	import { Skeleton } from '$lib/components/ui/skeleton';
	import NewPost from '$lib/components/fragments/new-post.svelte';
	import PostPreview from '$lib/components/fragments/post-preview.svelte';
	import type { Post } from '@syr-is/types';
	import { goto } from '$app/navigation';

	let { data } = $props();

	// Posts state
	let posts = $state<Post[]>([]);
	let loading = $state(false);
	let error = $state<string | null>(null);

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

			const response = await fetch(`/api/posts?${params.toString()}`);
			if (!response.ok) {
				const errorData = await response.json();
				throw new Error(errorData.error?.message || 'Failed to fetch posts');
			}

			const result = await response.json();
			posts = result.data || [];
			total = result.pagination?.total || 0;
		} catch (err) {
			error = err instanceof Error ? err.message : 'An unexpected error occurred';
			posts = [];
		} finally {
			loading = false;
		}
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

	// Handle post click - navigate to viewing page
	function handlePostClick(post: Post) {
		const postId = typeof post.id === 'string' ? post.id : post.id.toString();
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
</script>

{#if data.user}
	<div class="flex gap-4 space-y-8 p-8">
		<div class="w-[calc(100%-24rem)] space-y-6">
			<!-- Controls Row -->
			<div class="flex items-center justify-between gap-4">
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
				<NewPost />
			</div>

			<!-- Posts List -->
			{#if loading}
				<div class="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
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
						<p class="text-destructive text-center">{error}</p>
					</Card.Content>
				</Card.Root>
			{:else if posts.length === 0}
				<Card.Root>
					<Card.Content class="py-12">
						<div class="space-y-2 text-center">
							<h3 class="text-lg font-semibold">No posts yet</h3>
							<p class="text-muted-foreground text-sm">Get started by creating your first post!</p>
						</div>
					</Card.Content>
				</Card.Root>
			{:else}
				<div class="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
					{#each posts as post (post.id.toString())}
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
							<PostPreview {post} />
						</button>
					{/each}
				</div>
			{/if}
		</div>
		<!-- Discord-style Profile Card -->
		<Card.Root class="w-96 overflow-hidden">
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

			<Card.Content class="relative pb-6 pt-16">
				<!-- Avatar positioned over banner -->
				<div class="absolute -top-12 left-6">
					<Avatar.Root class="border-background h-24 w-24 border-4">
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
									class="bg-primary/10 text-primary inline-flex items-center rounded-full px-2 py-1 text-xs font-medium"
								>
									Admin
								</span>
							{/if}
						</div>
						<p class="text-muted-foreground text-lg">@{data.user.username}</p>
					</div>

					{#if data.user.profile?.bio}
						<div class="bg-muted/50 rounded-lg p-4">
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
	<div class="mt-4 space-y-4 text-center">
		<h1 class="text-4xl font-bold tracking-tight sm:text-6xl">
			Welcome to <span class="text-primary">SYR</span>
		</h1>
		<p class="text-muted-foreground text-xl">Self-Yield Representation</p>
		<p class="text-muted-foreground text-lg">
			Your sovereign digital presence. No algorithms, no lock-in, just you.
		</p>
	</div>
{/if}
