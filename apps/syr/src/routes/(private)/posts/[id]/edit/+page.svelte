<script lang="ts">
	import * as Form from '$lib/components/ui/form';
	import * as Select from '$lib/components/ui/select';
	import * as Tooltip from '$lib/components/ui/tooltip';
	import { Input } from '$lib/components/ui/input';
	import * as Card from '$lib/components/ui/card';
	import { Textarea } from '$lib/components/ui/textarea';
	import { Label } from '$lib/components/ui/label';
	import { superForm, defaults } from 'sveltekit-superforms';
	import { zod4 } from 'sveltekit-superforms/adapters';
	import { toast } from 'svelte-sonner';
	import { goto, invalidateAll } from '$app/navigation';
	import { PostUpdateSchema } from '@syr-is/types';
	import { Crepe } from '@milkdown/crepe';
	import '@milkdown/crepe/theme/common/style.css';
	import '@milkdown/crepe/theme/nord-dark.css';
	import '$lib/styles/crepe-custom.css';
	import { imageBlockConfig } from '@milkdown/components/image-block';
	import { createPostAssetUploader } from '$lib/handlers/upload';
	import { stringToRecordId } from '@syr-is/types';
	import type { Crepe as CrepeType } from '@milkdown/crepe';
	import type { PageData } from './$types';
	import { ArrowLeft, Pin, PinOff, FilePen, Send, EyeOff } from 'lucide-svelte';
	import { Button } from '$lib/components/ui/button';
	import { Badge } from '$lib/components/ui/badge';

	let { data }: { data: PageData } = $props();

	let crepeInstance: CrepeType | null = $state(null);
	let crepeReady = $state(false);
	let loading = $state(false);
	let isPinned = $state(false);
	let pinLoading = $state(false);
	let publishLoading = $state(false);

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
				isPinned = pinnedIds.includes(data.post.id);
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
					post_id: data.post.id,
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

	async function handlePublish() {
		if (publishLoading) return;

		// Sync markdown content before publishing
		if ($formData.content_type === 'markdown' && crepeInstance && crepeReady) {
			try {
				const markdown = crepeInstance.getMarkdown();
				$formData.content = markdown;
			} catch (error) {
				console.warn('Could not get markdown:', error);
			}
		}

		publishLoading = true;
		try {
			const response = await fetch(`/api/posts/${data.post.id}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					type: $formData.type,
					content_type: $formData.content_type,
					title: $formData.title,
					description: $formData.description,
					content: $formData.content,
					visibility: $formData.visibility,
					status: 'completed'
				})
			});

			if (!response.ok) {
				const errorData = await response.json();
				throw new Error(errorData.error?.message || 'Failed to publish post');
			}

			toast.success('Post published successfully!');
			await invalidateAll();
			// eslint-disable-next-line svelte/no-navigation-without-resolve
			goto(`/posts/${data.post.id}`);
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Failed to publish post');
		} finally {
			publishLoading = false;
		}
	}

	async function handleUnpublish() {
		if (publishLoading) return;

		// Sync markdown content before unpublishing
		if ($formData.content_type === 'markdown' && crepeInstance && crepeReady) {
			try {
				const markdown = crepeInstance.getMarkdown();
				$formData.content = markdown;
			} catch (error) {
				console.warn('Could not get markdown:', error);
			}
		}

		publishLoading = true;
		try {
			const response = await fetch(`/api/posts/${data.post.id}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					type: $formData.type,
					content_type: $formData.content_type,
					title: $formData.title,
					description: $formData.description,
					content: $formData.content,
					visibility: $formData.visibility,
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
			goto(`/posts/${data.post.id}`);
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
				const response = await fetch('/api/posts', {
					method: 'PATCH',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify(form.data)
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

	// Initialize form with post data
	$effect(() => {
		if (data.post) {
			// Convert string id to RecordId for form (API will handle conversion on submit)
			$formData.id = stringToRecordId.decode(data.post.id);
			$formData.type = data.post.type;
			$formData.content_type = data.post.content_type;
			$formData.title = data.post.title || '';
			$formData.description = data.post.description || '';
			$formData.content = data.post.content || '';
			$formData.visibility = data.post.visibility;
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

	function mountCrepe(node: HTMLDivElement) {
		// Get content from form data (should be populated by the effect)
		const initialContent = data.post?.content || $formData.content || '';

		const instance = new Crepe({
			root: node,
			defaultValue: initialContent
		});

		// Create editor and wait for it to be ready
		instance.create().then(() => {
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

	function goHome() {
		// eslint-disable-next-line svelte/no-navigation-without-resolve
		goto('/');
	}
</script>

<div class="container mx-auto flex h-full max-w-4xl flex-col px-4 py-8">
	<Button
		variant="ghost"
		size="sm"
		class="mb-4 shrink-0 self-start"
		onclick={() => {
			// eslint-disable-next-line svelte/no-navigation-without-resolve
			goto(`/posts/${data.post.id}`);
		}}
	>
		<ArrowLeft class="mr-2 h-4 w-4" />
		Back to Post
	</Button>
	<Card.Root class="flex min-h-0 flex-1 flex-col">
		<Card.Header class="shrink-0">
			<div class="flex items-start justify-between">
				<div class="flex items-center gap-3">
					<div>
						<Card.Title>Edit Post</Card.Title>
						<Card.Description>Update your blog post</Card.Description>
					</div>
					{#if isDraft}
						<Badge variant="outline" class="border-warning text-warning gap-1">
							<FilePen class="h-3 w-3" />
							Draft
						</Badge>
					{/if}
				</div>
				<div class="flex gap-2">
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
			<!-- Hidden field for id and type -->
			<input type="hidden" name="id" value={$formData.id} />
			<input type="hidden" name="type" value={$formData.type} />
			<Card.Content class="min-h-0 flex-1 space-y-4 overflow-y-auto">
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
							{#key data.post?.id}
								<div
									id="post-editor"
									use:mountCrepe
									class="max-h-[400px] min-h-[250px] w-full overflow-y-auto rounded-md border border-input p-4"
								></div>
							{/key}
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
			</Card.Content>
			<Card.Footer class="flex shrink-0 justify-end gap-2">
				<Form.Button type="button" variant="outline" onclick={goHome}>Cancel</Form.Button>
				{#if !isDraft}
					<Button
						type="button"
						variant="outline"
						onclick={handleUnpublish}
						disabled={loading || publishLoading}
					>
						{#if publishLoading}
							Unpublishing...
						{:else}
							<EyeOff class="mr-2 h-4 w-4" />
							Unpublish
						{/if}
					</Button>
				{/if}
				<Form.Button type="submit" disabled={loading || publishLoading}>
					{#if loading}
						Saving...
					{:else}
						Save Changes
					{/if}
				</Form.Button>
				{#if isDraft}
					<Button type="button" onclick={handlePublish} disabled={loading || publishLoading}>
						{#if publishLoading}
							Publishing...
						{:else}
							<Send class="mr-2 h-4 w-4" />
							Publish
						{/if}
					</Button>
				{/if}
			</Card.Footer>
		</form>
	</Card.Root>
</div>
