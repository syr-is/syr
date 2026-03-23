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
	import { getPostId, type Post, type UploadWithCompositeId } from '@syr-is/types';
	import MediaViewer from '$lib/components/fragments/media-viewer.svelte';

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

	let catalogTab = $state<'posts' | 'media'>('posts');
	let lastProfileDid = $state('');

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
		catalogTab = 'posts';
	}

	/** Reset lists and page indices when navigating to a different profile. */
	$effect(() => {
		const d = p.did ?? '';
		if (d === '') {
			resetCatalogState();
			lastProfileDid = '';
			return;
		}
		if (lastProfileDid === d) return;
		lastProfileDid = d;
		resetCatalogState();
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
			const url = `/api/public/posts/${encodeURIComponent(did)}?full=1&limit=${POST_PAGE_SIZE}&offset=${offset}`;
			const r = await fetchJsonWithByteLimit(url, { maxRawBytes: MAX_JSON_RESPONSE_BYTES });
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
			const url = `/api/public/uploads/${encodeURIComponent(did)}?limit=${UPLOAD_PAGE_SIZE}&offset=${offset}`;
			const r = await fetchJsonWithByteLimit(url, { maxRawBytes: MAX_JSON_RESPONSE_BYTES });
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
		if (!d) return;
		const _page = postsPage;
		// Touch pagination so this effect re-runs when `postsPage` changes (see fetchPublicPosts).
		void _page;
		void fetchPublicPosts().catch((e) => console.error('fetchPublicPosts:', e));
	});

	$effect(() => {
		const d = p.did ?? '';
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
				const res = await fetch(`/api/follows/check?did=${encodeURIComponent(did)}`, {
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
				const res = await fetch(`/api/follows?followed_did=${encodeURIComponent(currentDid)}`, {
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

			const res = await fetch('/api/follows', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ followed_did: currentDid })
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
			signing_device_public_key: p.signing_device_public_key
		}}
		showFollow={canFollow}
		{followBusy}
		{followStateLoading}
		{isFollowing}
		onFollow={toggleFollow}
		bioVariant="divider"
	/>

	{#if p.did}
		<Tabs.Root bind:value={catalogTab} class="w-full">
			<Tabs.List class="grid w-full max-w-md grid-cols-2">
				<Tabs.Trigger value="posts">Posts</Tabs.Trigger>
				<Tabs.Trigger value="media">Media</Tabs.Trigger>
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
		</Tabs.Root>
	{/if}
</div>
