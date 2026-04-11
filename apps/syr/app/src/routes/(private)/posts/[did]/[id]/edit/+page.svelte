<script lang="ts">
	import * as Form from '@syr-is/ui/form';
	import * as Select from '@syr-is/ui/select';
	import * as Tooltip from '@syr-is/ui/tooltip';
	import { Input } from '@syr-is/ui/input';
	import * as Card from '@syr-is/ui/card';
	import { Textarea } from '@syr-is/ui/textarea';
	import { Label } from '@syr-is/ui/label';
	import { superForm, defaults } from 'sveltekit-superforms';
	import { zod4 } from 'sveltekit-superforms/adapters';
	import { toast } from 'svelte-sonner';
	import { goto, invalidateAll } from '$app/navigation';
	import { PostUpdateSchema, getPostId, type MediaDisplayMode } from '@syr-is/types';
	import type { SignedMutationEnvelope } from '@syr-is/types';
	import type { PostSignSnapshot } from '$lib/client/post-signed-payload';
	import PostPublishSignDialog from '$lib/components/fragments/post-publish-sign-dialog.svelte';
	import { Crepe } from '@milkdown/crepe';
	import '@milkdown/crepe/theme/common/style.css';
	import '@milkdown/crepe/theme/nord-dark.css';
	import '$lib/styles/crepe-custom.css';
	import { imageBlockConfig } from '@milkdown/components/image-block';
	import { insert as milkdownInsert } from '@milkdown/kit/utils';
	import { createPostAssetUploader, handlePostAssetUpload } from '$lib/handlers/upload';
	import { stringToRecordId } from '@syr-is/types';
	import MediaUploadZone from '$lib/components/fragments/media-upload-zone.svelte';
	import EmojiPicker from '$lib/components/fragments/emoji-picker.svelte';
	import GifPicker from '$lib/components/fragments/gif-picker.svelte';
	import InsertUploadDialog from '$lib/components/fragments/insert-upload-dialog.svelte';
	import type { Crepe as CrepeType } from '@milkdown/crepe';
	import type { PageData } from './$types';
	import {
		ArrowLeft,
		Pin,
		PinOff,
		FilePen,
		Send,
		EyeOff,
		LayoutGrid,
		GalleryHorizontal,
		Grid3x3,
		PanelTop,
		FolderOpen,
		Sticker
	} from 'lucide-svelte';
	import * as Dialog from '@syr-is/ui/dialog';
	import { Button } from '@syr-is/ui/button';
	import { Badge } from '@syr-is/ui/badge';

	let { data }: { data: PageData } = $props();

	let crepeInstance: CrepeType | null = $state(null);
	let crepeReady = $state(false);
	let insertUploadOpen = $state(false);

	function insertMarkdownIntoEditor(md: string) {
		if (crepeInstance && crepeReady) {
			try {
				crepeInstance.editor.action(milkdownInsert(md));
				$formData.content = crepeInstance.getMarkdown();
				return;
			} catch {
				/* fallback below */
			}
		}
		const current = $formData.content || '';
		const separator = current.endsWith('\n') ? '' : '\n';
		$formData.content = current + separator + md;
	}

	function handleEditorEmoji(emoji: { shortcode: string; unicode?: boolean }) {
		if (emoji.unicode) {
			insertMarkdownIntoEditor(emoji.shortcode);
		} else {
			insertMarkdownIntoEditor(`:${emoji.shortcode}: `);
		}
	}

	function handleEditorSticker(emoji: { shortcode: string; unicode?: boolean }) {
		if (emoji.unicode) {
			insertMarkdownIntoEditor(`<span class="unicode-sticker">${emoji.shortcode}</span>`);
		} else {
			insertMarkdownIntoEditor(`::${emoji.shortcode}:: `);
		}
	}

	function handleEditorGif(gif: { url: string }) {
		insertMarkdownIntoEditor(`![GIF](${gif.url})`);
	}

	function handleInsertUpload(item: { url: string; filename: string; mimeType: string }) {
		if (item.mimeType.startsWith('image/')) {
			insertMarkdownIntoEditor(`![${item.filename}](${item.url})`);
		} else if (item.mimeType.startsWith('video/')) {
			insertMarkdownIntoEditor(`<video src="${item.url}" controls></video>`);
		} else if (item.mimeType.startsWith('audio/')) {
			insertMarkdownIntoEditor(`<audio src="${item.url}" controls></audio>`);
		} else {
			insertMarkdownIntoEditor(`[${item.filename}](${item.url})`);
		}
	}

	function handleMediaInsertUpload(item: { url: string; filename: string; mimeType: string }) {
		if (!item.url) return;
		if (mediaUrls.includes(item.url)) {
			toast.info('This file is already in the media list');
			return;
		}
		mediaUrls = [...mediaUrls, item.url];
		mediaMimeTypes = { ...mediaMimeTypes, [item.url]: item.mimeType };
		$formData.media_urls = mediaUrls;
	}
	let loading = $state(false);
	let isPinned = $state(false);
	let pinLoading = $state(false);
	let publishLoading = $state(false);

	let publishSignOpen = $state(false);
	let publishSnapshot = $state<PostSignSnapshot>({
		type: 'blog',
		visibility: 'public'
	});

	// Type-switch confirmation dialog
	let typeSwitchDialogOpen = $state(false);
	let typeSwitchTarget = $state<'blog' | 'media' | null>(null);

	// Media post state — sync from server data when it changes
	let mediaUrls = $state<string[]>([]);
	let mediaMimeTypes = $state<Record<string, string>>({});
	$effect(() => {
		mediaUrls = data.post.media_urls ?? [];
		mediaMimeTypes = data.mediaUrlMimeTypes ?? {};
	});
	let uploadingCount = $state(0);
	const uploading = $derived(uploadingCount > 0);

	// Check if post is a draft
	const isDraft = $derived(data.post.status === 'draft');

	// Check if post is pinned on mount
	$effect(() => {
		checkPinStatus();
	});

	async function checkPinStatus() {
		try {
			const response = await fetch('/api/posts/pinned');
			if (response.ok) {
				const result = await response.json();
				const pinnedIds: string[] = result.data?.post_ids || [];
				isPinned = pinnedIds.includes(getPostId(data.post));
			}
		} catch {
			// Ignore errors
		}
	}

	async function handlePinToggle() {
		if (pinLoading) return;

		pinLoading = true;
		try {
			const response = await fetch('/api/posts/pinned', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					post_id: getPostId(data.post),
					action: isPinned ? 'unpin' : 'pin'
				})
			});

			if (!response.ok) {
				const errorData = await response.json();
				throw new Error(errorData.error?.message || 'Failed to toggle pin');
			}

			isPinned = !isPinned;
			toast.success(isPinned ? 'Post pinned' : 'Post unpinned');
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Failed to toggle pin');
		} finally {
			pinLoading = false;
		}
	}

	function buildPatchBody() {
		const body: Record<string, unknown> = {
			type: $formData.type,
			title: $formData.title,
			description: $formData.description,
			visibility: $formData.visibility
		};

		if ($formData.type === 'blog') {
			body.content_type = $formData.content_type;
			body.content = $formData.content;
		} else {
			body.media_urls = mediaUrls;
			body.display_mode = $formData.display_mode;
		}

		return body;
	}

	/** Open confirmation dialog before switching post type. */
	function confirmTypeSwitch(targetType: 'blog' | 'media') {
		if ($formData.type === targetType) return;
		typeSwitchTarget = targetType;
		typeSwitchDialogOpen = true;
	}

	function applyTypeSwitch() {
		if (typeSwitchTarget) {
			$formData.type = typeSwitchTarget;
			typeSwitchTarget = null;
		}
		typeSwitchDialogOpen = false;
	}

	function buildPublishSnapshot(): PostSignSnapshot {
		const v = $formData;
		const p = data.post;
		const vis = (v.visibility ?? p.visibility ?? 'public') as 'public' | 'unlisted' | 'private';
		if (v.type === 'blog') {
			return {
				type: 'blog',
				title: v.title ?? p.title,
				description: v.description ?? p.description,
				content: v.content ?? p.content ?? '',
				content_type: (v.content_type ?? p.content_type ?? 'markdown') as 'markdown' | 'html',
				visibility: vis
			};
		}
		return {
			type: 'media',
			title: v.title ?? p.title,
			description: v.description ?? p.description,
			media_urls: [...mediaUrls],
			display_mode: (v.display_mode ?? p.display_mode ?? 'masonry') as MediaDisplayMode,
			visibility: vis
		};
	}

	async function syncBeforePublish() {
		if (
			$formData.type === 'blog' &&
			$formData.content_type === 'markdown' &&
			crepeInstance &&
			crepeReady
		) {
			try {
				const markdown = crepeInstance.getMarkdown();
				$formData.content = markdown;
			} catch (error) {
				console.warn('Could not get markdown:', error);
			}
		}
		if ($formData.type === 'media') {
			$formData.media_urls = mediaUrls;
		}
	}

	async function beginPublishFlow() {
		if (publishLoading) return;
		await syncBeforePublish();
		publishSnapshot = buildPublishSnapshot();
		publishSignOpen = true;
	}

	async function runPublish(envelope?: SignedMutationEnvelope): Promise<boolean> {
		publishLoading = true;
		try {
			await syncBeforePublish();
			const response = await fetch(`/api/posts/${data.post.did}/${data.post.local_id}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					...buildPatchBody(),
					status: 'completed',
					...(envelope ? { signed_mutation: envelope } : {})
				})
			});

			if (!response.ok) {
				const errorData = await response.json();
				throw new Error(errorData.error?.message || 'Failed to publish post');
			}

			toast.success(envelope ? 'Post published and signed' : 'Post published (not signed)');
			await invalidateAll();
			// eslint-disable-next-line svelte/no-navigation-without-resolve
			goto(`/posts/${data.post.did}/${data.post.local_id}`);
			return true;
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Failed to publish post');
			return false;
		} finally {
			publishLoading = false;
		}
	}

	async function handleUnpublish() {
		if (publishLoading) return;

		// Sync markdown content before unpublishing
		if (
			$formData.type === 'blog' &&
			$formData.content_type === 'markdown' &&
			crepeInstance &&
			crepeReady
		) {
			try {
				const markdown = crepeInstance.getMarkdown();
				$formData.content = markdown;
			} catch (error) {
				console.warn('Could not get markdown:', error);
			}
		}

		// Sync media URLs
		if ($formData.type === 'media') {
			$formData.media_urls = mediaUrls;
		}

		publishLoading = true;
		try {
			const response = await fetch(`/api/posts/${data.post.did}/${data.post.local_id}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					...buildPatchBody(),
					status: 'draft'
				})
			});

			if (!response.ok) {
				const errorData = await response.json();
				throw new Error(errorData.error?.message || 'Failed to unpublish post');
			}

			toast.success('Post moved back to drafts');
			await invalidateAll();
			// eslint-disable-next-line svelte/no-navigation-without-resolve
			goto(`/posts/${data.post.did}/${data.post.local_id}`);
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Failed to unpublish post');
		} finally {
			publishLoading = false;
		}
	}

	const form = superForm(defaults(zod4(PostUpdateSchema)), {
		validators: zod4(PostUpdateSchema),
		SPA: true,
		resetForm: false,
		onUpdate: async ({ form }) => {
			if (!form.valid) return;

			// Ensure markdown content is synced before submission
			if (
				$formData.type === 'blog' &&
				$formData.content_type === 'markdown' &&
				crepeInstance &&
				crepeReady
			) {
				try {
					const markdown = crepeInstance.getMarkdown();
					$formData.content = markdown;
				} catch (error) {
					console.warn('Could not get markdown before submission:', error);
				}
			}

			// Sync media URLs
			if ($formData.type === 'media') {
				$formData.media_urls = mediaUrls;
			}

			loading = true;
			try {
				const response = await fetch(`/api/posts/${data.post.did}/${data.post.local_id}`, {
					method: 'PATCH',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify(buildPatchBody())
				});

				if (!response.ok) {
					const error = await response.json();
					toast.error(error.error?.message || 'Failed to update post');
					return;
				}

				toast.success('Post updated successfully');
				await invalidateAll();
				goHome();
			} catch (_error) {
				toast.error('An unexpected error occurred');
			} finally {
				loading = false;
			}
		}
	});

	const { form: formData, enhance } = form;

	// Initialize form and local media state from post data (re-runs when data.post changes, e.g. after invalidateAll)
	$effect(() => {
		if (data.post) {
			// Convert string id to RecordId for form (API will handle conversion on submit)
			$formData.id = stringToRecordId.decode(data.post.id);
			$formData.type = data.post.type;
			// Only set content_type for blog posts; clear it for media posts
			$formData.content_type = data.post.type === 'media' ? undefined : data.post.content_type;
			$formData.title = data.post.title || '';
			$formData.description = data.post.description || '';
			$formData.content = data.post.content || '';
			$formData.visibility = data.post.visibility;
			$formData.media_urls = data.post.media_urls;
			$formData.display_mode = data.post.display_mode;
			// Keep local media state in sync so removeMediaUrl / handleMediaFiles don't overwrite with stale data
			mediaUrls = data.post.media_urls ?? [];
			mediaMimeTypes = data.mediaUrlMimeTypes ?? {};
		}
	});

	// Helper function to get display label for visibility
	function getVisibilityLabel(value: string | undefined): string {
		if (value === 'public') return 'Public';
		if (value === 'unlisted') return 'Unlisted';
		if (value === 'private') return 'Private';
		return 'Select visibility';
	}

	// Helper function to get display label for content type
	function getContentTypeLabel(value: string | undefined): string {
		if (value === 'markdown') return 'Markdown';
		if (value === 'html') return 'HTML';
		return 'Select content type';
	}

	// Helper function to get display label for display mode
	function getDisplayModeLabel(value: string | undefined): string {
		if (value === 'carousel') return 'Carousel';
		if (value === 'masonry') return 'Masonry Grid';
		if (value === 'gallery') return 'Gallery';
		if (value === 'cards') return 'Cards';
		return 'Select display mode';
	}

	// Media upload handling (counter supports concurrent batches)
	async function handleMediaFiles(files: FileList | File[]) {
		const fileArray = Array.from(files);
		if (fileArray.length === 0) return;

		uploadingCount++;
		try {
			for (const file of fileArray) {
				try {
					const url = await handlePostAssetUpload(file, data.post.id);
					mediaUrls = [...mediaUrls, url];
					mediaMimeTypes = { ...mediaMimeTypes, [url]: file.type };
				} catch (err) {
					console.error('Failed to upload file:', file.name, err);
					toast.error(`Failed to upload ${file.name}`);
				}
			}

			$formData.media_urls = mediaUrls;
		} finally {
			uploadingCount--;
		}
	}

	function removeMediaUrl(index: number) {
		mediaUrls = mediaUrls.filter((_, i) => i !== index);
		$formData.media_urls = mediaUrls;
	}

	function mountCrepe(node: HTMLDivElement) {
		// Get content from form data (should be populated by the effect)
		const initialContent = data.post?.content || $formData.content || '';

		// Track whether the Svelte action's destroy() has already fired.
		// This prevents the async .then() callback from setting crepeInstance
		// to an already-destroyed editor when the user switches type quickly.
		let destroyed = false;

		const instance = new Crepe({
			root: node,
			defaultValue: initialContent
		});

		// Create editor and wait for it to be ready
		instance.create().then(() => {
			// If the node was already unmounted (type switched to media while
			// Crepe was initialising), tear down and bail.
			if (destroyed) {
				instance.destroy?.();
				return;
			}

			crepeInstance = instance;

			// Use post-specific uploader so images go to posts/{post_id}/public/
			instance.editor.ctx.update(imageBlockConfig.key, (defaultConfig) => ({
				...defaultConfig,
				onUpload: createPostAssetUploader(data.post.id)
			}));

			// Use Crepe's built-in markdownUpdated listener to sync with form in real-time
			instance.on((listener) => {
				listener.markdownUpdated((ctx, markdown, prevMarkdown) => {
					if (markdown !== prevMarkdown) {
						$formData.content = markdown;
					}
				});
			});

			// Wait a bit longer for editor to be fully ready before calling getMarkdown
			setTimeout(() => {
				// Guard again — destroy() may have fired during the 200ms wait
				if (destroyed) return;
				crepeReady = true;

				// Sync initial content after editor is ready
				try {
					const initialMarkdown = instance.getMarkdown();
					if (initialMarkdown) {
						$formData.content = initialMarkdown;
					}
				} catch (error) {
					// Editor might not be fully ready yet, ignore
					console.warn('Could not get initial markdown:', error);
				}
			}, 200);
		});

		return {
			destroy() {
				destroyed = true;
				instance?.destroy?.();
				crepeInstance = null;
				crepeReady = false;
			}
		};
	}

	// Watch for content_type changes and cleanup Crepe if switching to HTML
	$effect(() => {
		if ($formData.content_type === 'html' && crepeInstance) {
			crepeInstance.destroy();
			crepeInstance = null;
			crepeReady = false;
		}
	});

	// Watch for type changes and cleanup Crepe if switching to media
	$effect(() => {
		if ($formData.type === 'media' && crepeInstance) {
			crepeInstance.destroy();
			crepeInstance = null;
			crepeReady = false;
		}
	});

	// Set default display_mode and clear content_type when switching to media type,
	// restore content_type default when switching back to blog.
	// Guards prevent unconditional writes that would re-trigger the store and cause infinite loops.
	$effect(() => {
		if ($formData.type === 'media') {
			if (!$formData.display_mode) {
				$formData.display_mode = 'masonry';
			}
			if ($formData.content_type !== undefined) {
				$formData.content_type = undefined;
			}
		} else if ($formData.type === 'blog' && !$formData.content_type) {
			$formData.content_type = 'markdown';
		}
	});

	function goHome() {
		// eslint-disable-next-line svelte/no-navigation-without-resolve
		goto('/');
	}
