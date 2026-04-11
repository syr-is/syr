<script lang="ts">
	import { Button } from '@syr-is/ui/button';
	import * as Tooltip from '@syr-is/ui/tooltip';
	import CommentComposer from './comment-composer.svelte';
	import ReactionBar from './reaction-bar.svelte';
	import CommentSignDialog from './comment-sign-dialog.svelte';
	import EmojiPicker from './emoji-picker.svelte';
	import GifPicker from './gif-picker.svelte';
	import {
		MessageSquare,
		ChevronDown,
		ChevronRight,
		Trash2,
		ShieldCheck,
		Pencil,
		KeyRound
	} from 'lucide-svelte';
	import { toast } from 'svelte-sonner';
	import { SvelteMap, SvelteSet } from 'svelte/reactivity';
	import { browser } from '$app/environment';
	import { renderEmojisInHtml, renderStickersInHtml } from '$lib/utils/emoji-renderer';
	import { getInstanceEmojis, getUserEmojis } from '$lib/stores/emoji-cache';

	type CommentData = {
		did: string;
		local_id: string;
		post_did: string;
		post_id: string;
		ancestor_chain: string[];
		content: string;
		visibility: string;
		status: string;
		created_at: string;
		content_signature?: string;
		signed_payload_json?: string;
		signing_device_public_key?: string;
		author_instance?: string;
	};

	type AuthorProfile = {
		display_name?: string;
		avatar_url?: string;
		username?: string;
	};

	type ReactionGroup = {
		kind: string;
		value: string;
		image_url?: string | null;
		count: number;
		reacted: boolean;
	};

	type ThreadNode = CommentData & {
		children: ThreadNode[];
		reactions: ReactionGroup[];
		_placeholder?: boolean;
	};

	let {
		postDid,
		postId,
		followedDids = [],
		currentUserDid = null
	}: {
		postDid: string;
		postId: string;
		followedDids?: Array<{ did: string; providerUrl: string }>;
		currentUserDid?: string | null;
	} = $props();

	type ManifestEndpoints = {
		profile?: string;
		public_emojis?: string;
		public_comments?: string;
		public_reactions?: string;
		web_profile?: string;
	};

	let threads = $state<ThreadNode[]>([]);
	let renderedHtml = new SvelteMap<string, string>();
	let emojiMap = $state<Record<string, string>>({});
	let authorProfiles = new SvelteMap<string, AuthorProfile>();
	const manifestCache = new SvelteMap<string, Promise<ManifestEndpoints>>();
	const authorWebProfiles = new SvelteMap<string, string>();
	let loadSeq = 0;
	let loading = $state(true);
	let sortOrder = $state<'oldest' | 'newest'>('newest');

	const sortedThreads = $derived.by(() => {
		const dir = sortOrder === 'newest' ? -1 : 1;
		return [...threads].sort(
			(a, b) => dir * (new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
		);
	});

	let replyTo = $state<{ type: 'post' | 'comment'; did: string; id: string } | null>(null);
	let collapsed = new SvelteSet<string>();
	let hoveredComment = $state<string | null>(null);
	let pickerOpen = $state(false);
	let reactionRefresh = new SvelteMap<string, number>();

	function bumpReactionRefresh(commentKey: string) {
		reactionRefresh.set(commentKey, (reactionRefresh.get(commentKey) ?? 0) + 1);
	}

	// Fetch and cache the identity manifest for a DID.
	// Caches the promise itself so concurrent callers share one in-flight request.
	function getManifestEndpoints(did: string, providerBase: string): Promise<ManifestEndpoints> {
		if (manifestCache.has(did)) return manifestCache.get(did)!;

		const promise = (async (): Promise<ManifestEndpoints> => {
			const endpoints: ManifestEndpoints = {};
			try {
				const base = providerBase || '';
				const res = await fetch(`${base}/.well-known/syr/${encodeURIComponent(did)}`, {
					headers: { Accept: 'application/json' }
				});
				if (res.ok) {
					const manifest = await res.json();
					if (manifest.endpoints) {
						endpoints.profile = manifest.endpoints.profile;
						endpoints.public_emojis = manifest.endpoints.public_emojis;
						endpoints.public_comments = manifest.endpoints.public_comments;
						endpoints.public_reactions = manifest.endpoints.public_reactions;
						if (manifest.web_profile) endpoints.web_profile = manifest.web_profile;
					}
				}
			} catch {
				/* fallback to hardcoded */
			}

			const base = providerBase || '';
			const encoded = encodeURIComponent(did);
			if (!endpoints.profile) endpoints.profile = `${base}/api/public/profile/${encoded}`;
			if (!endpoints.public_emojis)
				endpoints.public_emojis = `${base}/api/public/emojis/${encoded}`;
			if (!endpoints.public_comments)
				endpoints.public_comments = `${base}/api/public/comments/${encoded}`;
			if (!endpoints.public_reactions)
				endpoints.public_reactions = `${base}/api/public/reactions/${encoded}`;
			if (!endpoints.web_profile) endpoints.web_profile = `${base}/u/${encoded}`;

			// Store for synchronous access in templates
			authorWebProfiles.set(did, endpoints.web_profile);

			return endpoints;
		})();

		manifestCache.set(did, promise);
		return promise;
	}
	let editingKey = $state<string | null>(null);
	let editingNode = $state<CommentData | null>(null);

	function startEdit(node: CommentData) {
		editingKey = `${node.did}:${node.local_id}`;
		editingNode = node;
	}

	function cancelEdit() {
		editingKey = null;
		editingNode = null;
	}

	async function saveEdit(node: CommentData, newContent: string) {
		try {
			const res = await fetch(
				`/api/comments/${encodeURIComponent(node.did)}/${encodeURIComponent(node.local_id)}`,
				{
					method: 'PATCH',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ content: newContent })
				}
			);
			if (!res.ok) {
				const err = await res.json().catch(() => ({}));
				toast.error(err.message ?? 'Failed to update comment');
				return;
			}
			toast.success('Comment updated');
			cancelEdit();
			loadComments();
		} catch {
			toast.error('Failed to update comment');
		}
	}

	// Sign dialog state
	let signDialogOpen = $state(false);
	let signTarget = $state<CommentData | null>(null);

	function openSignDialog(node: CommentData) {
		signTarget = node;
		signDialogOpen = true;
	}

	async function handleSignResult(result: {
		content_signature: string;
		signed_payload_json: string;
		signing_device_public_key: string;
	}) {
		if (!signTarget) return;
		try {
			const res = await fetch(
				`/api/comments/${encodeURIComponent(signTarget.did)}/${encodeURIComponent(signTarget.local_id)}`,
				{
					method: 'PATCH',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify(result)
				}
			);
			if (!res.ok) {
				toast.error('Failed to save signature');
				return;
			}
			toast.success('Comment signed');
			signTarget = null;
			loadComments();
		} catch {
			toast.error('Failed to save signature');
		}
	}

	const profileFetchPending = new SvelteSet<string>();
	async function fetchAuthorProfile(did: string, base: string) {
		if (authorProfiles.has(did) || profileFetchPending.has(did)) return;
		profileFetchPending.add(did);
		try {
			const endpoints = await getManifestEndpoints(did, base);
			const res = await fetch(endpoints.profile!);
			if (!res.ok) return;
			const json = await res.json();
			if (json.status === 'success' && json.data) {
				authorProfiles.set(did, {
					display_name: json.data.display_name,
					avatar_url: json.data.avatar_url,
					username: json.data.username
				});
			}
		} catch {
			/* skip */
		} finally {
			profileFetchPending.delete(did);
		}
	}

	// Load emoji map from local instance + per-author personal emojis
	async function loadEmojiMapForAuthors(authorDids: Array<{ did: string; base: string }>) {
		const allEmojis: Array<{ shortcode: string; url: string }> = [];

		// 1. Local instance emojis (shared cache — no duplicate fetches)
		const instanceEmojis = await getInstanceEmojis();
		for (const e of instanceEmojis) {
			allEmojis.push({ shortcode: e.shortcode, url: e.url });
		}

		// 2. Each author's personal emojis via manifest endpoints (shared cache per URL)
		const emojiFetches = authorDids.map(async ({ did, base }) => {
			try {
				const endpoints = await getManifestEndpoints(did, base);
				const userEmojis = await getUserEmojis(endpoints.public_emojis!);
				for (const e of userEmojis) {
					allEmojis.push({ shortcode: e.shortcode, url: e.url });
				}
			} catch {
				/* skip */
			}
		});
		await Promise.all(emojiFetches);

		// Build map — first emoji for a shortcode wins, dupes get ~1, ~2 etc
		const map: Record<string, string> = {};
		const counts: Record<string, number> = {};
		for (const { shortcode, url } of allEmojis) {
			if (!(shortcode in map)) {
				map[shortcode] = url;
			} else {
				const count = (counts[shortcode] ?? 1) + 1;
				counts[shortcode] = count;
				map[`${shortcode}~${count - 1}`] = url;
			}
		}
		emojiMap = map;
	}

	async function loadComments() {
		const seq = ++loadSeq;
		loading = true;
		try {
			const allComments: CommentData[] = [];

			const didsToFetch: Array<{ did: string; base: string }> = [];
			const seenDids = new SvelteSet<string>();
			if (currentUserDid) {
				seenDids.add(currentUserDid);
				didsToFetch.push({ did: currentUserDid, base: '' });
			}
			for (const { did, providerUrl } of followedDids) {
				if (!seenDids.has(did)) {
					seenDids.add(did);
					didsToFetch.push({ did, base: providerUrl.replace(/\/$/, '') });
				}
			}

			// Fetch comments related to this post from each followed DID (one request each).
			// Uses post_did + post_id filter: returns root comments on this post
			// plus all comment-type replies by that DID (client filters the thread tree).
			const commentFetches = didsToFetch.map(async ({ did, base }) => {
				const instance = base ? new URL(base).hostname : 'local';
				fetchAuthorProfile(did, base);
				try {
					const endpoints = await getManifestEndpoints(did, base);
					const qs = `post_did=${encodeURIComponent(postDid)}&post_id=${encodeURIComponent(postId)}&limit=500`;
					const res = await fetch(`${endpoints.public_comments}?${qs}`);
					if (!res.ok) return;
					const json = await res.json();
					if (json.status === 'success' && json.data) {
						for (const c of json.data) {
							allComments.push({ ...c, author_instance: instance });
						}
					}
				} catch {
					/* skip */
				}
			});
			await Promise.all(commentFetches);

			// All comments are already filtered to this post by the API (post_did + post_id).
			// Dedup by key.
			const seenKeys = new SvelteSet<string>();
			const threadComments: CommentData[] = [];
			for (const c of allComments) {
				const key = `${c.did}:${c.local_id}`;
				if (!seenKeys.has(key)) {
					seenKeys.add(key);
					threadComments.push(c);
				}
			}

			// Fetch profiles for any new authors found in replies
			for (const c of threadComments) {
				if (!authorProfiles.has(c.did)) {
					const entry = didsToFetch.find((d) => d.did === c.did);
					if (entry) fetchAuthorProfile(c.did, entry.base);
				}
			}

			allComments.length = 0;
			allComments.push(...threadComments);

			if (seq !== loadSeq) return; // stale
			threads = buildThreadTree(allComments);

			if (browser && allComments.length > 0) {
				// Collect unique author DIDs with their instance bases
				const authorDidsMap = new SvelteMap<string, string>();
				for (const c of allComments) {
					if (!authorDidsMap.has(c.did)) {
						const entry = didsToFetch.find((d) => d.did === c.did);
						authorDidsMap.set(c.did, entry?.base ?? '');
					}
				}
				const authorDidsArray = Array.from(authorDidsMap.entries()).map(([did, base]) => ({
					did,
					base
				}));

				// Load emojis from all author instances THEN render
				await loadEmojiMapForAuthors(authorDidsArray);
				if (seq !== loadSeq) return; // stale

				try {
					const { sanitizeMarkdownToHtml } = await import('$lib/client/sanitize-post-body');
					for (const c of allComments) {
						const key = `${c.did}:${c.local_id}`;
						let html = await sanitizeMarkdownToHtml(c.content);
						html = renderStickersInHtml(html, emojiMap);
						html = renderEmojisInHtml(html, emojiMap);
						renderedHtml.set(key, html);
					}
				} catch {
					/* raw text fallback */
				}
			}
		} finally {
			if (seq === loadSeq) loading = false;
		}
	}

	function makePlaceholderNode(placeholderDid: string, placeholderLocalId: string): ThreadNode {
		return {
			did: placeholderDid,
			local_id: placeholderLocalId,
			post_did: postDid,
			post_id: postId,
			ancestor_chain: [],
			content: '',
			visibility: 'public',
			status: 'completed',
			created_at: new Date(0).toISOString(),
			author_instance: undefined,
			children: [],
			reactions: [],
			_placeholder: true
		} as ThreadNode;
	}

	function buildThreadTree(comments: CommentData[]): ThreadNode[] {
		const nodes = new SvelteMap<string, ThreadNode>();
		const roots: ThreadNode[] = [];

		for (const c of comments) {
			const key = `${c.did}:${c.local_id}`;
			nodes.set(key, { ...c, children: [], reactions: [] });
		}

		// First pass: attach nodes to parents or collect orphans.
		// Root comments have empty ancestor_chain. Nested comments' parent is the last chain entry.
		const orphans: ThreadNode[] = [];

		for (const node of nodes.values()) {
			const chain = node.ancestor_chain ?? [];
			if (chain.length === 0) {
				// Root comment on the post
				roots.push(node);
			} else {
				// Nested — parent is last entry in chain
				const parentKey = chain[chain.length - 1];
				const parent = nodes.get(parentKey);
				if (parent) {
					parent.children.push(node);
				} else {
					orphans.push(node);
				}
			}
		}

		// Second pass: place orphans using ancestor_chain to find nearest available ancestor.
		// For each orphan, walk its chain backwards to find an ancestor that exists in the tree.
		// Insert placeholder(s) for the missing gap between the found ancestor and the orphan.
		for (const orphan of orphans) {
			const chain = orphan.ancestor_chain ?? [];
			let placed = false;

			// Walk chain backwards (nearest ancestors first) to find one in the tree
			for (let i = chain.length - 1; i >= 0; i--) {
				const ancestorKey = chain[i];
				const ancestor = nodes.get(ancestorKey);
				if (ancestor) {
					// Build placeholder chain for the gap between ancestor and orphan
					let attachTo = ancestor;
					for (let j = i + 1; j < chain.length; j++) {
						const gapKey = chain[j];
						let gapNode = nodes.get(gapKey);
						if (!gapNode) {
							const lastColon = gapKey.lastIndexOf(':');
							const gapDid = gapKey.substring(0, lastColon);
							const gapId = gapKey.substring(lastColon + 1);
							gapNode = makePlaceholderNode(gapDid, gapId);
							nodes.set(gapKey, gapNode);
							attachTo.children.push(gapNode);
						}
						attachTo = gapNode;
					}
					attachTo.children.push(orphan);
					placed = true;
					break;
				}
			}

			if (!placed) {
				// No ancestor found in tree — create placeholder for immediate parent at root
				const oChain = orphan.ancestor_chain ?? [];
				const parentKey = oChain.length > 0 ? oChain[oChain.length - 1] : `unknown:${orphan.did}`;
				let placeholder = nodes.get(parentKey);
				if (!placeholder) {
					const lastColon = parentKey.lastIndexOf(':');
					const pDid = parentKey.substring(0, lastColon);
					const pId = parentKey.substring(lastColon + 1);
					placeholder = makePlaceholderNode(pDid, pId);
					nodes.set(parentKey, placeholder);
					roots.push(placeholder);
				}
				placeholder.children.push(orphan);
			}
		}

		const dir = sortOrder === 'newest' ? -1 : 1;
		roots.sort(
			(a, b) => dir * (new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
		);
		// Children always oldest-first within a thread
		for (const node of nodes.values()) {
			node.children.sort(
				(a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
			);
		}

		return roots;
	}

	function toggleCollapse(key: string) {
		if (collapsed.has(key)) collapsed.delete(key);
		else collapsed.add(key);
	}

	function startReply(type: 'post' | 'comment', did: string, id: string) {
		replyTo = { type, did, id };
	}

	function formatTime(iso: string): string {
		const d = new Date(iso);
		const now = new Date();
		const diff = now.getTime() - d.getTime();
		if (diff < 60000) return 'just now';
		if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
		if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
		return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
	}

	/** Profile page URL: manifest web_profile if resolved, local /u/{did} as fallback */
	function profileHref(did: string): string {
		return authorWebProfiles.get(did) ?? `/u/${encodeURIComponent(did)}`;
	}

	function getParentInfo(node: CommentData): { did: string; name: string } | null {
		const chain = node.ancestor_chain ?? [];
		if (chain.length === 0) return null; // root comment
		const parentKey = chain[chain.length - 1];
		const lastColon = parentKey.lastIndexOf(':');
		if (lastColon <= 0) return null;
		const parentDid = parentKey.substring(0, lastColon);
		const profile = authorProfiles.get(parentDid);
		const instance =
			node.author_instance && node.author_instance !== 'local' ? `@${node.author_instance}` : '';
		let name: string;
		if (profile?.username) name = `${profile.username}${instance}`;
		else if (profile?.display_name) name = `${profile.display_name}${instance}`;
		else {
			const short = parentDid.length > 24 ? parentDid.slice(8, 18) + '...' : parentDid.slice(8);
			name = `${short}${instance}`;
		}
		return { did: parentDid, name };
	}

	function getAuthorDisplay(node: CommentData): { name: string; avatar?: string } {
		const profile = authorProfiles.get(node.did);
		const instance =
			node.author_instance && node.author_instance !== 'local' ? `@${node.author_instance}` : '';
		if (profile?.username) {
			return {
				name: `${profile.username}${instance}`,
				avatar: profile.avatar_url
			};
		}
		if (profile?.display_name) {
			return {
				name: `${profile.display_name}${instance}`,
				avatar: profile.avatar_url
			};
		}
		const shortDid = node.did.length > 24 ? node.did.slice(8, 18) + '...' : node.did.slice(8);
		return { name: `${shortDid}${instance}` };
	}

	function isSigned(node: CommentData): boolean {
		return (
			!!node.content_signature && !!node.signed_payload_json && !!node.signing_device_public_key
		);
	}

	async function deleteComment(did: string, localId: string) {
		try {
			const res = await fetch(
				`/api/comments/${encodeURIComponent(did)}/${encodeURIComponent(localId)}`,
				{ method: 'DELETE' }
			);
			if (!res.ok) {
				toast.error('Failed to delete comment');
				return;
			}
			toast.success('Comment deleted');
			loadComments();
		} catch {
			toast.error('Failed to delete comment');
		}
	}

	async function toggleCommentReaction(
		commentDid: string,
		commentLocalId: string,
		kind: string,
		value: string,
		imageUrl?: string
	) {
		try {
			const res = await fetch('/api/reactions', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					parent_type: 'comment',
					parent_did: commentDid,
					parent_id: commentLocalId,
					kind,
					value,
					...(imageUrl ? { image_url: imageUrl } : {})
				})
			});
			if (res.ok) {
				bumpReactionRefresh(`${commentDid}:${commentLocalId}`);
			}
		} catch {
			/* skip */
		}
	}

	$effect(() => {
		if (postDid && postId) {
			loadComments();
		}
	});
