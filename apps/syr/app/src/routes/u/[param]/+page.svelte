<script lang="ts">
	import * as Card from '@syr-is/ui/card';
	import * as Tabs from '@syr-is/ui/tabs';
	import * as Pagination from '@syr-is/ui/pagination';
	import { Button } from '@syr-is/ui/button';
	import ProfileCard from '$lib/components/fragments/profile-card.svelte';
	import PostPreview from '$lib/components/fragments/post-preview.svelte';
	import OversizedPostPlaceholder from '$lib/components/fragments/oversized-post-placeholder.svelte';
	import { userSessionStore } from '$lib/stores/user-session.svelte';
	import { toast } from 'svelte-sonner';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import {
		buildOrderedFeedEntries,
		fetchJsonWithByteLimit
	} from '$lib/client/fetch-with-content-limit.js';
	import { MAX_JSON_RESPONSE_BYTES } from '$lib/client/content-limit-config.js';
	import {
		hasPostSizeOverride,
		postSizeOverrideKeyForPost
	} from '$lib/client/post-size-override.js';
	import {
		getPostId,
		type Post,
		type UploadWithCompositeId,
		PublicStorySlideSchema
	} from '@syr-is/types';
	import MediaViewer from '$lib/components/fragments/media-viewer.svelte';
	import * as Dialog from '@syr-is/ui/dialog';
	import type { StorySlide } from '$lib/types/feed-stories';

	let { data } = $props();

	type FollowsApiJson = {
		error?: { message?: string };
		message?: string;
		data?: unknown | null;
	};

	const POST_PAGE_SIZE = 24;
	const UPLOAD_PAGE_SIZE = 24;

	const p = $derived(data.publicProfile);
	const viewer = $derived(userSessionStore.user);
	const canFollow = $derived(!!viewer?.did && !!p.did && p.did !== viewer.did);
	const isRemoteProfile = $derived(data.profileSource === 'remote');
	const remoteHomeHref = $derived.by(() => {
		if (data.remoteEndpoints?.web_profile) return data.remoteEndpoints.web_profile;
		const o = data.resolvedProviderOrigin?.trim().replace(/\/$/, '');
		if (o) return o;
		const host = p.identity_host_url?.trim();
		return host || null;
	});

	let catalogTab = $state<'posts' | 'media' | 'following'>('posts');
	let lastProfileKey = $state('');

	let postsPage = $state(1);
	let postsRaw = $state<unknown[]>([]);
	let postsTotal = $state(0);
	let postsLoading = $state(false);
	let postsError = $state<string | null>(null);

	let uploadsPage = $state(1);
	let uploadsRaw = $state<unknown[]>([]);
	let uploadsTotal = $state(0);
	let uploadsLoading = $state(false);
	let uploadsError = $state<string | null>(null);

	let mediaUrlMimeTypes = $state<Record<string, string>>({});
	let mediaUrlFilenames = $state<Record<string, string>>({});

	let postsFetchSeq = 0;
	let uploadsFetchSeq = 0;

	const feedEntries = $derived(
		buildOrderedFeedEntries(postsRaw, data.maxPostPayloadBytes, (rec) =>
			hasPostSizeOverride(postSizeOverrideKeyForPost(rec as Post))
		)
	);

	const postsTotalPages = $derived(Math.max(1, Math.ceil(postsTotal / POST_PAGE_SIZE)));
	const uploadsTotalPages = $derived(Math.max(1, Math.ceil(uploadsTotal / UPLOAD_PAGE_SIZE)));

	const postsRangeStart = $derived(postsTotal === 0 ? 0 : (postsPage - 1) * POST_PAGE_SIZE + 1);
	const postsRangeEnd = $derived(Math.min(postsPage * POST_PAGE_SIZE, postsTotal));

	const uploadsRangeStart = $derived(
		uploadsTotal === 0 ? 0 : (uploadsPage - 1) * UPLOAD_PAGE_SIZE + 1
	);
	const uploadsRangeEnd = $derived(Math.min(uploadsPage * UPLOAD_PAGE_SIZE, uploadsTotal));

	/** Current uploads page → same shape as post `media_urls` + maps for `MediaViewer`. */
	const publicMediaBundle = $derived.by(() => {
		const urls: string[] = [];
		const mimeTypes: Record<string, string> = {};
		const filenames: Record<string, string> = {};
		for (const raw of uploadsRaw as UploadWithCompositeId[]) {
			const u = raw;
			if (!u.url) continue;
			urls.push(u.url);
			if (u.mime_type) mimeTypes[u.url] = u.mime_type;
			if (u.filename) filenames[u.url] = u.filename;
		}
		return { urls, mimeTypes, filenames };
	});

	let followBusy = $state(false);
	let isFollowing = $state(false);
	let followStateLoading = $state(false);

	let storySlides = $state<StorySlide[]>([]);
	let storyViewerOpen = $state(false);
	let storySlideIndex = $state(0);
	let storiesFetchSeq = 0;

	async function loadStories(did: string) {
		const seq = ++storiesFetchSeq;
		storySlides = [];
		try {
			const storiesUrl =
				data.profileSource === 'remote' && data.remoteEndpoints
					? data.remoteEndpoints.stories
					: `/api/public/stories/${encodeURIComponent(did)}`;
			const res = await fetch(storiesUrl, {
				signal: AbortSignal.timeout(12_000),
				credentials: data.profileSource === 'remote' ? 'omit' : 'same-origin'
			});
			if (!res.ok) return;
			const j = (await res.json()) as { data?: { slides?: unknown[] } };
			const raw = j.data?.slides;
			if (!Array.isArray(raw)) return;
			const validated: StorySlide[] = [];
			for (const item of raw) {
				const parsed = PublicStorySlideSchema.safeParse(item);
				if (parsed.success) validated.push(parsed.data);
			}
			if (seq === storiesFetchSeq) storySlides = validated;
		} catch {
			// ignore
		}
	}

	function openStoryViewer() {
		if (storySlides.length === 0) return;
		storySlideIndex = 0;
		storyViewerOpen = true;
	}

	function storyNext() {
		if (storySlideIndex < storySlides.length - 1) storySlideIndex += 1;
		else storyViewerOpen = false;
	}

	function storyPrev() {
		if (storySlideIndex > 0) storySlideIndex -= 1;
	}

	type PublicFollow = {
		followed_did: string;
		followed_provider_url: string | null;
		created_at: string;
	};
	let publicFollows = $state<PublicFollow[]>([]);
	let publicFollowsLoading = $state(false);
	let publicFollowsError = $state<string | null>(null);
	let publicFollowsLoaded = $state(false);

	async function loadPublicFollows(did: string) {
		publicFollowsLoading = true;
		publicFollowsError = null;
		publicFollows = [];
		try {
			const followingUrl =
				data.profileSource === 'remote' && data.remoteEndpoints?.public_following
					? data.remoteEndpoints.public_following
					: `/api/public/following/${encodeURIComponent(did)}`;
			const res = await fetch(followingUrl, {
				signal: AbortSignal.timeout(12_000),
				credentials: data.profileSource === 'remote' ? 'omit' : 'same-origin'
			});
			if (!res.ok) {
				publicFollowsError = 'Could not load public follows';
				return;
			}
			const j = (await res.json()) as { data?: PublicFollow[] };
			publicFollows = j.data ?? [];
		} catch {
			publicFollowsError = 'Could not load public follows';
		} finally {
			publicFollowsLoading = false;
			publicFollowsLoaded = true;
		}
	}

	function resetCatalogState() {
		postsFetchSeq++;
		uploadsFetchSeq++;
		postsPage = 1;
		postsRaw = [];
		postsTotal = 0;
		postsError = null;
		uploadsPage = 1;
		uploadsRaw = [];
		uploadsTotal = 0;
		uploadsError = null;
		mediaUrlMimeTypes = {};
		mediaUrlFilenames = {};
		publicFollows = [];
		publicFollowsLoaded = false;
		publicFollowsError = null;
		catalogTab = 'posts';
	}

	/** Reset lists and page indices when navigating to a different profile or provider. */
	$effect(() => {
		const d = p.did ?? '';
		const key = `${d}::${data.resolvedProviderOrigin ?? ''}`;
		if (d === '') {
			resetCatalogState();
			storySlides = [];
			lastProfileKey = '';
			return;
		}
		if (lastProfileKey === key) return;
		lastProfileKey = key;
		resetCatalogState();
		storySlides = [];
		if (d) void loadStories(d);
	});

	async function fetchPublicPosts() {
		const did = p.did;
		if (!did) return;
		const seq = ++postsFetchSeq;
		const page = postsPage;
		postsRaw = [];
		mediaUrlMimeTypes = {};
		mediaUrlFilenames = {};
		postsLoading = true;
		postsError = null;
		try {
			const offset = (page - 1) * POST_PAGE_SIZE;
			const postsPath =
				data.profileSource === 'remote' && data.remoteEndpoints
					? data.remoteEndpoints.posts
					: `/api/public/posts/${encodeURIComponent(did)}`;
			const url = `${postsPath}?full=1&limit=${POST_PAGE_SIZE}&offset=${offset}`;
			const r = await fetchJsonWithByteLimit(url, {
				maxRawBytes: MAX_JSON_RESPONSE_BYTES,
				credentials: data.profileSource === 'remote' ? 'omit' : 'same-origin'
			});
			if (seq !== postsFetchSeq) return;
			if (!r.ok) {
				if (r.error === 'too_large') {
					throw new Error(
						'The posts response is too large to load safely. Try again with a smaller page or adjust content trust in Settings.'
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
			const rows = result.data ?? [];
			postsRaw = rows;
			postsTotal = result.pagination?.total ?? rows.length;
			mediaUrlMimeTypes = {
				...mediaUrlMimeTypes,
				...(result.mediaUrlMimeTypes ?? {})
			};
			mediaUrlFilenames = {
				...mediaUrlFilenames,
				...(result.mediaUrlFilenames ?? {})
			};
		} catch (e) {
			if (seq !== postsFetchSeq) return;
			postsError = e instanceof Error ? e.message : 'Failed to load posts';
			postsRaw = [];
		} finally {
			if (seq === postsFetchSeq) postsLoading = false;
		}
	}

	async function fetchPublicUploads() {
		const did = p.did;
		if (!did) return;
		const seq = ++uploadsFetchSeq;
		const page = uploadsPage;
		uploadsRaw = [];
		uploadsLoading = true;
		uploadsError = null;
		try {
			const offset = (page - 1) * UPLOAD_PAGE_SIZE;
			const uploadsPath =
				data.profileSource === 'remote' && data.remoteEndpoints
					? data.remoteEndpoints.uploads
					: `/api/public/uploads/${encodeURIComponent(did)}`;
			const url = `${uploadsPath}?limit=${UPLOAD_PAGE_SIZE}&offset=${offset}`;
			const r = await fetchJsonWithByteLimit(url, {
				maxRawBytes: MAX_JSON_RESPONSE_BYTES,
				credentials: data.profileSource === 'remote' ? 'omit' : 'same-origin'
			});
			if (seq !== uploadsFetchSeq) return;
			if (!r.ok) {
				if (r.error === 'too_large') {
					throw new Error('The uploads response is too large to load safely.');
				}
				throw new Error(r.message);
			}
			const result = r.json as {
				data?: unknown[];
				pagination?: { total?: number };
			};
			const rows = result.data ?? [];
			uploadsRaw = rows;
			uploadsTotal = result.pagination?.total ?? rows.length;
		} catch (e) {
			if (seq !== uploadsFetchSeq) return;
			uploadsError = e instanceof Error ? e.message : 'Failed to load uploads';
			uploadsRaw = [];
		} finally {
			if (seq === uploadsFetchSeq) uploadsLoading = false;
		}
	}

	$effect(() => {
		const d = p.did ?? '';
		void data.profileSource;
		void data.resolvedProviderOrigin;
		if (!d) return;
		const _page = postsPage;
		// Touch pagination so this effect re-runs when `postsPage` changes (see fetchPublicPosts).
		void _page;
		void fetchPublicPosts().catch((e) => console.error('fetchPublicPosts:', e));
	});

	$effect(() => {
		const d = p.did ?? '';
		void data.profileSource;
		void data.resolvedProviderOrigin;
		if (!d || catalogTab !== 'media') return;
		const _page = uploadsPage;
		// Touch pagination so this effect re-runs when `uploadsPage` changes (see fetchPublicUploads).
		void _page;
		void fetchPublicUploads().catch((e) => console.error('fetchPublicUploads:', e));
	});

	$effect(() => {
		const did = p.did ?? '';
		const viewerDid = viewer?.did;
		const can = !!viewerDid && !!did && did !== viewerDid;
		if (!can) {
			isFollowing = false;
			followStateLoading = false;
			return;
		}
		followStateLoading = true;
		let cancelled = false;
		void (async () => {
			try {
				const checkQs = `did=${encodeURIComponent(did)}${data.resolvedProviderOrigin ? `&provider=${encodeURIComponent(data.resolvedProviderOrigin)}` : ''}`;
				const res = await fetch(`/api/follows/check?${checkQs}`, {
					credentials: 'include'
				});
				const j = (await res.json().catch(() => ({}))) as {
					data?: { following?: boolean };
				};
				if (cancelled) return;
				if (!res.ok) {
					isFollowing = false;
					return;
				}
				isFollowing = Boolean(j.data?.following);
			} catch {
				if (!cancelled) isFollowing = false;
			} finally {
				if (!cancelled) followStateLoading = false;
			}
		})();
		return () => {
			cancelled = true;
		};
	});

	function postPublicRouteParams(post: Post): { did: string; id: string } {
		return { did: post.did ?? '', id: post.local_id ?? '' };
	}

	function handlePostClick(post: Post) {
		void goto(resolve('/p/[did]/[id]', postPublicRouteParams(post)));
	}

	async function toggleFollow() {
		if (!p.did || !viewer || followBusy || followStateLoading) return;
		const currentDid = p.did;
		followBusy = true;
		try {
			if (isFollowing) {
				const delQs = `followed_did=${encodeURIComponent(currentDid)}${data.resolvedProviderOrigin ? `&provider_url=${encodeURIComponent(data.resolvedProviderOrigin)}` : ''}`;
				const res = await fetch(`/api/follows?${delQs}`, {
					method: 'DELETE'
				});
				if (p.did !== currentDid) return;
				const j: FollowsApiJson = (await res.json().catch(() => ({}))) as FollowsApiJson;
				if (p.did !== currentDid) return;
				if (!res.ok) {
					toast.error(j.error?.message ?? j.message ?? 'Unfollow failed');
					return;
				}
				isFollowing = false;
				toast.success('Unfollowed');
				return;
			}

			const followBody: { followed_did: string; provider_url?: string } = {
				followed_did: currentDid
			};
			if (data.resolvedProviderOrigin) {
				followBody.provider_url = data.resolvedProviderOrigin;
			}
			const res = await fetch('/api/follows', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(followBody)
			});
			if (p.did !== currentDid) return;
			const j: FollowsApiJson = (await res.json().catch(() => ({}))) as FollowsApiJson;
			if (p.did !== currentDid) return;
			if (!res.ok) {
				toast.error(j.error?.message ?? j.message ?? 'Follow failed');
				return;
			}
			if (j.data === null) {
				toast.info('No change');
				return;
			}
			isFollowing = true;
			toast.success('Now following');
		} catch (e) {
			if (p.did !== currentDid) return;
			toast.error(e instanceof Error ? e.message : 'Follow failed');
		} finally {
			followBusy = false;
		}
	}
</script>

<div class="mx-auto max-w-5xl space-y-8 p-4">
	<ProfileCard
		profile={{
			username: p.username,
			display_name: p.display_name,
			bio: p.bio,
			avatar_url: p.avatar_url,
			banner_url: p.banner_url,
			did: p.did,
			signed_payload_json: p.signed_payload_json,
			content_signature: p.content_signature,
			signing_device_public_key: p.signing_device_public_key,
			instanceHost:
				isRemoteProfile && data.resolvedProviderOrigin
					? (() => {
							try {
								return new URL(data.resolvedProviderOrigin).host;
							} catch {
								return null;
							}
						})()
					: null
		}}
		showFollow={canFollow}
		{followBusy}
		{followStateLoading}
		{isFollowing}
		onFollow={toggleFollow}
		bioVariant="divider"
		hasStories={storySlides.length > 0}
		onStoryClick={openStoryViewer}
	/>

	{#if isRemoteProfile}
		<div
			class="rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground"
			role="status"
		>
			<p>
				This identity is hosted on another instance. Public posts and media below are loaded from
				their provider.
			</p>
			{#if remoteHomeHref}
				<p class="mt-2">
					<a
						href={remoteHomeHref}
						class="font-medium text-primary underline"
						target="_blank"
						rel="noopener noreferrer"
					>
						Visit their instance
					</a>
				</p>
			{/if}
		</div>
	{/if}

	{#if p.did}
		<Tabs.Root bind:value={catalogTab} class="w-full">
			<Tabs.List class="grid w-full max-w-md grid-cols-3">
				<Tabs.Trigger value="posts">Posts</Tabs.Trigger>
				<Tabs.Trigger value="media">Media</Tabs.Trigger>
				<Tabs.Trigger
					value="following"
					onclick={() => {
						if (!publicFollowsLoaded && p.did) void loadPublicFollows(p.did);
					}}>Following</Tabs.Trigger
				>
			</Tabs.List>

			<Tabs.Content value="posts" class="mt-4 space-y-3">
				<div class="flex flex-wrap items-center justify-between gap-3">
					<div class="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
						<h2 class="text-lg font-semibold">Public posts</h2>
						{#if postsTotal > 0}
							<p class="text-xs text-muted-foreground">
								{postsRangeStart}–{postsRangeEnd} of {postsTotal}
							</p>
						{/if}
					</div>
					{#if postsTotalPages > 1}
						<Pagination.Root
							bind:page={postsPage}
							count={postsTotal}
							perPage={POST_PAGE_SIZE}
							siblingCount={1}
							class="w-auto shrink-0"
						>
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
				{#if postsError}
					<Card.Root>
						<Card.Content class="flex flex-col gap-2 py-6 text-sm text-destructive">
							<p>{postsError}</p>
							<Button size="sm" variant="outline" class="w-fit" onclick={() => fetchPublicPosts()}>
								Retry
							</Button>
						</Card.Content>
					</Card.Root>
				{:else if postsLoading && feedEntries.length === 0}
					<Card.Root>
						<Card.Content class="py-8 text-center text-sm text-muted-foreground">
							Loading posts…
						</Card.Content>
					</Card.Root>
				{:else if feedEntries.length === 0}
					<Card.Root>
						<Card.Content class="py-8 text-center text-sm text-muted-foreground">
							No public posts yet.
						</Card.Content>
					</Card.Root>
				{:else}
					<div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
						{#each feedEntries as entry (entry.kind === 'post' ? getPostId(entry.post) : `os-${getPostId(entry.post)}`)}
							<div class="w-full">
								{#if entry.kind === 'post'}
									<div
										role="button"
										tabindex="0"
										class="w-full cursor-pointer rounded-md text-left focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
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
											showPinButton={false}
											showOwnerActions={false}
											{mediaUrlMimeTypes}
											{mediaUrlFilenames}
										/>
									</div>
								{:else}
									<div
										role="button"
										tabindex="0"
										class="w-full cursor-pointer rounded-md text-left focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
										onclick={() => handlePostClick(entry.post)}
										onkeydown={(e) => {
											if (e.key === 'Enter' || e.key === ' ') {
												e.preventDefault();
												handlePostClick(entry.post);
											}
										}}
									>
										<OversizedPostPlaceholder
											post={entry.post}
											estimatedBytes={entry.estimatedBytes}
											limitBytes={data.maxPostPayloadBytes}
											postViewPath={resolve('/p/[did]/[id]', postPublicRouteParams(entry.post))}
											onLoadAnyway={() => handlePostClick(entry.post)}
										/>
									</div>
								{/if}
							</div>
						{/each}
					</div>
				{/if}
			</Tabs.Content>

			<Tabs.Content value="media" class="mt-4 space-y-3">
				<div class="flex flex-wrap items-center justify-between gap-3">
					<div class="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
						<h2 class="text-lg font-semibold">Public files</h2>
						{#if uploadsTotal > 0}
							<p class="text-xs text-muted-foreground">
								{uploadsRangeStart}–{uploadsRangeEnd} of {uploadsTotal}
							</p>
						{/if}
					</div>
					{#if uploadsTotalPages > 1}
						<Pagination.Root
							bind:page={uploadsPage}
							count={uploadsTotal}
							perPage={UPLOAD_PAGE_SIZE}
							siblingCount={1}
							class="w-auto shrink-0"
						>
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
				{#if uploadsError}
					<Card.Root>
						<Card.Content class="flex flex-col gap-2 py-6 text-sm text-destructive">
							<p>{uploadsError}</p>
							<Button
								size="sm"
								variant="outline"
								class="w-fit"
								onclick={() => fetchPublicUploads()}
							>
								Retry
							</Button>
						</Card.Content>
					</Card.Root>
				{:else if uploadsLoading && uploadsRaw.length === 0}
					<Card.Root>
						<Card.Content class="py-8 text-center text-sm text-muted-foreground">
							Loading media…
						</Card.Content>
					</Card.Root>
				{:else if uploadsRaw.length === 0}
					<Card.Root>
						<Card.Content class="py-8 text-center text-sm text-muted-foreground">
							No public files in storage yet.
						</Card.Content>
					</Card.Root>
				{:else}
					{#key p.did}
						<MediaViewer
							mediaUrls={publicMediaBundle.urls}
							mediaUrlMimeTypes={publicMediaBundle.mimeTypes}
							mediaUrlFilenames={publicMediaBundle.filenames}
							defaultMode="cards"
						/>
					{/key}
				{/if}
			</Tabs.Content>

			<Tabs.Content value="following" class="mt-4 space-y-3">
				{#if publicFollowsError}
					<Card.Root>
						<Card.Content class="py-8 text-center text-sm text-destructive">
							{publicFollowsError}
						</Card.Content>
					</Card.Root>
				{:else if publicFollowsLoading}
					<Card.Root>
						<Card.Content class="py-8 text-center text-sm text-muted-foreground">
							Loading public follows…
						</Card.Content>
					</Card.Root>
				{:else if publicFollows.length === 0}
					<Card.Root>
						<Card.Content class="py-8 text-center text-sm text-muted-foreground">
							No public follows.
						</Card.Content>
					</Card.Root>
				{:else}
					<div class="space-y-2">
						{#each publicFollows as f (f.followed_did + (f.followed_provider_url ?? ''))}
							<Card.Root class="p-0">
								<Card.Content class="flex items-center justify-between gap-3 px-4 py-3">
									<div class="min-w-0 flex-1">
										<p class="truncate font-mono text-sm">{f.followed_did}</p>
										{#if f.followed_provider_url}
											<p class="truncate font-mono text-xs text-muted-foreground">
												{f.followed_provider_url}
											</p>
										{/if}
									</div>
									<Button
										variant="outline"
										size="sm"
										onclick={() => {
											if (f.followed_provider_url) {
												window.open(
													`/u/${encodeURIComponent(f.followed_did)}?provider=${encodeURIComponent(f.followed_provider_url)}`,
													'_blank'
												);
											} else {
												window.open(`/u/${encodeURIComponent(f.followed_did)}`, '_blank');
											}
										}}
									>
										View
									</Button>
								</Card.Content>
							</Card.Root>
						{/each}
					</div>
				{/if}
			</Tabs.Content>
		</Tabs.Root>
	{/if}
</div>

<Dialog.Root
	bind:open={storyViewerOpen}
	onOpenChange={(open) => {
		if (!open) storySlideIndex = 0;
	}}
>
	<Dialog.Content
		showCloseButton={false}
		class="fixed inset-0 z-50 h-[100dvh] max-h-[100dvh] w-full max-w-none translate-x-0 translate-y-0 rounded-none border-0 bg-black p-0 text-white shadow-none data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0 sm:max-w-none"
	>
		{#if storySlides.length > 0}
			{@const s = storySlides[storySlideIndex]}
			<div class="relative flex h-[100dvh] w-full items-center justify-center">
				{#if s.mime_type.startsWith('video/')}
					<video
						src={s.url}
						controls
						class="max-h-full max-w-full object-contain"
						autoplay
						playsinline
					>
						<track kind="captions" label="Captions unavailable" />
					</video>
				{:else}
					<img src={s.url} alt="" class="max-h-full max-w-full object-contain" />
				{/if}
				<button
					type="button"
					class="absolute top-4 right-4 rounded-md bg-white/10 px-3 py-1.5 text-sm hover:bg-white/20"
					onclick={() => (storyViewerOpen = false)}
				>
					Close
				</button>
				{#if storySlides.length > 1}
					<button
						type="button"
						class="absolute top-1/2 left-2 -translate-y-1/2 rounded-full bg-white/10 px-3 py-2 text-xl hover:bg-white/20"
						onclick={storyPrev}
						aria-label="Previous slide"
					>
						‹
					</button>
					<button
						type="button"
						class="absolute top-1/2 right-2 -translate-y-1/2 rounded-full bg-white/10 px-3 py-2 text-xl hover:bg-white/20"
						onclick={storyNext}
						aria-label="Next slide"
					>
						›
					</button>
				{/if}
				<p class="absolute bottom-4 left-1/2 -translate-x-1/2 text-xs text-white/70">
					{storySlideIndex + 1} / {storySlides.length}
				</p>
			</div>
		{/if}
	</Dialog.Content>
</Dialog.Root>
