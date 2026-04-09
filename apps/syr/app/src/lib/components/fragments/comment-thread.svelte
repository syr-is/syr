<script lang="ts">
	import { Button } from '@syr-is/ui/button';
	import CommentComposer from './comment-composer.svelte';
	import ReactionBar from './reaction-bar.svelte';
	import { MessageSquare, ChevronDown, ChevronRight, Trash2 } from 'lucide-svelte';
	import { toast } from 'svelte-sonner';
	import { SvelteMap, SvelteSet } from 'svelte/reactivity';
	import { browser } from '$app/environment';

	type CommentData = {
		did: string;
		local_id: string;
		parent_type: string;
		parent_did: string;
		parent_id: string;
		content: string;
		visibility: string;
		status: string;
		created_at: string;
		author_username?: string;
		author_instance?: string;
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

	let threads = $state<ThreadNode[]>([]);
	let renderedHtml = new SvelteMap<string, string>();
	let loading = $state(true);
	let replyTo = $state<{ type: 'post' | 'comment'; did: string; id: string } | null>(null);
	let collapsed = new SvelteSet<string>();

	async function loadComments() {
		loading = true;
		try {
			const allComments: CommentData[] = [];

			// Collect all DIDs to fetch from (followed + self)
			const didsToFetch: Array<{ did: string; base: string }> = [];
			for (const { did, providerUrl } of followedDids) {
				didsToFetch.push({ did, base: providerUrl.replace(/\/$/, '') });
			}
			if (currentUserDid) {
				didsToFetch.push({ did: currentUserDid, base: '' });
			}

			// For each DID: fetch root comments on this post, then fetch
			// replies (parent_type=comment) for any comment DIDs we find
			const fetches = didsToFetch.map(async ({ did, base }) => {
				const apiBase = base || '';
				const instance = base ? new URL(base).hostname : 'local';

				try {
					// Fetch direct comments on the post
					const rootQs = `parent_type=post&parent_did=${encodeURIComponent(postDid)}&parent_id=${encodeURIComponent(postId)}&limit=100`;
					const rootRes = await fetch(
						`${apiBase}/api/public/comments/${encodeURIComponent(did)}?${rootQs}`
					);
					if (!rootRes.ok) return;
					const rootJson = await rootRes.json();
					if (rootJson.status === 'success' && rootJson.data) {
						for (const c of rootJson.data) {
							allComments.push({ ...c, author_instance: instance });
						}
					}

					// Also fetch this user's replies to any comment in the thread
					// We query for comments whose parent is any comment by any DID
					// (broad fetch, filtered client-side by tree builder)
					const replyRes = await fetch(
						`${apiBase}/api/public/comments/${encodeURIComponent(did)}?limit=200`
					);
					if (replyRes.ok) {
						const replyJson = await replyRes.json();
						if (replyJson.status === 'success' && replyJson.data) {
							for (const c of replyJson.data) {
								if (c.parent_type === 'comment') {
									// Dedupe by did+local_id
									const exists = allComments.some(
										(existing) => existing.did === c.did && existing.local_id === c.local_id
									);
									if (!exists) {
										allComments.push({ ...c, author_instance: instance });
									}
								}
							}
						}
					}
				} catch {
					// Silently skip unreachable instances
				}
			});

			await Promise.all(fetches);

			threads = buildThreadTree(allComments);

			// Render markdown for all comments
			if (browser && allComments.length > 0) {
				try {
					const { sanitizeMarkdownToHtml } = await import('$lib/client/sanitize-post-body');
					for (const c of allComments) {
						const key = `${c.did}:${c.local_id}`;
						const html = await sanitizeMarkdownToHtml(c.content);
						renderedHtml.set(key, html);
					}
				} catch {
					// Markdown rendering unavailable — will show raw text
				}
			}
		} finally {
			loading = false;
		}
	}

	function buildThreadTree(comments: CommentData[]): ThreadNode[] {
		const nodes = new SvelteMap<string, ThreadNode>();
		const roots: ThreadNode[] = [];

		// Create nodes
		for (const c of comments) {
			const key = `${c.did}:${c.local_id}`;
			nodes.set(key, { ...c, children: [], reactions: [] });
		}

		// Build tree — root comments are those directly on this post
		for (const node of nodes.values()) {
			if (node.parent_type === 'post' && node.parent_did === postDid && node.parent_id === postId) {
				roots.push(node);
			} else if (node.parent_type === 'comment') {
				const parentKey = `${node.parent_did}:${node.parent_id}`;
				const parent = nodes.get(parentKey);
				if (parent) {
					parent.children.push(node);
				} else {
					// Orphan — parent not found, show as root
					roots.push(node);
				}
			}
		}

		// Sort by created_at ascending
		roots.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
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

	$effect(() => {
		if (postDid && postId) loadComments();
	});
</script>

{#snippet commentNode(node: ThreadNode, depth: number)}
	{@const key = `${node.did}:${node.local_id}`}
	{@const isCollapsed = collapsed.has(key)}
	{@const isOwn = node.did === currentUserDid}
	<div class="group" style="margin-left: {Math.min(depth * 24, 96)}px">
		<div
			class="rounded-lg border-l-2 border-transparent py-2 pr-2 pl-3 hover:border-primary/30 hover:bg-muted/30"
		>
			<!-- Header -->
			<div class="flex items-center gap-2 text-xs text-muted-foreground">
				{#if node.children.length > 0}
					<button type="button" class="p-0.5" onclick={() => toggleCollapse(key)}>
						{#if isCollapsed}
							<ChevronRight class="h-3 w-3" />
						{:else}
							<ChevronDown class="h-3 w-3" />
						{/if}
					</button>
				{/if}
				<span class="font-medium text-foreground">
					{node.author_username ?? node.did.slice(0, 20) + '...'}
				</span>
				{#if node.author_instance && node.author_instance !== 'local'}
					<span class="text-muted-foreground">@{node.author_instance}</span>
				{/if}
				<span>{formatTime(node.created_at)}</span>
				<div class="ml-auto flex items-center gap-1 opacity-0 group-hover:opacity-100">
					<button
						type="button"
						class="rounded p-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
						onclick={() => startReply('comment', node.did, node.local_id)}
					>
						Reply
					</button>
					{#if isOwn}
						<button
							type="button"
							class="rounded p-1 text-xs text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
							onclick={() => deleteComment(node.did, node.local_id)}
						>
							<Trash2 class="h-3 w-3" />
						</button>
					{/if}
				</div>
			</div>

			<!-- Content -->
			{#if !isCollapsed}
				{@const htmlContent = renderedHtml.get(key)}
				<div class="prose prose-sm dark:prose-invert mt-1 max-w-none text-sm">
					{#if htmlContent}
						<!-- eslint-disable-next-line svelte/no-at-html-tags -->
						{@html htmlContent}
					{:else}
						{node.content}
					{/if}
				</div>

				<!-- Reactions -->
				{#if node.reactions.length > 0}
					<div class="mt-1.5">
						<ReactionBar
							parentType="comment"
							parentDid={node.did}
							parentId={node.local_id}
							reactions={node.reactions}
							onToggle={loadComments}
						/>
					</div>
				{/if}

				<!-- Inline reply composer -->
				{#if replyTo?.type === 'comment' && replyTo.did === node.did && replyTo.id === node.local_id}
					<div class="mt-2">
						<CommentComposer
							parentType="comment"
							parentDid={node.did}
							parentId={node.local_id}
							placeholder="Reply..."
							onSubmit={() => {
								replyTo = null;
								loadComments();
							}}
						/>
						<Button variant="ghost" size="sm" class="mt-1" onclick={() => (replyTo = null)}
							>Cancel</Button
						>
					</div>
				{/if}
			{/if}
		</div>

		<!-- Children -->
		{#if !isCollapsed && node.children.length > 0}
			{#each node.children as child (child.did + ':' + child.local_id)}
				{@render commentNode(child, depth + 1)}
			{/each}
		{/if}
	</div>
{/snippet}

<div class="space-y-4">
	<h3 class="flex items-center gap-2 text-sm font-semibold">
		<MessageSquare class="h-4 w-4" />
		Comments
	</h3>

	{#if loading}
		<p class="py-4 text-center text-sm text-muted-foreground">Loading comments...</p>
	{:else if threads.length === 0}
		<p class="py-4 text-center text-sm text-muted-foreground">
			No comments yet. Be the first to comment!
		</p>
	{:else}
		{#each threads as thread (thread.did + ':' + thread.local_id)}
			{@render commentNode(thread, 0)}
		{/each}
	{/if}

	<!-- Root-level composer -->
	{#if currentUserDid}
		{#if replyTo === null || replyTo.type === 'post'}
			<CommentComposer
				parentType="post"
				parentDid={postDid}
				parentId={postId}
				onSubmit={loadComments}
			/>
		{/if}
	{:else}
		<p class="py-2 text-center text-sm text-muted-foreground">Sign in to comment</p>
	{/if}
</div>
