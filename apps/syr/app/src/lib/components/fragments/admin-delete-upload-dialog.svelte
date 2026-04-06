<script lang="ts">
	import * as Dialog from '@syr-is/ui/dialog';
	import { Button } from '@syr-is/ui/button';
	import { toast } from 'svelte-sonner';
	import { Loader2 } from 'lucide-svelte';

	let {
		open = $bindable(false),
		userId = null,
		uploadDid = null,
		uploadLocalId = null,
		filename = null,
		onSuccess
	}: {
		open?: boolean;
		userId?: string | null;
		uploadDid?: string | null;
		uploadLocalId?: string | null;
		filename?: string | null;
		onSuccess?: () => void;
	} = $props();

	let deleting = $state(false);

	async function handleDelete() {
		if (!userId || !uploadDid || !uploadLocalId) return;

		deleting = true;
		try {
			const res = await fetch(
				`/api/admin/users/${encodeURIComponent(userId)}/uploads/${encodeURIComponent(uploadDid)}/${encodeURIComponent(uploadLocalId)}`,
				{ method: 'DELETE' }
			);
			if (!res.ok) {
				const err = await res.json().catch(() => ({}));
				throw new Error(err?.message ?? 'Failed to delete upload');
			}
			toast.success('Upload deleted');
			open = false;
			onSuccess?.();
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Failed to delete upload');
		} finally {
			deleting = false;
		}
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="max-w-sm">
		<Dialog.Header>
			<Dialog.Title>Delete upload</Dialog.Title>
			<Dialog.Description>
				Delete {filename ? `"${filename}"` : 'this upload'}? The file will be permanently removed
				from storage.
			</Dialog.Description>
		</Dialog.Header>
		<Dialog.Footer>
			<Button variant="outline" onclick={() => (open = false)} disabled={deleting}>Cancel</Button>
			<Button
				variant="destructive"
				onclick={handleDelete}
				disabled={deleting || !uploadDid || !uploadLocalId}
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
