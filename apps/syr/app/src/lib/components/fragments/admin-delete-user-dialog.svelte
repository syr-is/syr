<script lang="ts">
	import * as Dialog from '@syr-is/ui/dialog';
	import { Button } from '@syr-is/ui/button';
	import { Input } from '@syr-is/ui/input';
	import { toast } from 'svelte-sonner';
	import { Loader2 } from 'lucide-svelte';

	let {
		open = $bindable(false),
		userId = null,
		username = null,
		onSuccess
	}: {
		open?: boolean;
		userId?: string | null;
		username?: string | null;
		onSuccess?: () => void;
	} = $props();

	let confirmText = $state('');
	let deleting = $state(false);

	const confirmed = $derived(confirmText === username);

	$effect(() => {
		if (!open) confirmText = '';
	});

	async function handleDelete() {
		if (!userId || !confirmed) return;

		deleting = true;
		try {
			const res = await fetch(`/api/admin/users/${encodeURIComponent(userId)}`, {
				method: 'DELETE'
			});
			if (!res.ok) {
				const err = await res.json().catch(() => ({}));
				throw new Error(err?.message ?? 'Failed to delete user');
			}
			toast.success(`User ${username} deleted`);
			open = false;
			onSuccess?.();
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Failed to delete user');
		} finally {
			deleting = false;
		}
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="max-w-sm">
		<Dialog.Header>
			<Dialog.Title>Delete user account</Dialog.Title>
			<Dialog.Description>
				This will permanently delete all data for <strong>{username}</strong> including their posts,
				uploads, identity, and profile. This action cannot be undone.
			</Dialog.Description>
		</Dialog.Header>
		<div class="space-y-2 py-2">
			<label for="confirm-username" class="text-sm font-medium">
				Type <strong>{username}</strong> to confirm
			</label>
			<Input id="confirm-username" bind:value={confirmText} placeholder={username ?? ''} />
		</div>
		<Dialog.Footer>
			<Button variant="outline" onclick={() => (open = false)} disabled={deleting}>Cancel</Button>
			<Button variant="destructive" onclick={handleDelete} disabled={deleting || !confirmed}>
				{#if deleting}
					<Loader2 class="mr-2 h-4 w-4 animate-spin" />
					Deleting…
				{:else}
					Delete account
				{/if}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
