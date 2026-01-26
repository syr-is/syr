<script lang="ts">
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import * as Form from '$lib/components/ui/form';
	import * as Select from '$lib/components/ui/select';
	import { Input } from '$lib/components/ui/input';
	import { Textarea } from '$lib/components/ui/textarea';
	import { Label } from '$lib/components/ui/label';
	import { Button } from '$lib/components/ui/button';
	import { Badge } from '$lib/components/ui/badge';
	import { superForm, defaults } from 'sveltekit-superforms';
	import { zod4 } from 'sveltekit-superforms/adapters';
	import { toast } from 'svelte-sonner';
	import { invalidateAll } from '$app/navigation';
	import { PostCreateSchema } from '@syr-is/types';
	import { Crepe } from '@milkdown/crepe';
	import '@milkdown/crepe/theme/common/style.css';
	import '@milkdown/crepe/theme/nord-dark.css';
	import '$lib/styles/crepe-custom.css';
	import { imageBlockConfig } from '@milkdown/components/image-block';
	import { createPostAssetUploader } from '$lib/handlers/upload';
	import type { Crepe as CrepeType } from '@milkdown/crepe';
	import { FilePen, Send, X } from 'lucide-svelte';

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

	const form = superForm(defaults(zod4(PostCreateSchema)), {
		validators: zod4(PostCreateSchema),
		SPA: true,
		resetForm: true,
		onUpdate: async ({ form }) => {
			if (!form.valid) return;

			// Ensure markdown content is synced before submission
			if ($formData.content_type === 'markdown' && crepeInstance && crepeReady) {
				try {
					const markdown = crepeInstance.getMarkdown();
					$formData.content = markdown;
				} catch (error) {
					console.warn('Could not get markdown before submission:', error);
				}
			}

			loading = true;
			try {
				// If we have a draft, update it; otherwise create new
				const method = draftPostId ? 'PATCH' : 'POST';
				const endpoint = draftPostId ? `/api/posts/${draftPostId}` : '/api/posts';

				const response = await fetch(endpoint, {
					method,
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						...form.data,
						status: 'completed' // Mark as completed when publishing
					})
				});

				if (!response.ok) {
					const error = await response.json();
					toast.error(error.error?.message || 'Failed to create post');
					return;
				}

				toast.success('Post published successfully');
				resetForm();
				dialogOpen = false;
				await invalidateAll();
			} catch (_error) {
				toast.error('An unexpected error occurred');
			} finally {
				loading = false;
			}
		}
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
		$formData.visibility = 'public';
		$formData.status = 'draft';
		draftPostId = null;
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

	// Create draft post to get an ID for asset uploads
	async function createDraft(): Promise<string | null> {
		if (draftPostId) return draftPostId;

		try {
			const response = await fetch('/api/posts', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					type: 'blog',
					content_type: $formData.content_type,
					title: $formData.title || 'Untitled Draft',
					description: $formData.description,
					content: $formData.content,
					visibility: $formData.visibility,
					status: 'draft'
				})
			});

			if (!response.ok) {
				console.error('Failed to create draft');
				return null;
			}

			const result = await response.json();
			const postId = result.data?.id;
			if (postId) {
				draftPostId = typeof postId === 'string' ? postId : postId.toString();
				// Notify parent that a draft was created so it can refresh the UI
				onDraftCreated?.();
				return draftPostId;
			}
		} catch (error) {
			console.error('Error creating draft:', error);
		}
		return null;
	}

	// Save draft without closing
	async function saveDraft() {
		// Sync markdown content
		if ($formData.content_type === 'markdown' && crepeInstance && crepeReady) {
			try {
				const markdown = crepeInstance.getMarkdown();
				$formData.content = markdown;
			} catch (error) {
				console.warn('Could not get markdown:', error);
			}
		}

		loading = true;
		try {
			if (draftPostId) {
				// Update existing draft
				const response = await fetch(`/api/posts/${draftPostId}`, {
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
		loading = true;
		try {
			if (draftPostId) {
				const response = await fetch(`/api/posts/${draftPostId}`, {
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

	function mountCrepe(node: HTMLDivElement) {
		const instance = new Crepe({
			root: node,
			defaultValue: $formData.content || ''
		});

		// Create editor and wait for it to be ready
		instance.create().then(async () => {
			crepeInstance = instance;

			// Create a draft to get post ID for image uploads
			const postId = await createDraft();

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

	// Cleanup draft if dialog is closed without publishing
	$effect(() => {
		if (!dialogOpen && draftPostId) {
			// Optionally delete the draft or leave it for later
			// For now, we'll leave drafts in the database
			draftPostId = null;
			resetForm();
		}
	});
</script>

<Dialog.Root bind:open={dialogOpen}>
	<Dialog.Trigger
		class="inline-flex h-9 items-center justify-center rounded-md border border-input bg-transparent px-4 py-2 text-sm font-medium whitespace-nowrap shadow-xs ring-offset-background transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50"
	>
		+ New Post
	</Dialog.Trigger>
	<Dialog.Content class="flex max-h-[90vh] max-w-3xl flex-col">
		<Dialog.Header class="shrink-0">
			<div class="flex items-center justify-between">
				<div>
					<Dialog.Title>New Post</Dialog.Title>
					<Dialog.Description>Create a new blog post</Dialog.Description>
				</div>
				{#if draftPostId}
					<Badge variant="secondary" class="gap-1">
						<FilePen class="h-3 w-3" />
						Draft saved
					</Badge>
				{/if}
			</div>
		</Dialog.Header>
		<form method="POST" use:enhance class="flex min-h-0 flex-1 flex-col overflow-hidden">
			<!-- Hidden field for type -->
			<input type="hidden" name="type" value={$formData.type} />
			<input type="hidden" name="status" value={$formData.status} />
			<div class="min-h-0 flex-1 space-y-4 overflow-y-auto pr-2">
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
							<div
								id="post-editor"
								use:mountCrepe
								class="max-h-[400px] min-h-[300px] w-full overflow-y-auto rounded-md border border-input p-4"
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
			</div>
			<Dialog.Footer class="mt-6 shrink-0 gap-2">
				<Button type="button" variant="ghost" onclick={cancelAndDelete} disabled={loading}>
					<X class="mr-2 h-4 w-4" />
					Cancel
				</Button>
				<Button type="button" variant="outline" onclick={saveDraft} disabled={loading}>
					<FilePen class="mr-2 h-4 w-4" />
					Save Draft
				</Button>
				<Form.Button type="submit" disabled={loading} class="w-full sm:w-auto">
					{#if loading}
						Publishing...
					{:else}
						<Send class="mr-2 h-4 w-4" />
						Publish
					{/if}
				</Form.Button>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>
