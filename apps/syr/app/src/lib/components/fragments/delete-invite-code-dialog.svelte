<script lang="ts">
	import * as Dialog from '@syr-is/ui/dialog';
	import { Button } from '@syr-is/ui/button';
	import { toast } from 'svelte-sonner';
	import { Loader2 } from 'lucide-svelte';

	let {
		open = $bindable(false),
		code = null,
		onSuccess
	}: {
		open?: boolean;
		code?: string | null;
		onSuccess?: () => void;
	} = $props();

	let removing = $state(false);

	async function handleDelete() {
		if (!code) return;

		removing = true;
		try {
			const res = await fetch(`/api/invite-codes/${encodeURIComponent(code)}`, {
				method: 'DELETE'
			});
			if (!res.ok) {
				const err = await res.json().catch(() => ({}));
				throw new Error(err?.message ?? 'Failed to delete invite code');
			}
			toast.success('Invite code deleted');
			open = false;
			onSuccess?.();
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Failed to delete invite code');
		} finally {
			removing = false;
		}
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="max-w-sm">
		<Dialog.Header>
			<Dialog.Title>Delete invite code</Dialog.Title>
			<Dialog.Description>
				Delete invite code <code class="font-mono text-xs">{code}</code>? Anyone who has this code
				will no longer be able to use it to register.
			</Dialog.Description>
		</Dialog.Header>
		<Dialog.Footer>
			<Button variant="outline" onclick={() => (open = false)} disabled={removing}>Cancel</Button>
			<Button variant="destructive" onclick={handleDelete} disabled={removing || !code}>
				{#if removing}
					<Loader2 class="mr-2 h-4 w-4 animate-spin" />
					Deleting...
				{:else}
					Delete
				{/if}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
