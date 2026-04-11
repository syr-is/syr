<script lang="ts">
	import * as Dialog from '@syr-is/ui/dialog';
	import { Button } from '@syr-is/ui/button';
	import { Input } from '@syr-is/ui/input';
	import { toast } from 'svelte-sonner';
	import { Loader2 } from 'lucide-svelte';

	let {
		open = $bindable(false),
		imageUrl = null,
		mimeType = null,
		fileSize = 0,
		isSticker = false,
		scope = 'user',
		onSuccess
	}: {
		open?: boolean;
		imageUrl?: string | null;
		mimeType?: string | null;
		fileSize?: number;
		isSticker?: boolean;
		/** 'user' uses /api/emojis, 'instance' uses /api/admin/emojis */
		scope?: 'user' | 'instance';
		onSuccess?: () => void;
	} = $props();

	let shortcode = $state('');
	let saving = $state(false);

	$effect(() => {
		if (!open) shortcode = '';
	});

	async function handleSave() {
		if (!shortcode.trim() || !imageUrl) return;
		saving = true;
		try {
			const endpoint = scope === 'instance' ? '/api/admin/emojis' : '/api/emojis';
			const res = await fetch(endpoint, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					shortcode: shortcode.trim().toLowerCase(),
					url: imageUrl,
					is_sticker: isSticker,
					scope,
					mime_type: mimeType ?? 'image/png',
					size: fileSize
				})
			});
			if (!res.ok) {
				const err = await res.json().catch(() => ({}));
				throw new Error(err.message ?? `Failed to add as ${isSticker ? 'sticker' : 'emoji'}`);
			}
			toast.success(
				`Added as ${isSticker ? 'sticker' : 'emoji'} :${shortcode.trim().toLowerCase()}:`
			);
			open = false;
			onSuccess?.();
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Failed to save');
		} finally {
			saving = false;
		}
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="max-w-sm">
		<Dialog.Header>
			<Dialog.Title>Add as {isSticker ? 'Sticker' : 'Emoji'}</Dialog.Title>
			<Dialog.Description>
				Choose a shortcode for this {isSticker ? 'sticker' : 'emoji'}. Use it in comments as
				<code class="text-xs">{isSticker ? '::shortcode::' : ':shortcode:'}</code>.
			</Dialog.Description>
		</Dialog.Header>
		<div class="space-y-3 py-2">
			{#if imageUrl}
				<div class="flex justify-center">
					<img src={imageUrl} alt="Preview" class="h-16 w-16 rounded object-contain" />
				</div>
			{/if}
			<div class="space-y-1">
				<label for="emoji-shortcode-input" class="text-sm font-medium">Shortcode</label>
				<Input
					id="emoji-shortcode-input"
					bind:value={shortcode}
					placeholder="my_emoji"
					class="font-mono"
				/>
				<p class="text-xs text-muted-foreground">Alphanumeric and underscores only</p>
			</div>
		</div>
		<Dialog.Footer>
			<Button variant="outline" onclick={() => (open = false)} disabled={saving}>Cancel</Button>
			<Button onclick={handleSave} disabled={saving || !shortcode.trim()}>
				{#if saving}
					<Loader2 class="mr-2 h-4 w-4 animate-spin" />
					Saving...
				{:else}
					Add {isSticker ? 'Sticker' : 'Emoji'}
				{/if}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