</script>

<div class="container mx-auto flex h-full max-w-4xl flex-col px-4 py-6 sm:py-8">
	<Button
		variant="ghost"
		size="sm"
		class="mb-4 shrink-0 self-start"
		onclick={() => {
			// eslint-disable-next-line svelte/no-navigation-without-resolve
			goto(`/posts/${data.post.did}/${data.post.local_id}`);
		}}
	>
		<ArrowLeft class="mr-2 h-4 w-4" />
		Back to Post
	</Button>
	<Card.Root class="flex min-h-0 flex-1 flex-col">
		<Card.Header class="shrink-0">
			<div class="flex flex-wrap items-start justify-between gap-4">
				<div class="flex flex-wrap items-center gap-3">
					<div>
						<Card.Title>Edit Post</Card.Title>
						<Card.Description>
							{#if data.post.type === 'media'}
								Update your media post
							{:else}
								Update your blog post
							{/if}
						</Card.Description>
					</div>
					{#if isDraft}
						<Badge variant="outline" class="border-warning text-warning gap-1">
							<FilePen class="h-3 w-3" />
							Draft
						</Badge>
					{/if}
				</div>
				<div class="flex flex-wrap gap-2">
					<Tooltip.Root>
						<Tooltip.Trigger>
							{#snippet child({ props })}
								<Button
									{...props}
									variant="outline"
									size="sm"
									onclick={handlePinToggle}
									disabled={pinLoading}
									class={isPinned ? 'text-primary' : ''}
								>
									{#if isPinned}
										<PinOff class="mr-2 h-4 w-4" />
										Unpin
									{:else}
										<Pin class="mr-2 h-4 w-4" />
										Pin
									{/if}
								</Button>
							{/snippet}
						</Tooltip.Trigger>
						<Tooltip.Content>
							{isPinned ? 'Remove from pinned posts' : 'Add to pinned posts'}
						</Tooltip.Content>
					</Tooltip.Root>
				</div>
			</div>
		</Card.Header>
		<form method="POST" use:enhance class="flex min-h-0 flex-1 flex-col overflow-hidden">
			<input type="hidden" name="id" value={$formData.id} />
			<Card.Content class="min-h-0 flex-1 space-y-4 overflow-y-auto">
				<!-- Post Type: allow switching between Blog and Media when editing -->
				<Form.ElementField {form} name="type">
					{#snippet children({ value: _value, errors })}
						<Label>Post Type</Label>
						<div
							class="inline-flex rounded-lg border border-input bg-muted/30 p-0.5"
							role="group"
							aria-label="Post type"
						>
							<button
								type="button"
								class="rounded-md px-4 py-2 text-sm font-medium transition-colors {$formData.type ===
								'blog'
									? 'bg-background text-foreground shadow-xs'
									: 'text-muted-foreground hover:text-foreground'}"
								onclick={() => confirmTypeSwitch('blog')}
							>
								Blog
							</button>
							<button
								type="button"
								class="rounded-md px-4 py-2 text-sm font-medium transition-colors {$formData.type ===
								'media'
									? 'bg-background text-foreground shadow-xs'
									: 'text-muted-foreground hover:text-foreground'}"
								onclick={() => confirmTypeSwitch('media')}
							>
								Media
							</button>
						</div>
						<Form.Description>Switch post type (blog content vs media uploads)</Form.Description>
						{#if errors}
							<Form.FieldErrors />
						{/if}
					{/snippet}
				</Form.ElementField>

				<Form.Field {form} name="title">
					<Form.Control>
						{#snippet children({ props })}
							<Form.Label>Title</Form.Label>
							<Input {...props} bind:value={$formData.title} placeholder="Enter post title..." />
						{/snippet}
					</Form.Control>
					<Form.Description>Give your post a title (optional)</Form.Description>
					<Form.FieldErrors />
				</Form.Field>

				<Form.Field {form} name="description">
					<Form.Control>
						{#snippet children({ props })}
							<Form.Label>Description</Form.Label>
							<Textarea
								{...props}
								bind:value={$formData.description}
								placeholder="A short summary of your post..."
								class="resize-none"
								rows={2}
							/>
						{/snippet}
					</Form.Control>
					<Form.Description>Brief summary shown in previews (max 280 characters)</Form.Description>
					<Form.FieldErrors />
				</Form.Field>

				{#if $formData.type === 'blog'}
					<!-- Blog-specific fields -->
					<div class="grid grid-cols-2 gap-4">
						<Form.ElementField {form} name="content_type">
							{#snippet children({ value: _value, errors })}
								<Label>Content Type</Label>
								<Select.Root type="single" bind:value={$formData.content_type}>
									<Select.Trigger>
										{getContentTypeLabel($formData.content_type)}
									</Select.Trigger>
									<Select.Content>
										<Select.Item value="markdown">Markdown</Select.Item>
										<Select.Item value="html">HTML</Select.Item>
									</Select.Content>
								</Select.Root>
								<Form.Description>Format of your post content</Form.Description>
								{#if errors}
									<Form.FieldErrors />
								{/if}
							{/snippet}
						</Form.ElementField>

						<Form.ElementField {form} name="visibility">
							{#snippet children({ value: _value, errors })}
								<Label>Visibility</Label>
								<Select.Root type="single" bind:value={$formData.visibility}>
									<Select.Trigger>
										{getVisibilityLabel($formData.visibility)}
									</Select.Trigger>
									<Select.Content>
										<Select.Item value="public">Public</Select.Item>
										<Select.Item value="unlisted">Unlisted</Select.Item>
										<Select.Item value="private">Private</Select.Item>
									</Select.Content>
								</Select.Root>
								<Form.Description>Who can see this post</Form.Description>
								{#if errors}
									<Form.FieldErrors />
								{/if}
							{/snippet}
						</Form.ElementField>
					</div>

					<Form.ElementField {form} name="content">
						{#snippet children({ value: _value, errors })}
							<Label>Content</Label>
							{#if $formData.content_type === 'markdown'}
								{#key data.post?.id}
									<div
										id="post-editor"
										use:mountCrepe
										class="max-h-[400px] min-h-[250px] w-full overflow-y-auto rounded-md border border-input p-4"
									></div>
								{/key}
								<div
									class="flex flex-wrap items-center gap-0.5 rounded-md border bg-muted/30 px-2 py-1"
								>
									<Button
										variant="ghost"
										size="sm"
										type="button"
										class="h-7 gap-1.5 px-2 text-xs"
										onclick={() => (insertUploadOpen = true)}
									>
										<FolderOpen class="h-3.5 w-3.5" />
										Browse Uploads
									</Button>
									<span class="mx-0.5 h-4 w-px bg-border"></span>
									<EmojiPicker onSelect={handleEditorEmoji} />
									<EmojiPicker
										onSelect={handleEditorSticker}
										triggerIcon={Sticker}
										triggerTitle="Sticker"
									/>
									<GifPicker onSelect={handleEditorGif} />
								</div>
							{:else}
								<Textarea
									bind:value={$formData.content}
									placeholder="Write your HTML content here..."
									class="min-h-[400px] w-full font-mono text-sm"
									rows={20}
								/>
							{/if}
							<Form.Description>
								{#if $formData.content_type === 'markdown'}
									Write your post content using markdown
								{:else}
									Write your post content using HTML
								{/if}
							</Form.Description>
							{#if errors}
								<Form.FieldErrors />
							{/if}
						{/snippet}
					</Form.ElementField>
				{:else}
					<!-- Media-specific fields -->
					<div class="grid grid-cols-2 gap-4">
						<Form.ElementField {form} name="display_mode">
							{#snippet children({ value: _value, errors })}
								<Label>Default Display Mode</Label>
								<Select.Root type="single" bind:value={$formData.display_mode}>
									<Select.Trigger>
										{getDisplayModeLabel($formData.display_mode)}
									</Select.Trigger>
									<Select.Content>
										<Select.Item value="masonry">
											<span class="flex items-center gap-2">
												<LayoutGrid class="h-4 w-4" />
												Masonry Grid
											</span>
										</Select.Item>
										<Select.Item value="carousel">
											<span class="flex items-center gap-2">
												<GalleryHorizontal class="h-4 w-4" />
												Carousel
											</span>
										</Select.Item>
										<Select.Item value="gallery">
											<span class="flex items-center gap-2">
												<Grid3x3 class="h-4 w-4" />
												Gallery
											</span>
										</Select.Item>
										<Select.Item value="cards">
											<span class="flex items-center gap-2">
												<PanelTop class="h-4 w-4" />
												Cards
											</span>
										</Select.Item>
									</Select.Content>
								</Select.Root>
								<Form.Description>How viewers will see your media by default</Form.Description>
								{#if errors}
									<Form.FieldErrors />
								{/if}
							{/snippet}
						</Form.ElementField>

						<Form.ElementField {form} name="visibility">
							{#snippet children({ value: _value, errors })}
								<Label>Visibility</Label>
								<Select.Root type="single" bind:value={$formData.visibility}>
									<Select.Trigger>
										{getVisibilityLabel($formData.visibility)}
									</Select.Trigger>
									<Select.Content>
										<Select.Item value="public">Public</Select.Item>
										<Select.Item value="unlisted">Unlisted</Select.Item>
										<Select.Item value="private">Private</Select.Item>
									</Select.Content>
								</Select.Root>
								<Form.Description>Who can see this post</Form.Description>
								{#if errors}
									<Form.FieldErrors />
								{/if}
							{/snippet}
						</Form.ElementField>
					</div>

					<!-- Media Upload Area -->
					<MediaUploadZone
						{mediaUrls}
						{mediaMimeTypes}
						{uploading}
						onUpload={handleMediaFiles}
						onRemove={removeMediaUrl}
						inputId="edit-media-file-input"
					/>
					<Button
						variant="outline"
						size="sm"
						type="button"
						class="gap-1.5"
						onclick={() => (insertUploadOpen = true)}
					>
						<FolderOpen class="h-3.5 w-3.5" />
						Add from Uploads
					</Button>
				{/if}
			</Card.Content>
			<Card.Footer class="flex shrink-0 justify-end gap-2">
				<Form.Button
					type="button"
					variant="outline"
					onclick={goHome}
					disabled={loading || publishLoading || uploading}
				>
					Cancel
				</Form.Button>
				{#if !isDraft}
					<Button
						type="button"
						variant="outline"
						onclick={handleUnpublish}
						disabled={loading || publishLoading || uploading}
					>
						{#if publishLoading}
							Unpublishing...
						{:else}
							<EyeOff class="mr-2 h-4 w-4" />
							Unpublish
						{/if}
					</Button>
				{/if}
				<Form.Button type="submit" disabled={loading || publishLoading || uploading}>
					{#if loading}
						Saving...
					{:else if uploading}
						Uploading...
					{:else}
						Save Changes
					{/if}
				</Form.Button>
				{#if isDraft}
					<Button
						type="button"
						onclick={() => void beginPublishFlow()}
						disabled={loading || publishLoading || uploading}
					>
						{#if publishLoading}
							Publishing...
						{:else if uploading}
							Uploading...
						{:else}
							<Send class="mr-2 h-4 w-4" />
							Publish
						{/if}
					</Button>
				{/if}
			</Card.Footer>
		</form>
	</Card.Root>

	<!-- Type-switch confirmation dialog -->
	<Dialog.Root bind:open={typeSwitchDialogOpen}>
		<Dialog.Content class="max-w-md">
			<Dialog.Header>
				<Dialog.Title>
					{typeSwitchTarget === 'blog' ? 'Switch to Blog?' : 'Switch to Media?'}
				</Dialog.Title>
				<Dialog.Description>
					{typeSwitchTarget === 'blog'
						? 'Your media items will be unlinked from this post but will remain in your uploads library.'
						: 'Your blog content (text, markdown, or HTML) will be discarded and cannot be recovered from this form.'}
				</Dialog.Description>
			</Dialog.Header>
			<Dialog.Footer>
				<Button variant="outline" onclick={() => (typeSwitchDialogOpen = false)}>Cancel</Button>
				<Button onclick={() => applyTypeSwitch()}>
					{typeSwitchTarget === 'blog' ? 'Switch to Blog' : 'Switch to Media'}
				</Button>
			</Dialog.Footer>
		</Dialog.Content>
	</Dialog.Root>

	<PostPublishSignDialog
		bind:open={publishSignOpen}
		signMode="update"
		postLocalId={data.post.local_id}
		existingCreatedAtIso={data.post.created_at}
		snapshot={publishSnapshot}
		onSigned={(e) => runPublish(e)}
		onUnsigned={() => runPublish()}
		onDefer={() => {}}
	/>

	<InsertUploadDialog
		bind:open={insertUploadOpen}
		onInsert={$formData.type === 'media' ? handleMediaInsertUpload : handleInsertUpload}
	/>
</div>
