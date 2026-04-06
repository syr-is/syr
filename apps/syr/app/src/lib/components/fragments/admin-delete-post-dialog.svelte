<script lang="ts">
	import * as Dialog from '@syr-is/ui/dialog';
	import { Button } from '@syr-is/ui/button';
	import { toast } from 'svelte-sonner';
	import { Loader2 } from 'lucide-svelte';

	let {
		open = $bindable(false),
		userId = null,
		postDid = null,
		postLocalId = null,
		postTitle = null,
		onSuccess
	}: {
		open?: boolean;
		userId?: string | null;
		postDid?: string | null;
		postLocalId?: string | null;
		postTitle?: string | null;
		onSuccess?: () => void;
	} = $props();

	let deleting = $state(false);

	async function handleDelete() {
		if (!userId || !postDid || !postLocalId) return;

		deleting = true;
		try {
			const res = await fetch(
				`/api/admin/users/${encodeURIComponent(userId)}/posts/${encodeURIComponent(postDid)}/${encodeURIComponent(postLocalId)}`,
				{ method: 'DELETE' }
			);
			if (!res.ok) {
				const err = await res.json().catch(() => ({}));
				throw new Error(err?.message ?? 'Failed to delete post');
			}
			toast.success('Post deleted');
			open = false;
			onSuccess?.();
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Failed to delete post');
		} finally {
			deleting = false;
		}
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="max-w-sm">
		<Dialog.Header>
			<Dialog.Title>Delete post</Dialog.Title>
			<Dialog.Description>
				Delete {postTitle ? `"${postTitle}"` : 'this post'}? The post record will be removed but
				associated uploads will be preserved.
			</Dialog.Description>
		</Dialog.Header>
		<Dialog.Footer>
			<Button variant="outline" onclick={() => (open = false)} disabled={deleting}>Cancel</Button>
			<Button
				variant="destructive"
				onclick={handleDelete}
				disabled={deleting || !postDid || !postLocalId}
			>
				{#if deleting}
					<Loader2 class="mr-2 h-4 w-4 animate-spin" />
					Deleting…
				{:else}
					Delete
				{/if}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
