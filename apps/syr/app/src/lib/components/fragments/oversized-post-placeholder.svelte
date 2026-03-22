<script lang="ts">
	import * as Card from '@syr-is/ui/card';
	import { Button } from '@syr-is/ui/button';
	import { getPostId, type Post } from '@syr-is/types';
	import { goto } from '$app/navigation';

	function formatBytes(n: number): string {
		if (n < 1024) return `${n} B`;
		if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KiB`;
		return `${(n / (1024 * 1024)).toFixed(2)} MiB`;
	}

	let {
		post,
		estimatedBytes,
		limitBytes,
		onLoadAnyway,
		settingsHref = '/settings/content-trust',
		postViewPath
	}: {
		post: Post;
		estimatedBytes: number;
		limitBytes: number;
		onLoadAnyway: () => void;
		settingsHref?: string;
		/** When set (e.g. public `/p/...`), "Open post" uses this instead of `/posts/...`. */
		postViewPath?: string;
	} = $props();
</script>

<Card.Root class="border-warning/40 bg-warning/5">
	<Card.Header class="pb-2">
		<Card.Title class="text-base">{post.title || 'Untitled post'}</Card.Title>
		<Card.Description class="text-xs leading-relaxed">
			Estimated payload ({formatBytes(estimatedBytes)}) is over your browser limit ({formatBytes(
				limitBytes
			)}). Loading huge posts can slow or stress this tab. Media CDN bytes are separate.
		</Card.Description>
	</Card.Header>
	<Card.Content class="flex flex-wrap gap-2 pt-0">
		<Button type="button" size="sm" onclick={onLoadAnyway}>Load anyway</Button>
		<Button
			type="button"
			size="sm"
			variant="outline"
			onclick={() => {
				// eslint-disable-next-line svelte/no-navigation-without-resolve
				goto(settingsHref);
			}}
		>
			Content limits
		</Button>
		<Button
			type="button"
			size="sm"
			variant="ghost"
			onclick={() => {
				const path = postViewPath ?? `/posts/${getPostId(post)}`;
				// eslint-disable-next-line svelte/no-navigation-without-resolve
				goto(path);
			}}
		>
			Open post
		</Button>
	</Card.Content>
</Card.Root>
