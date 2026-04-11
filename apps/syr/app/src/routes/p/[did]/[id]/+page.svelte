<script lang="ts">
	import * as Card from '@syr-is/ui/card';
	import { Badge } from '@syr-is/ui/badge';
	import { Button } from '@syr-is/ui/button';
	import MediaViewer from '$lib/components/fragments/media-viewer.svelte';
	import SignatureVerification from '$lib/components/fragments/signature-verification.svelte';
	import { sanitizeMarkdownToHtml, sanitizePostHtmlFragment } from '$lib/client/sanitize-post-body';
	import { renderEmojisInHtml, renderStickersInHtml } from '$lib/utils/emoji-renderer';
	import { getInstanceEmojis, getUserEmojis } from '$lib/stores/emoji-cache';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { ArrowLeft } from 'lucide-svelte';
	import CommentThread from '$lib/components/fragments/comment-thread.svelte';
	import ReactionBar from '$lib/components/fragments/reaction-bar.svelte';
	import type { PageData } from './$types';
	import type { Post } from '@syr-is/types';

	let { data }: { data: PageData } = $props();

	let blogHtml = $state('');
	let bodyReady = $state(false);

	let sanitizeGen = 0;

	function formatDate(iso: string): string {
		const d = new Date(iso);
		if (Number.isNaN(d.getTime())) return '—';
		return new Intl.DateTimeFormat(undefined, {
			year: 'numeric',
			month: 'long',
			day: 'numeric'
		}).format(d);
	}

	$effect(() => {
		const p = data.post as unknown as Post;
		const gen = ++sanitizeGen;
		bodyReady = false;
		blogHtml = '';
		void (async () => {
			try {
				if (p.type === 'blog') {
					let html = '';
					if (p.content_type === 'markdown' && p.content?.trim()) {
						html = await sanitizeMarkdownToHtml(p.content, false);
					} else if (p.content_type === 'html' && p.content?.trim()) {
						html = await sanitizePostHtmlFragment(p.content, false);
					}
					if (html) {
						const emojiMap: Record<string, string> = {};
						const instanceEmojis = await getInstanceEmojis();
						for (const e of instanceEmojis) emojiMap[e.shortcode] = e.url;
						if (p.did) {
							try {
								const authorEmojis = await getUserEmojis(
									`/api/public/emojis/${encodeURIComponent(p.did)}`
								);
								for (const e of authorEmojis) {
									if (!(e.shortcode in emojiMap)) emojiMap[e.shortcode] = e.url;
								}
							} catch {
								/* best effort */
							}
						}
						html = renderStickersInHtml(html, emojiMap);
						html = renderEmojisInHtml(html, emojiMap);
					}
					if (gen === sanitizeGen) blogHtml = html;
				}
			} finally {
				if (gen === sanitizeGen) bodyReady = true;
			}
		})();
	});
</script>

<div class="container mx-auto max-w-4xl space-y-6 px-4 py-6 sm:py-8">
	<Button
		variant="ghost"
		size="sm"
		class="mb-4"
		onclick={() => {
			const d = data.post.did;
			if (d) {
				void goto(resolve(`/u/${encodeURIComponent(d)}`));
			} else {
				void goto(resolve('/'));
			}
		}}
	>
		<ArrowLeft class="mr-2 h-4 w-4" />
		Back to profile
	</Button>

	<Card.Root>
		<Card.Header class="space-y-2">
			<div class="flex flex-wrap items-center gap-2">
				<Card.Title class="text-2xl sm:text-3xl">
					{data.post.title || 'Untitled post'}
				</Card.Title>
				<Badge variant="outline" class="text-xs">public</Badge>
				<Badge variant="secondary" class="text-xs">
					{data.post.type === 'media' ? 'media' : data.post.content_type}
				</Badge>
			</div>
			<Card.Description class="text-sm text-muted-foreground">
				Published {formatDate(data.post.created_at)}
			</Card.Description>
			{#if data.post.did}
				<SignatureVerification
					did={data.post.did}
					signedPayloadJson={data.post.signed_payload_json}
					signatureMultibase={data.post.content_signature}
					signingPublicKeyMultibase={data.post.signing_device_public_key}
				/>
			{/if}
		</Card.Header>
		<Card.Content
			class="max-w-none {data.post.type !== 'media' && blogHtml
				? 'prose prose-slate dark:prose-invert'
				: ''}"
		>
			{#if data.post.type === 'media'}
				{#if data.post.media_urls && data.post.media_urls.length > 0}
					<MediaViewer
						mediaUrls={data.post.media_urls}
						mediaUrlMimeTypes={data.mediaUrlMimeTypes ?? {}}
						mediaUrlFilenames={data.mediaUrlFilenames ?? {}}
						defaultMode={data.post.display_mode ?? 'masonry'}
					/>
				{:else}
					<p class="text-muted-foreground">No media in this post.</p>
				{/if}
				{#if data.post.description?.trim()}
					<p class="mt-4 text-sm whitespace-pre-wrap text-muted-foreground">
						{data.post.description}
					</p>
				{/if}
			{:else if !bodyReady}
				<p class="text-sm text-muted-foreground">Loading…</p>
			{:else if blogHtml}
				<!-- eslint-disable svelte/no-at-html-tags -->
				{@html blogHtml}
				<!-- eslint-enable svelte/no-at-html-tags -->
			{:else}
				<p class="text-muted-foreground">No content.</p>
			{/if}

			{#if data.post.did && data.post.local_id}
				<div class="mt-4 border-t pt-3">
					<ReactionBar
						parentType="post"
						parentDid={data.post.did}
						parentId={data.post.local_id}
						followedDids={data.followedDids ?? []}
						currentUserDid={data.currentUserDid ?? null}
					/>
				</div>
			{/if}
		</Card.Content>
	</Card.Root>

	{#if data.post.did && data.post.local_id}
		<CommentThread
			postDid={data.post.did}
			postId={data.post.local_id}
			followedDids={data.followedDids ?? []}
			currentUserDid={data.currentUserDid ?? null}
		/>
	{/if}
</div>
