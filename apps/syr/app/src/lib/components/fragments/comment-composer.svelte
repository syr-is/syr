<script lang="ts">
	import { Button } from '@syr-is/ui/button';
	import { Textarea } from '@syr-is/ui/textarea';
	import EmojiPicker from './emoji-picker.svelte';
	import GifPicker from './gif-picker.svelte';
	import { toast } from 'svelte-sonner';
	import {
		Bold,
		Italic,
		Code,
		Link,
		List,
		Heading,
		Eye,
		Send,
		Check,
		X,
		Sticker
	} from 'lucide-svelte';
	import { getInstanceEmojis, getUserEmojis } from '$lib/stores/emoji-cache';
	import { renderEmojisInHtml, renderStickersInHtml } from '$lib/utils/emoji-renderer';

	let {
		mode = 'create',
		parentType = 'post',
		parentDid = '',
		parentId = '',
		initialContent = '',
		placeholder = 'Write a comment...',
		onSubmit,
		onCancel
	}: {
		mode?: 'create' | 'edit';
		parentType?: 'post' | 'comment';
		parentDid?: string;
		parentId?: string;
		initialContent?: string;
		placeholder?: string;
		onSubmit?: (content: string) => void;
		onCancel?: () => void;
	} = $props();

	// eslint-disable-next-line svelte/prefer-writable-derived -- content is user-editable, not a pure derivation
	let content = $state(initialContent);
	let submitting = $state(false);
	let preview = $state(false);
	let previewHtml = $state('');
	let textareaEl: HTMLTextAreaElement | null = $state(null);

	function insertAtCursor(text: string) {
		if (!textareaEl) {
			content += text;
			return;
		}
		const start = textareaEl.selectionStart;
		const end = textareaEl.selectionEnd;
		content = content.slice(0, start) + text + content.slice(end);
		requestAnimationFrame(() => {
			if (textareaEl) {
				textareaEl.selectionStart = textareaEl.selectionEnd = start + text.length;
				textareaEl.focus();
			}
		});
	}

	function wrapSelection(before: string, after: string) {
		if (!textareaEl) return;
		const start = textareaEl.selectionStart;
		const end = textareaEl.selectionEnd;
		const selected = content.slice(start, end);
		const replacement = before + (selected || 'text') + after;
		content = content.slice(0, start) + replacement + content.slice(end);
		requestAnimationFrame(() => {
			if (textareaEl) {
				if (selected) {
					textareaEl.selectionStart = start;
					textareaEl.selectionEnd = start + replacement.length;
				} else {
					textareaEl.selectionStart = start + before.length;
					textareaEl.selectionEnd = start + before.length + 4;
				}
				textareaEl.focus();
			}
		});
	}

	function handleEmoji(emoji: { shortcode: string; unicode?: boolean }) {
		if (emoji.unicode) {
			insertAtCursor(emoji.shortcode);
		} else {
			insertAtCursor(`:${emoji.shortcode}: `);
		}
	}

	function handleSticker(emoji: { shortcode: string; unicode?: boolean }) {
		if (emoji.unicode) {
			insertAtCursor(`\n<span class="unicode-sticker">${emoji.shortcode}</span>\n`);
		} else {
			insertAtCursor(`::${emoji.shortcode}:: `);
		}
	}

	function handleGif(gif: { url: string }) {
		insertAtCursor(`![GIF](${gif.url})\n`);
	}

	async function togglePreview() {
		if (!preview && content.trim()) {
			try {
				const { sanitizeMarkdownToHtml } = await import('$lib/client/sanitize-post-body');
				let html = await sanitizeMarkdownToHtml(content);

				// Build emoji map from instance + user emojis
				const instanceEmojis = await getInstanceEmojis();
				const map: Record<string, string> = {};
				for (const e of instanceEmojis) map[e.shortcode] = e.url;

				// Load user's personal emojis too
				try {
					const userEmojis = await getUserEmojis('/api/emojis?limit=100');
					for (const e of userEmojis) {
						if (!(e.shortcode in map)) map[e.shortcode] = e.url;
					}
				} catch {
					/* skip */
				}

				html = renderStickersInHtml(html, map);
				html = renderEmojisInHtml(html, map);
				previewHtml = html;
			} catch {
				previewHtml = content;
			}
		}
		preview = !preview;
	}

	async function submit() {
		if (!content.trim()) return;
		submitting = true;
		try {
			if (mode === 'create') {
				const res = await fetch('/api/comments', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						parent_type: parentType,
						parent_did: parentDid,
						parent_id: parentId,
						content: content.trim(),
						visibility: 'public',
						status: 'completed'
					})
				});
				if (!res.ok) {
					const err = await res.json().catch(() => ({}));
					toast.error(err.message ?? 'Failed to post comment');
					return;
				}
				content = '';
				preview = false;
				previewHtml = '';
			}
			onSubmit?.(content.trim());
		} catch {
			toast.error(mode === 'create' ? 'Failed to post comment' : 'Failed to save');
		} finally {
			submitting = false;
		}
	}
