<script lang="ts">
	import * as Dialog from '$lib/components/ui/dialog';
	import { Input } from '$lib/components/ui/input';
	import { Button } from '$lib/components/ui/button';
	import { Label } from '$lib/components/ui/label';
	import type { Post } from '@syr-is/types';
	import { toast } from 'svelte-sonner';
	import { invalidateAll } from '$app/navigation';
	import { storageEvents } from '$lib/stores/storage-events.svelte';

	let { post, open = $bindable(false) }: { post: Post; open?: boolean } = $props();

	let confirmText = $state('');
	let loading = $state(false);
	const requiredText = 'delete';

	const isConfirmValid = $derived(confirmText.toLowerCase() === requiredText);

	async function handleDelete() {
		if (!isConfirmValid) return;

		loading = true;
		try {
			const postId = typeof post.id === 'string' ? post.id : post.id.toString();
			const response = await fetch(`/api/posts/${postId}`, {
				method: 'DELETE'
			});

			if (!response.ok) {
				const error = await response.json();
				toast.error(error.error?.message || 'Failed to delete post');
				return;
			}

			toast.success('Post deleted successfully');
			open = false;
			confirmText = '';
			storageEvents.refresh();
			await invalidateAll();
		} catch (_error) {
			toast.error('An unexpected error occurred');
		} finally {
			loading = false;
		}
	}

	function handleOpenChange(newOpen: boolean) {
		open = newOpen;
		if (!newOpen) {
			confirmText = '';
		}
	}
</script>

<Dialog.Root bind:open onOpenChange={handleOpenChange}>
	<Dialog.Content class="max-w-md">
		<Dialog.Header>
			<Dialog.Title>Delete Post</Dialog.Title>
			<Dialog.Description>
				This action cannot be undone. This will permanently delete the post
				<strong>"{post.title || 'Untitled Post'}"</strong>.
			</Dialog.Description>
		</Dialog.Header>
		<div class="space-y-4 py-4">
			<div class="space-y-2">
				<Label for="confirm-text">
					Type <strong>"{requiredText}"</strong> to confirm:
				</Label>
				<Input
					id="confirm-text"
					bind:value={confirmText}
					placeholder={requiredText}
					disabled={loading}
					onkeydown={(e) => {
						if (e.key === 'Enter' && isConfirmValid && !loading) {
							handleDelete();
						}
					}}
				/>
			</div>
		</div>
		<Dialog.Footer>
			<Button variant="outline" disabled={loading} onclick={() => (open = false)}>Cancel</Button>
			<Button variant="destructive" disabled={!isConfirmValid || loading} onclick={handleDelete}>
				{#if loading}
					Deleting...
				{:else}
					Delete Post
				{/if}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
