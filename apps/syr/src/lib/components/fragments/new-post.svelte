<script lang="ts">
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import * as Form from '$lib/components/ui/form';
	import * as Select from '$lib/components/ui/select';
	import { Input } from '$lib/components/ui/input';
	import { Textarea } from '$lib/components/ui/textarea';
	import { Label } from '$lib/components/ui/label';
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
	import { handleFileUpload } from '$lib/handlers/upload';
	import type { Crepe as CrepeType } from '@milkdown/crepe';

	let crepeInstance: CrepeType | null = $state(null);
	let crepeReady = $state(false);
	let dialogOpen = $state(false);
	let loading = $state(false);

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
				const response = await fetch('/api/posts', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify(form.data)
				});

				if (!response.ok) {
					const error = await response.json();
					toast.error(error.error?.message || 'Failed to create post');
					return;
				}

				toast.success('Post created successfully');
				// Reset form
				$formData.type = 'blog';
				$formData.content_type = 'markdown';
				$formData.title = '';
				$formData.content = '';
				$formData.visibility = 'public';
				// Close dialog - editor will be destroyed and recreated on next open
				dialogOpen = false;
				// Invalidate all to refresh posts list
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
	$formData.content = '';
	$formData.visibility = 'public';

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
		const instance = new Crepe({
			root: node,
			defaultValue: $formData.content || ''
		});

		// Create editor and wait for it to be ready
		instance.create().then(() => {
			crepeInstance = instance;

			instance.editor.ctx.update(imageBlockConfig.key, (defaultConfig) => ({
				...defaultConfig,
				onUpload: handleFileUpload
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
</script>

<Dialog.Root bind:open={dialogOpen}>
	<Dialog.Trigger
		class="border-input shadow-xs ring-offset-background hover:bg-accent hover:text-accent-foreground focus-visible:ring-ring inline-flex h-9 items-center justify-center whitespace-nowrap rounded-md border bg-transparent px-4 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50"
	>
		+ New Post
	</Dialog.Trigger>
	<Dialog.Content class="flex max-h-[90vh] max-w-3xl flex-col overflow-visible">
		<Dialog.Header>
			<Dialog.Title>New Post</Dialog.Title>
			<Dialog.Description>Create a new blog post</Dialog.Description>
		</Dialog.Header>
		<form method="POST" use:enhance class="flex min-h-0 flex-col">
			<!-- Hidden field for type -->
			<input type="hidden" name="type" value={$formData.type} />
			<div class="min-h-0 flex-1 space-y-4 overflow-visible">
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
								class="border-input min-h-[400px] w-full overflow-visible rounded-md border p-4"
							></div>
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
			<Dialog.Footer class="mt-6">
				<Form.Button type="submit" disabled={loading} class="w-full sm:w-auto">
					{#if loading}
						Creating post...
					{:else}
						Create Post
					{/if}
				</Form.Button>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>
