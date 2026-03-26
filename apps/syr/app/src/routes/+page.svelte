<script lang="ts">
	import * as Card from '@syr-is/ui/card';
	import ProfileCard from '$lib/components/fragments/profile-card.svelte';
	import { Button } from '@syr-is/ui/button';
	import RemoteFollowingPostCard from '$lib/components/fragments/remote-following-post-card.svelte';
	import { fetchPublicPostWithLimits } from '$lib/client/fetch-with-content-limit.js';
	import {
		hasPostSizeOverride,
		postSizeOverrideKeyForUrl,
		setPostSizeOverride
	} from '$lib/client/post-size-override.js';
	import { resolveProvider } from '@syr-is/resolver';
	import { registryApiRoot } from '$lib/registry-url';
	import { normalizeProviderBaseUrl } from '$lib/normalize-provider-base-url';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { SvelteMap } from 'svelte/reactivity';

	let { data } = $props();

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
		| { status: 'ready'; contentPreview?: string; mediaCount?: number }
		| {
				status: 'oversized';
				kind: 'raw' | 'payload';
				byteLength: number;
				limit: number;
		  };

	let timelineRows = $state<TimelineRow[]>([]);
	let timelinePostDetailByUrl = new SvelteMap<string, TimelinePostDetail>();
	type RemoteAuthorProfile = {
		displayName: string;
		username: string;
		avatarUrl: string | null;
		bannerUrl: string | null;
	};
	let remoteProfileByDid = $state<Record<string, RemoteAuthorProfile | null>>({});
	let followingCount = $state(0);

	function setTimelineDetail(url: string, detail: TimelinePostDetail) {
		timelinePostDetailByUrl.set(url, detail);
	}
	let timelineLoading = $state(false);
	let timelineError = $state<string | null>(null);

	const feedEmpty = $derived(
		!timelineLoading && !timelineError && timelineRows.length === 0 && !!data.user?.did
	);

	async function enrichRemoteTimelineProfiles(rows: TimelineRow[]) {
		const didToProvider: Record<string, string> = {};
		for (const r of rows) {
			if (!(r.did in didToProvider)) didToProvider[r.did] = r.provider;
		}
		const entries = Object.entries(didToProvider);
		const batchSize = 5;
		for (let i = 0; i < entries.length; i += batchSize) {
			const chunk = entries.slice(i, i + batchSize);
			await Promise.all(
				chunk.map(async ([did, provider]) => {
					let profile: RemoteAuthorProfile | null = null;
					try {
						const base = provider.replace(/\/$/, '');
						const res = await fetch(`${base}/api/public/profile/${encodeURIComponent(did)}`, {
							signal: AbortSignal.timeout(8_000)
						});
						if (res.ok) {
							const j = (await res.json()) as {
								data?: {
									username?: string;
									display_name?: string | null;
									avatar_url?: string | null;
									banner_url?: string | null;
								};
							};
							const d = j.data;
							if (d) {
								const uname = d.username?.trim() || '';
								profile = {
									displayName: (d.display_name?.trim() || uname || did) as string,
									username: uname || '—',
									avatarUrl: d.avatar_url ?? null,
									bannerUrl: d.banner_url ?? null
								};
							}
						}
					} catch {
						profile = null;
					}
					remoteProfileByDid = { ...remoteProfileByDid, [did]: profile };
				})
			);
		}
	}

	function handleRemoteOversizeOverride(row: TimelineRow) {
		setPostSizeOverride(postSizeOverrideKeyForUrl(row.fullUrl));
		void loadPostDetail(row);
	}

	async function loadFollowingTimeline() {
		if (!data.user?.did) return;
		timelineLoading = true;
		timelineError = null;
		timelinePostDetailByUrl.clear();
		remoteProfileByDid = {};
		followingCount = 0;
		try {
			const [fr, rr] = await Promise.all([
				fetch('/api/follows'),
				fetch('/api/user/discovery-registries')
			]);
			if (!fr.ok || !rr.ok) {
				timelineError = 'Could not load follows or discovery registries';
				return;
			}
			const fj = await fr.json();
			const rj = await rr.json();
			const follows: { followed_did: string; followed_provider_url?: string | null }[] =
				fj.data ?? [];
			followingCount = follows.length;
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

			async function loadFollowTimelineRows(f: {
				followed_did: string;
				followed_provider_url?: string | null;
			}): Promise<TimelineRow[]> {
				let provider: string | null = null;
				const stored = f.followed_provider_url
					? normalizeProviderBaseUrl(f.followed_provider_url)
					: null;
				if (stored) {
					provider = stored;
				} else {
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
			await enrichRemoteTimelineProfiles(timelineRows);
			const prefetchDetails = 20;
			for (let i = 0; i < Math.min(prefetchDetails, timelineRows.length); i++) {
				void loadPostDetail(timelineRows[i]);
			}
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
		const urlKey = postSizeOverrideKeyForUrl(row.fullUrl);
		const maxPayload = hasPostSizeOverride(urlKey)
			? Number.MAX_SAFE_INTEGER
			: data.maxPostPayloadBytes;
		const result = await fetchPublicPostWithLimits(row.fullUrl, {
			maxPayloadBytes: maxPayload,
			signal: AbortSignal.timeout(12_000)
		});
		if (!result.ok) {
			if (result.error === 'too_large') {
				setTimelineDetail(key, {
					status: 'oversized',
					kind: result.kind,
					byteLength: result.byteLength,
					limit: result.limit
				});
				return;
			}
			setTimelineDetail(key, { status: 'error', message: result.message });
			return;
		}
		const d = result.data;
		if (d?.type === 'blog' && typeof d.content === 'string' && d.content) {
			setTimelineDetail(key, { status: 'ready', contentPreview: d.content });
		} else if (d?.type === 'media' && Array.isArray(d.media_urls) && d.media_urls.length > 0) {
			setTimelineDetail(key, { status: 'ready', mediaCount: d.media_urls.length });
		} else {
			setTimelineDetail(key, { status: 'ready' });
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
			<div class="mx-auto w-full max-w-2xl space-y-6">
				<div>
					<h1 class="text-2xl font-semibold tracking-tight">Feed</h1>
					<p class="mt-1 text-sm text-muted-foreground">
						Public posts from people you follow. Manage your own posts from the Posts page.
					</p>
				</div>

				{#if !data.user.did}
					<Card.Root>
						<Card.Content class="space-y-3 py-6">
							<p class="text-sm text-muted-foreground">
								Add a <span class="font-medium text-foreground">did:syr</span> identity to follow others
								and load this feed.
							</p>
							<Button href={resolve('/settings/identity')} variant="secondary" size="sm">
								Identity settings
							</Button>
						</Card.Content>
					</Card.Root>
				{:else}
					<div class="flex flex-wrap items-center justify-between gap-2">
						<Button href={resolve('/posts')} variant="outline" size="sm" class="shrink-0">
							Your posts
						</Button>
						<button
							type="button"
							class="text-xs text-muted-foreground underline"
							onclick={() => loadFollowingTimeline()}
						>
							Refresh feed
						</button>
					</div>

					{#if timelineLoading}
						<p class="text-sm text-muted-foreground">Loading feed…</p>
					{:else if timelineError}
						<p class="text-sm text-destructive">{timelineError}</p>
					{:else if feedEmpty}
						<Card.Root>
							<Card.Content class="space-y-4 py-8">
								<h2 class="text-lg font-semibold">Nothing in your feed yet</h2>
								<div class="space-y-3 text-sm text-muted-foreground">
									{#if followingCount === 0}
										<p>
											You are not following anyone yet. Open <span
												class="font-medium text-foreground">Search</span
											>
											to discover people on your discovery registries, visit their profile, and follow
											them.
										</p>
									{:else}
										<p>
											There are no recent public posts from people you follow— they may not have
											posted yet, or their instance could not be reached. You can still use Search
											to find more people to follow.
										</p>
									{/if}
									{#if data.followerCount === 0}
										<p>
											No accounts on this instance follow you yet. Share your public profile (<span
												class="font-mono text-xs text-foreground">u/…</span
											>) so others can find you.
										</p>
									{/if}
								</div>
								<Button onclick={() => goto(resolve('/search'))}>Go to search</Button>
							</Card.Content>
						</Card.Root>
					{:else}
						<div class="space-y-4">
							{#each timelineRows as row (row.fullUrl)}
								{@const d = timelinePostDetailByUrl.get(row.fullUrl)}
								{@const author =
									row.did in remoteProfileByDid ? remoteProfileByDid[row.did] : undefined}
								<RemoteFollowingPostCard
									{row}
									{author}
									detail={d}
									onLoadDetail={loadPostDetail}
									onOversizeOverride={handleRemoteOversizeOverride}
								/>
							{/each}
						</div>
					{/if}
				{/if}
			</div>
		</div>
		<ProfileCard
			class="w-full shrink-0 lg:w-96"
			profile={{
				username: data.user.username,
				display_name: data.user.profile?.display_name,
				bio: data.user.profile?.bio,
				avatar_url: data.user.profile?.avatar_url,
				banner_url: data.user.profile?.banner_url,
				did: data.user.did,
				signed_payload_json: data.user.profile?.signed_payload_json,
				content_signature: data.user.profile?.content_signature,
				signing_device_public_key: data.user.profile?.signing_device_public_key
			}}
			showAdminBadge={data.user.role === 'ADMIN'}
			showFollow={false}
			bioVariant="muted"
			followingHref={resolve('/following')}
			followingCount={data.followingCount}
		/>
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