</script>

{#snippet commentNode(node: ThreadNode, depth: number)}
	{@const key = `${node.did}:${node.local_id}`}
	{@const isCollapsed = collapsed.has(key)}
	{@const isOwn = node.did === currentUserDid}
	{@const author = getAuthorDisplay(node)}
	{@const signed = isSigned(node)}
	{@const isPlaceholder = node._placeholder === true}
	{@const parentInfo = getParentInfo(node)}
	<div style="margin-left: {Math.min(depth * 20, 80)}px">
		{#if isPlaceholder}
			<div class="rounded py-1.5 pr-1 pl-2 opacity-50">
				<div class="flex items-center gap-1.5 text-xs">
					{#if node.children.length > 0}
						<button
							type="button"
							class="p-0.5 text-muted-foreground"
							onclick={() => toggleCollapse(key)}
						>
							{#if isCollapsed}
								<ChevronRight class="h-3 w-3" />
							{:else}
								<ChevronDown class="h-3 w-3" />
							{/if}
						</button>
					{/if}
					<div
						class="flex h-7 w-7 items-center justify-center rounded-full bg-muted text-xs text-muted-foreground"
					>
						?
					</div>
					<a
						href={profileHref(node.did)}
						class="text-muted-foreground italic hover:text-foreground hover:underline"
					>
						{node.did.length > 30 ? node.did.slice(0, 24) + '...' : node.did}
					</a>
				</div>
				<div class="mt-0.5 pl-7 text-sm text-muted-foreground italic">
					This comment was deleted or is not available.
					<a href={profileHref(node.did)} class="text-primary hover:underline">View profile</a>
				</div>
			</div>
			{#if !isCollapsed && node.children.length > 0}
				{#each node.children as child (child.did + ':' + child.local_id)}
					{@render commentNode(child, depth + 1)}
				{/each}
			{/if}
		{:else}
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<div
				class="rounded py-1.5 pr-1 pl-2 hover:bg-muted/40"
				onmouseenter={(e) => {
					e.stopPropagation();
					hoveredComment = key;
				}}
				onmouseleave={() => {
					if (hoveredComment === key && !pickerOpen) hoveredComment = null;
				}}
			>
				<div class="flex items-center gap-1.5 text-xs">
					{#if node.children.length > 0}
						<button
							type="button"
							class="p-0.5 text-muted-foreground"
							onclick={() => toggleCollapse(key)}
						>
							{#if isCollapsed}
								<ChevronRight class="h-3 w-3" />
							{:else}
								<ChevronDown class="h-3 w-3" />
							{/if}
						</button>
					{/if}
					<!-- Avatar + Username (linked to profile) -->
					<a href={profileHref(node.did)} class="flex items-center gap-1.5 hover:underline">
						{#if author.avatar}
							<img src={author.avatar} alt="" class="h-7 w-7 rounded-full object-cover" />
						{:else}
							<div
								class="flex h-7 w-7 items-center justify-center rounded-full bg-muted text-xs font-bold text-muted-foreground uppercase"
							>
								{node.did.slice(8, 10)}
							</div>
						{/if}
						<span class="font-medium text-foreground">{author.name}</span>
					</a>
					{#if parentInfo}
						<span class="text-muted-foreground">replying to</span>
						<a
							href={profileHref(parentInfo.did)}
							class="font-medium text-muted-foreground hover:text-foreground hover:underline"
						>
							{parentInfo.name}
						</a>
					{/if}
					{#if signed}
						<Tooltip.Root>
							<Tooltip.Trigger>
								<ShieldCheck class="h-3 w-3 text-green-500" />
							</Tooltip.Trigger>
							<Tooltip.Content>
								<p>Cryptographically signed by the author</p>
							</Tooltip.Content>
						</Tooltip.Root>
					{/if}
					<span class="text-muted-foreground">{formatTime(node.created_at)}</span>
					{#if hoveredComment === key}
						<div class="ml-auto flex items-center gap-1">
							<EmojiPicker
								onSelect={(emoji) => {
									if (emoji.unicode) {
										toggleCommentReaction(node.did, node.local_id, 'unicode', emoji.shortcode);
									} else {
										const kind = emoji.is_sticker ? 'sticker' : 'custom_emoji';
										toggleCommentReaction(
											node.did,
											node.local_id,
											kind,
											emoji.shortcode,
											emoji.url
										);
									}
								}}
								triggerClass="h-5 w-5 rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
								onOpenChange={(o) => (pickerOpen = o)}
							/>
							<GifPicker
								onSelect={(gif) => {
									toggleCommentReaction(node.did, node.local_id, 'gif', gif.url, gif.url);
								}}
								onOpenChange={(o) => (pickerOpen = o)}
							/>
							{#if currentUserDid}
								<button
									type="button"
									class="rounded px-1.5 py-0.5 text-[10px] text-muted-foreground hover:bg-accent hover:text-foreground"
									onclick={() => startReply('comment', node.did, node.local_id)}
								>
									Reply
								</button>
							{/if}
							{#if isOwn}
								<button
									type="button"
									class="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
									title="Edit"
									onclick={() => startEdit(node)}
								>
									<Pencil class="h-3 w-3" />
								</button>
							{/if}
							{#if isOwn && !signed}
								<button
									type="button"
									class="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
									title="Sign this comment"
									onclick={() => openSignDialog(node)}
								>
									<KeyRound class="h-3 w-3" />
								</button>
							{/if}
							{#if isOwn}
								<button
									type="button"
									class="rounded p-0.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
									title="Delete comment"
									onclick={() => deleteComment(node.did, node.local_id)}
								>
									<Trash2 class="h-3 w-3" />
								</button>
							{/if}
						</div>
					{/if}
				</div>

				{#if editingKey === key && editingNode}
					<div class="mt-1 pl-7">
						<CommentComposer
							mode="edit"
							initialContent={editingNode.content}
							placeholder="Edit comment..."
							onSubmit={(newContent) => saveEdit(node, newContent)}
							onCancel={cancelEdit}
						/>
					</div>
				{:else}
					{@const htmlContent = renderedHtml.get(key)}
					<div class="prose prose-sm dark:prose-invert mt-0.5 max-w-none pl-7 text-sm">
						{#if htmlContent}
							<!-- eslint-disable-next-line svelte/no-at-html-tags -->
							{@html htmlContent}
						{:else}
							{node.content}
						{/if}
					</div>
				{/if}

				<div class="mt-1 pl-7">
					<ReactionBar
						parentType="comment"
						parentDid={node.did}
						parentId={node.local_id}
						{followedDids}
						{currentUserDid}
						showPicker={false}
						refreshTrigger={reactionRefresh.get(key) ?? 0}
					/>
				</div>

				{#if replyTo?.type === 'comment' && replyTo.did === node.did && replyTo.id === node.local_id}
					<div class="mt-2 pl-7">
						<CommentComposer
							{postDid}
							{postId}
							ancestorChain={[...(node.ancestor_chain ?? []), `${node.did}:${node.local_id}`]}
							placeholder="Reply..."
							onSubmit={() => {
								replyTo = null;
								loadComments();
							}}
						/>
						<Button variant="ghost" size="sm" class="mt-1 text-xs" onclick={() => (replyTo = null)}
							>Cancel</Button
						>
					</div>
				{/if}
			</div>

			{#if !isCollapsed && node.children.length > 0}
				{#each node.children as child (child.did + ':' + child.local_id)}
					{@render commentNode(child, depth + 1)}
				{/each}
			{/if}
		{/if}
	</div>
{/snippet}

<div class="space-y-3">
	<div class="flex items-center justify-between">
		<h3 class="flex items-center gap-2 text-sm font-semibold">
			<MessageSquare class="h-4 w-4" />
			Comments
		</h3>
		{#if threads.length > 1}
			<button
				type="button"
				class="text-xs text-muted-foreground hover:text-foreground"
				onclick={() => (sortOrder = sortOrder === 'newest' ? 'oldest' : 'newest')}
			>
				{sortOrder === 'newest' ? 'Newest first' : 'Oldest first'}
			</button>
		{/if}
	</div>

	{#if currentUserDid}
		{#if replyTo === null || replyTo.type === 'post'}
			<CommentComposer {postDid} {postId} onSubmit={loadComments} />
		{/if}
	{:else}
		<p class="py-1 text-center text-xs text-muted-foreground">Sign in to comment</p>
	{/if}

	{#if loading}
		<p class="py-2 text-center text-sm text-muted-foreground">Loading comments...</p>
	{:else if threads.length === 0}
		<p class="py-2 text-center text-sm text-muted-foreground">No comments yet.</p>
	{:else}
		{#each sortedThreads as thread (thread.did + ':' + thread.local_id)}
			{@render commentNode(thread, 0)}
		{/each}
	{/if}
</div>

{#if signTarget}
	<CommentSignDialog
		bind:open={signDialogOpen}
		commentDid={signTarget.did}
		commentLocalId={signTarget.local_id}
		commentContent={signTarget.content}
		commentPostDid={signTarget.post_did}
		commentPostId={signTarget.post_id}
		commentAncestorChain={signTarget.ancestor_chain ?? []}
		visibility={signTarget.visibility}
		status={signTarget.status}
		createdAtIso={signTarget.created_at}
		onSigned={handleSignResult}
	/>
{/if}

<style>
	:global(.prose .unicode-sticker) {
		display: block;
		font-size: 3rem;
		line-height: 1;
		margin: 0.25em 0;
	}
</style>
