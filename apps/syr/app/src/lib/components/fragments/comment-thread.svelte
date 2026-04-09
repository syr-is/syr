<script lang="ts">
	import { Button } from '@syr-is/ui/button';
	import CommentComposer from './comment-composer.svelte';
	import ReactionBar from './reaction-bar.svelte';
	import { MessageSquare, ChevronDown, ChevronRight, Trash2 } from 'lucide-svelte';
	import { toast } from 'svelte-sonner';
	import { SvelteMap, SvelteSet } from 'svelte/reactivity';

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
	let loading = $state(true);
	let replyTo = $state<{ type: 'post' | 'comment'; did: string; id: string } | null>(null);
	let collapsed = new SvelteSet<string>();

	async function loadComments() {
		loading = true;
		try {
			const allComments: CommentData[] = [];

			// Fetch from each followed user's instance
			const fetches = followedDids.map(async ({ did, providerUrl }) => {
				try {
					const base = providerUrl.replace(/\/$/, '');
					const qs = `parent_type=post&parent_did=${encodeURIComponent(postDid)}&parent_id=${encodeURIComponent(postId)}&limit=100`;
					const res = await fetch(`${base}/api/public/comments/${encodeURIComponent(did)}?${qs}`);
					if (!res.ok) return;
					const json = await res.json();
					if (json.status === 'success' && json.data) {
						for (const c of json.data) {
							allComments.push({ ...c, author_instance: new URL(base).hostname });
						}
					}
				} catch {
					// Silently skip unreachable instances
				}
			});

			await Promise.all(fetches);

			// Also fetch own comments from local instance
			if (currentUserDid) {
				try {
					const qs = `parent_type=post&parent_did=${encodeURIComponent(postDid)}&parent_id=${encodeURIComponent(postId)}&limit=100`;
					const res = await fetch(
						`/api/public/comments/${encodeURIComponent(currentUserDid)}?${qs}`
					);
					if (res.ok) {
						const json = await res.json();
						if (json.status === 'success' && json.data) {
							for (const c of json.data) {
								allComments.push({ ...c, author_instance: 'local' });
							}
						}
					}
				} catch {
					// Skip
				}
			}

			threads = buildThreadTree(allComments);
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

		// Build tree
		for (const node of nodes.values()) {
			if (node.parent_type === 'post') {
				roots.push(node);
			} else {
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
				<div class="prose prose-sm dark:prose-invert mt-1 max-w-none text-sm">
					{node.content}
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
