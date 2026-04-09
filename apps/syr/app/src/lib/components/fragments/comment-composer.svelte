<script lang="ts">
	import { Button } from '@syr-is/ui/button';
	import { Textarea } from '@syr-is/ui/textarea';
	import EmojiPicker from './emoji-picker.svelte';
	import GifPicker from './gif-picker.svelte';
	import { toast } from 'svelte-sonner';
	import { Bold, Italic, Code, Link, List, Heading, Eye, Send } from 'lucide-svelte';

	let {
		parentType,
		parentDid,
		parentId,
		placeholder = 'Write a comment...',
		onSubmit
	}: {
		parentType: 'post' | 'comment';
		parentDid: string;
		parentId: string;
		placeholder?: string;
		onSubmit?: () => void;
	} = $props();

	let content = $state('');
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

	function handleEmoji(emoji: { shortcode: string }) {
		insertAtCursor(`:${emoji.shortcode}: `);
	}

	function handleGif(gif: { url: string }) {
		insertAtCursor(`![GIF](${gif.url})\n`);
	}

	async function togglePreview() {
		if (!preview && content.trim()) {
			try {
				const { sanitizeMarkdownToHtml } = await import('$lib/client/sanitize-post-body');
				previewHtml = await sanitizeMarkdownToHtml(content);
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
			onSubmit?.();
		} catch {
			toast.error('Failed to post comment');
		} finally {
			submitting = false;
		}
	}
</script>

<div class="space-y-2 rounded-lg border p-3">
	<!-- Toolbar -->
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

	<!-- Content area -->
	{#if preview}
		<div class="prose prose-sm dark:prose-invert min-h-[80px] rounded bg-muted/30 p-3">
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
			class="min-h-[80px] resize-y border-0 p-0 shadow-none focus-visible:ring-0"
		/>
	{/if}

	<!-- Submit -->
	<div class="flex justify-end">
		<Button size="sm" onclick={submit} disabled={submitting || !content.trim()}>
			{#if submitting}
				Posting...
			{:else}
				<Send class="mr-1 h-3.5 w-3.5" />
				Comment
			{/if}
		</Button>
	</div>
</div>
