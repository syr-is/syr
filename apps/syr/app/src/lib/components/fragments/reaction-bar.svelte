<script lang="ts">
	import EmojiPicker from './emoji-picker.svelte';
	import { toast } from 'svelte-sonner';
	import { cn } from '$lib/utils';

	type ReactionGroup = {
		kind: string;
		value: string;
		image_url?: string | null;
		count: number;
		reacted: boolean;
	};

	let {
		parentType,
		parentDid,
		parentId,
		reactions = [],
		onToggle
	}: {
		parentType: 'post' | 'comment';
		parentDid: string;
		parentId: string;
		reactions?: ReactionGroup[];
		onToggle?: () => void;
	} = $props();

	let toggling = $state<string | null>(null);

	async function toggleReaction(kind: string, value: string, imageUrl?: string | null) {
		const key = `${kind}:${value}`;
		if (toggling) return;
		toggling = key;
		try {
			const res = await fetch('/api/reactions', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					parent_type: parentType,
					parent_did: parentDid,
					parent_id: parentId,
					kind,
					value,
					...(imageUrl ? { image_url: imageUrl } : {})
				})
			});
			if (!res.ok) {
				const err = await res.json().catch(() => ({}));
				toast.error(err.message ?? 'Failed to react');
				return;
			}
			onToggle?.();
		} catch {
			toast.error('Failed to react');
		} finally {
			toggling = null;
		}
	}

	function handleEmojiReaction(emoji: { shortcode: string; url: string; is_sticker: boolean }) {
		const kind = emoji.is_sticker ? 'sticker' : 'custom_emoji';
		toggleReaction(kind, emoji.shortcode, emoji.url);
	}
</script>

<div class="flex flex-wrap items-center gap-1.5">
	{#each reactions as r (`${r.kind}:${r.value}`)}
		<button
			type="button"
			class={cn(
				'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs transition-colors hover:bg-accent',
				r.reacted && 'border-primary/50 bg-primary/10'
			)}
			disabled={toggling !== null}
			onclick={() => toggleReaction(r.kind, r.value, r.image_url)}
		>
			{#if r.kind === 'unicode'}
				<span class="text-sm">{r.value}</span>
			{:else if r.image_url}
				<img src={r.image_url} alt={r.value} class="h-4 w-4 object-contain" />
			{:else}
				<span class="text-xs">:{r.value}:</span>
			{/if}
			<span class="font-medium">{r.count}</span>
		</button>
	{/each}

	<EmojiPicker onSelect={handleEmojiReaction} />
</div>
