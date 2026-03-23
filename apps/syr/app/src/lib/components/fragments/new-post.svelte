<script lang="ts">
	import * as Dialog from '@syr-is/ui/dialog';
	import * as Form from '@syr-is/ui/form';
	import * as Select from '@syr-is/ui/select';
	import { Input } from '@syr-is/ui/input';
	import { Textarea } from '@syr-is/ui/textarea';
	import { Label } from '@syr-is/ui/label';
	import { Button } from '@syr-is/ui/button';
	import { Badge } from '@syr-is/ui/badge';
	import { superForm, defaults } from 'sveltekit-superforms';
	import { zod4 } from 'sveltekit-superforms/adapters';
	import { toast } from 'svelte-sonner';
	import { invalidateAll } from '$app/navigation';
	import { PostCreateSchema, ulid } from '@syr-is/types';
	import type { SignedMutationEnvelope } from '@syr-is/types';
	import MediaUploadZone from '$lib/components/fragments/media-upload-zone.svelte';
	import PostPublishSignDialog from '$lib/components/fragments/post-publish-sign-dialog.svelte';
	import type { PostSignSnapshot } from '$lib/client/post-signed-payload';
	import { Crepe } from '@milkdown/crepe';
	import '@milkdown/crepe/theme/common/style.css';
	import '@milkdown/crepe/theme/nord-dark.css';
	import '$lib/styles/crepe-custom.css';
	import { imageBlockConfig } from '@milkdown/components/image-block';
	import { createPostAssetUploader, handlePostAssetUpload } from '$lib/handlers/upload';
	import type { Crepe as CrepeType } from '@milkdown/crepe';
	import {
		FilePen,
		Send,
		X,
		LayoutGrid,
		GalleryHorizontal,
		Grid3x3,
		PanelTop
	} from 'lucide-svelte';

	interface Props {
		onDraftCreated?: () => void;
		onDraftDeleted?: () => void;
	}

	let { onDraftCreated, onDraftDeleted }: Props = $props();

	let crepeInstance: CrepeType | null = $state(null);
	let crepeReady = $state(false);
	let dialogOpen = $state(false);
	let loading = $state(false);
	let draftPostId = $state<string | null>(null);
	let draftDid = $state<string | null>(null);
	let draftLocalId = $state<string | null>(null);
	let draftCreatedAtIso = $state<string | null>(null);

	let publishSignOpen = $state(false);
	let signMode = $state<'create' | 'update'>('create');
	let signPostLocalId = $state('');
	let signExistingCreatedAtIso = $state<string | null>(null);
	let publishSnapshot = $state<PostSignSnapshot>({
		type: 'blog',
		visibility: 'public'
	});

	// Media post state
	let mediaUrls = $state<string[]>([]);
	let mediaMimeTypes = $state<Record<string, string>>({});
	let uploadingCount = $state(0);
	const uploading = $derived(uploadingCount > 0);

	// Mutex for createDraft – prevents concurrent calls from creating duplicate drafts
	let draftCreatePromise: Promise<string | null> | null = null;

	const form = superForm(defaults(zod4(PostCreateSchema)), {
		validators: zod4(PostCreateSchema),
		SPA: true,
		resetForm: false
	});

	const { form: formData, enhance } = form;

	// Initialize form with default values
	$formData.type = 'blog';
	$formData.content_type = 'markdown';
	$formData.title = '';
	$formData.description = '';
	$formData.content = '';
	$formData.visibility = 'public';
	$formData.status = 'draft';

	function resetForm() {
		$formData.type = 'blog';
		$formData.content_type = 'markdown';
		$formData.title = '';
		$formData.description = '';
		$formData.content = '';
		$formData.media_urls = undefined;
		$formData.display_mode = undefined;
		$formData.visibility = 'public';
		$formData.status = 'draft';
		mediaUrls = [];
		mediaMimeTypes = {};
		draftPostId = null;
		draftDid = null;
		draftLocalId = null;
		draftCreatedAtIso = null;
		draftCreatePromise = null;
	}

	async function syncFormForPublish() {
		if (
			$formData.type === 'blog' &&
			$formData.content_type === 'markdown' &&
			crepeInstance &&
			crepeReady
		) {
			try {
				$formData.content = crepeInstance.getMarkdown();
			} catch (error) {
				console.warn('Could not get markdown before submission:', error);
			}
		}
		if ($formData.type === 'media') {
			$formData.media_urls = mediaUrls;
		}
		if (draftCreatePromise) {
			await draftCreatePromise;
		}
	}

	function buildPublishSnapshot(): PostSignSnapshot {
		const v = $formData;
		const vis = (v.visibility ?? 'public') as 'public' | 'unlisted' | 'private';
		if (v.type === 'blog') {
			return {
				type: 'blog',
				title: v.title,
				description: v.description,
				content: v.content,
				content_type: v.content_type,
				visibility: vis
			};
		}
		return {
			type: 'media',
			title: v.title,
			description: v.description,
			media_urls: [...mediaUrls],
			display_mode: v.display_mode,
			visibility: vis
		};
	}

	async function beginPublishFlow() {
		if (loading || uploading) return;
		await syncFormForPublish();

		const parseInput = {
			...$formData,
			status: 'completed' as const,
			media_urls: $formData.type === 'media' ? mediaUrls : $formData.media_urls
		};
		const parsed = PostCreateSchema.safeParse(parseInput);
		if (!parsed.success) {
			toast.error('Please fix validation errors before publishing');
			return;
		}

		const hasDraft = !!draftDid && !!draftLocalId;
		let createdIso = draftCreatedAtIso;
		if (hasDraft && !createdIso) {
			try {
				const r = await fetch(`/api/posts/${draftDid}/${draftLocalId}`);
				const j = await r.json();
				if (r.ok && j.data?.created_at != null) {
					createdIso = new Date(j.data.created_at).toISOString();
					draftCreatedAtIso = createdIso;
				}
			} catch {
				// continue; dialog may still error if update signing needs created_at
			}
		}

		if (hasDraft) {
			signMode = 'update';
			signPostLocalId = draftLocalId!;
			signExistingCreatedAtIso = createdIso;
		} else {
			signMode = 'create';
			signPostLocalId = ulid();
			signExistingCreatedAtIso = null;
		}
		publishSnapshot = buildPublishSnapshot();
		publishSignOpen = true;
	}

	async function runPublish(envelope?: SignedMutationEnvelope): Promise<boolean> {
		loading = true;
		try {
			await syncFormForPublish();
			const hasDraft = !!draftDid && !!draftLocalId;
			const method = hasDraft ? 'PATCH' : 'POST';
			const endpoint = hasDraft ? `/api/posts/${draftDid}/${draftLocalId}` : '/api/posts';

			const postIdFromSign = envelope
				? String((envelope.payload as { post_id?: string }).post_id ?? '')
				: '';

			const body: Record<string, unknown> = {
				...$formData,
				status: 'completed'
			};
			if ($formData.type === 'media') {
				body.media_urls = mediaUrls;
			}
			if (envelope) {
				body.signed_mutation = envelope;
				if (!hasDraft && postIdFromSign) {
					body.post_local_id = postIdFromSign;
				}
			}

			const response = await fetch(endpoint, {
				method,
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(body)
			});

			if (!response.ok) {
				const errBody = await response.json().catch(() => ({}));
				toast.error(errBody.error?.message || 'Failed to publish post');
				return false;
			}

			toast.success(envelope ? 'Post published and signed' : 'Post published (not signed)');
			resetForm();
			dialogOpen = false;
			await invalidateAll();
			return true;
		} catch (_error) {
			toast.error('An unexpected error occurred');
			return false;
		} finally {
			loading = false;
		}
	}

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

	// Create draft post to get an ID for asset uploads.
	// Uses draftCreatePromise as a mutex so concurrent callers share a single request.
	async function createDraft(): Promise<string | null> {
		if (!dialogOpen) return null;
		if (draftPostId) return draftPostId;
		if (draftCreatePromise) return draftCreatePromise;

		draftCreatePromise = (async () => {
			try {
				const draftBody: Record<string, unknown> = {
					type: $formData.type,
					title: $formData.title || 'Untitled Draft',
					description: $formData.description,
					visibility: $formData.visibility,
					status: 'draft'
				};

				if ($formData.type === 'blog') {
					draftBody.content_type = $formData.content_type;
					draftBody.content = $formData.content;
				} else {
					draftBody.media_urls = mediaUrls;
					draftBody.display_mode = $formData.display_mode || 'masonry';
				}

				const response = await fetch('/api/posts', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify(draftBody)
				});

				if (!response.ok) {
					console.error('Failed to create draft');
					return null;
				}

				const result = await response.json();
				if (result.data?.did && result.data?.local_id) {
					if (dialogOpen) {
						draftDid = result.data.did;
						draftLocalId = result.data.local_id;
						draftPostId = `${draftDid}/${draftLocalId}`;
						if (result.data.created_at != null) {
							draftCreatedAtIso = new Date(result.data.created_at).toISOString();
						}
						onDraftCreated?.();
						return draftPostId;
					}
					// Dialog was closed during request - cleanup orphaned draft on server
					fetch(`/api/posts/${result.data.did}/${result.data.local_id}`, {
						method: 'DELETE'
					}).catch(() => {});
				}
			} catch (error) {
				console.error('Error creating draft:', error);
			}
			return null;
		})();

		try {
			return await draftCreatePromise;
		} finally {
			draftCreatePromise = null;
		}
	}

	// Save draft without closing
	async function saveDraft() {
		// Sync markdown content
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

		// Wait for any in-flight draft creation to finish
		if (draftCreatePromise) {
			await draftCreatePromise;
		}

		loading = true;
		try {
			if (draftDid && draftLocalId) {
				// Update existing draft
				const response = await fetch(`/api/posts/${draftDid}/${draftLocalId}`, {
					method: 'PATCH',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						...$formData,
						status: 'draft'
					})
				});

				if (!response.ok) {
					throw new Error('Failed to save draft');
				}
			} else {
				// Create new draft
				await createDraft();
			}
			toast.success('Draft saved');
			// Refresh page data to show updated draft in lists
			await invalidateAll();
		} catch (_error) {
			toast.error('Failed to save draft');
		} finally {
			loading = false;
		}
	}

	// Cancel and delete draft
	async function cancelAndDelete() {
		// Wait for any in-flight draft creation so we know the ID to delete
		if (draftCreatePromise) {
			await draftCreatePromise;
		}

		loading = true;
		try {
			if (draftDid && draftLocalId) {
				const response = await fetch(`/api/posts/${draftDid}/${draftLocalId}`, {
					method: 'DELETE'
				});

				if (!response.ok) {
					const error = await response.json();
					toast.error(error.error?.message || 'Failed to delete draft');
					return;
				}

				toast.success('Draft discarded');
				// Notify parent that the draft was deleted so it can refresh the UI
				onDraftDeleted?.();
			}
			resetForm();
			dialogOpen = false;
		} catch (_error) {
			toast.error('Failed to delete draft');
		} finally {
			loading = false;
		}
	}

	// Media upload handling (counter supports concurrent batches).
	// Guards against dialog close / form reset during async uploads to prevent
	// stale URLs from a previous session leaking into the current state.
	async function handleMediaFiles(files: FileList | File[]) {
		const fileArray = Array.from(files);
		if (fileArray.length === 0) return;

		uploadingCount++;
		try {
			// Ensure we have a draft for asset uploads
			const postId = await createDraft();
			if (!postId) {
				toast.error('Failed to create draft for uploads');
				return;
			}

			// Capture the draft this upload session belongs to
			const sessionDraftId = draftPostId;

			for (const file of fileArray) {
				// Bail if dialog closed or form was reset during upload
				if (!dialogOpen || draftPostId !== sessionDraftId) return;

				try {
					const url = await handlePostAssetUpload(file, postId);
					// Re-check after async upload completes
					if (!dialogOpen || draftPostId !== sessionDraftId) return;
					mediaUrls = [...mediaUrls, url];
					mediaMimeTypes = { ...mediaMimeTypes, [url]: file.type };
				} catch (err) {
					console.error('Failed to upload file:', file.name, err);
					toast.error(`Failed to upload ${file.name}`);
				}
			}

			// Only sync if still in the same session
			if (dialogOpen && draftPostId === sessionDraftId) {
				$formData.media_urls = mediaUrls;
			}
		} finally {
			uploadingCount--;
		}
	}

	function removeMediaUrl(index: number) {
		mediaUrls = mediaUrls.filter((_, i) => i !== index);
		$formData.media_urls = mediaUrls;
	}

	function mountCrepe(node: HTMLDivElement) {
		// Don't initialise the editor if the dialog is already closing/closed
		// (can happen when resetForm resets type/content_type while exit animation runs)
		if (!dialogOpen) {
			return { destroy() {} };
		}

		// Track whether the Svelte action's destroy() has already fired (e.g. user
		// switched to media type before Crepe finished). Prevents .then() / setTimeout
		// from setting crepeInstance to a destroyed editor.
		let destroyed = false;

		const instance = new Crepe({
			root: node,
			defaultValue: $formData.content || ''
		});

		// Create editor and wait for it to be ready
		instance.create().then(async () => {
			// DOM was removed (type switched to media or content_type to HTML) — tear down and bail
			if (destroyed) {
				instance.destroy?.();
				return;
			}
			// Dialog may have closed while Crepe was initialising — tear down and bail
			if (!dialogOpen) {
				instance.destroy?.();
				return;
			}

			crepeInstance = instance;

			// Create a draft to get post ID for image uploads
			const postId = await createDraft();

			if (destroyed) return;

			// Configure image upload handler
			if (postId) {
				instance.editor.ctx.update(imageBlockConfig.key, (defaultConfig) => ({
					...defaultConfig,
					onUpload: createPostAssetUploader(postId)
				}));
			} else {
				// Fallback to regular upload handler (shouldn't happen)
				const { handleFileUpload } = await import('$lib/handlers/upload');
				instance.editor.ctx.update(imageBlockConfig.key, (defaultConfig) => ({
					...defaultConfig,
					onUpload: handleFileUpload
				}));
			}

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

	// Cleanup draft if dialog is closed without publishing (e.g. Escape, click outside)
	$effect(() => {
		if (!dialogOpen && draftPostId) {
			cancelAndDelete();
		}
	});
</script>

<Dialog.Root bind:open={dialogOpen}>
	<Dialog.Trigger
		class="inline-flex h-9 items-center justify-center rounded-md border border-input bg-transparent px-4 py-2 text-sm font-medium whitespace-nowrap shadow-xs ring-offset-background transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50"
	>
		+ New Post
	</Dialog.Trigger>
	<Dialog.Content class="flex max-h-[90vh] max-w-[95vw] flex-col sm:max-w-3xl">
		<Dialog.Header class="shrink-0">
			<div class="flex items-center justify-between">
				<div>
					<Dialog.Title>New Post</Dialog.Title>
					<Dialog.Description>
						{#if $formData.type === 'media'}
							Create a new media post
						{:else}
							Create a new blog post
						{/if}
					</Dialog.Description>
				</div>
				{#if draftPostId}
					<Badge variant="secondary" class="gap-1">
						<FilePen class="h-3 w-3" />
						Draft saved
					</Badge>
				{/if}
			</div>
		</Dialog.Header>
		<form
			method="POST"
			use:enhance
			onsubmit={(e) => e.preventDefault()}
			class="flex min-h-0 flex-1 flex-col overflow-hidden"
		>
			<!-- Hidden fields -->
			<input type="hidden" name="status" value={$formData.status} />
			<div class="min-h-0 flex-1 space-y-4 overflow-y-auto pr-2">
				<!-- Post Type: prominent so users can switch to Media -->
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
								onclick={() => ($formData.type = 'blog')}
							>
								Blog
							</button>
							<button
								type="button"
								class="rounded-md px-4 py-2 text-sm font-medium transition-colors {$formData.type ===
								'media'
									? 'bg-background text-foreground shadow-xs'
									: 'text-muted-foreground hover:text-foreground'}"
								onclick={() => ($formData.type = 'media')}
							>
								Media
							</button>
						</div>
						<Form.Description>Choose the type of post you want to create</Form.Description>
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
					<div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
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
								<div
									id="post-editor"
									use:mountCrepe
									class="max-h-[400px] min-h-[200px] w-full overflow-y-auto rounded-md border border-input p-4 sm:min-h-[300px]"
								></div>
								<p class="text-xs text-muted-foreground">
									Images uploaded here are stored publicly for embedding in your post.
								</p>
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
					<div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
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
						inputId="media-file-input"
					/>
				{/if}
			</div>
			<Dialog.Footer class="mt-6 shrink-0 gap-2">
				<Button
					type="button"
					variant="ghost"
					onclick={cancelAndDelete}
					disabled={loading || uploading}
				>
					<X class="mr-2 h-4 w-4" />
					Cancel
				</Button>
				<Button type="button" variant="outline" onclick={saveDraft} disabled={loading || uploading}>
					<FilePen class="mr-2 h-4 w-4" />
					Save Draft
				</Button>
				<Button
					type="button"
					disabled={loading || uploading}
					class="w-full sm:w-auto"
					onclick={() => void beginPublishFlow()}
				>
					{#if loading}
						Publishing...
					{:else if uploading}
						Uploading...
					{:else}
						<Send class="mr-2 h-4 w-4" />
						Publish
					{/if}
				</Button>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>

<PostPublishSignDialog
	bind:open={publishSignOpen}
	{signMode}
	postLocalId={signPostLocalId}
	existingCreatedAtIso={signExistingCreatedAtIso}
	snapshot={publishSnapshot}
	onSigned={(e) => runPublish(e)}
	onUnsigned={() => runPublish()}
	onDefer={() => {}}
/>