</script>

<div class="space-y-2 rounded-lg border p-3">
	<div class="flex flex-wrap items-center gap-0.5 border-b pb-2">
		<Button
			variant="ghost"
			size="icon-sm"
			type="button"
			onclick={() => wrapSelection('**', '**')}
			title="Bold"
		>
			<Bold class="h-3.5 w-3.5" />
		</Button>
		<Button
			variant="ghost"
			size="icon-sm"
			type="button"
			onclick={() => wrapSelection('*', '*')}
			title="Italic"
		>
			<Italic class="h-3.5 w-3.5" />
		</Button>
		<Button
			variant="ghost"
			size="icon-sm"
			type="button"
			onclick={() => wrapSelection('`', '`')}
			title="Code"
		>
			<Code class="h-3.5 w-3.5" />
		</Button>
		<Button
			variant="ghost"
			size="icon-sm"
			type="button"
			onclick={() => wrapSelection('[', '](url)')}
			title="Link"
		>
			<Link class="h-3.5 w-3.5" />
		</Button>
		<Button
			variant="ghost"
			size="icon-sm"
			type="button"
			onclick={() => insertAtCursor('\n- ')}
			title="List"
		>
			<List class="h-3.5 w-3.5" />
		</Button>
		<Button
			variant="ghost"
			size="icon-sm"
			type="button"
			onclick={() => insertAtCursor('\n## ')}
			title="Heading"
		>
			<Heading class="h-3.5 w-3.5" />
		</Button>
		<span class="mx-1 h-4 w-px bg-border"></span>
		<EmojiPicker onSelect={handleEmoji} />
		<EmojiPicker onSelect={handleSticker} triggerIcon={Sticker} triggerTitle="Sticker" />
		<GifPicker onSelect={handleGif} />
		<span class="mx-1 h-4 w-px bg-border"></span>
		<Button
			variant="ghost"
			size="icon-sm"
			type="button"
			onclick={togglePreview}
			title="Preview"
			class={preview ? 'bg-accent' : ''}
		>
			<Eye class="h-3.5 w-3.5" />
		</Button>
	</div>

	{#if preview}
		<div class="prose prose-sm dark:prose-invert min-h-[60px] rounded bg-muted/30 p-3">
			{#if previewHtml}
				<!-- eslint-disable-next-line svelte/no-at-html-tags -->
				{@html previewHtml}
			{:else}
				<p class="text-muted-foreground">Nothing to preview</p>
			{/if}
		</div>
	{:else}
		<Textarea
			bind:ref={textareaEl}
			bind:value={content}
			{placeholder}
			rows={3}
			class="min-h-[60px] resize-y border-0 p-0 shadow-none focus-visible:ring-0"
		/>
	{/if}

	<div class="flex items-center justify-end gap-1">
		{#if mode === 'edit' && onCancel}
			<Button variant="ghost" size="sm" onclick={onCancel}>
				<X class="mr-1 h-3 w-3" />
				Cancel
			</Button>
		{/if}
		<Button size="sm" onclick={submit} disabled={submitting || !content.trim()}>
			{#if submitting}
				{mode === 'create' ? 'Posting...' : 'Saving...'}
			{:else if mode === 'edit'}
				<Check class="mr-1 h-3.5 w-3.5" />
				Save
			{:else}
				<Send class="mr-1 h-3.5 w-3.5" />
				Comment
			{/if}
		</Button>
	</div>
</div>

<style>
	:global(.prose .unicode-sticker) {
		display: block;
		font-size: 3rem;
		line-height: 1;
		margin: 0.25em 0;
	}
</style>
