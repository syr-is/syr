<script lang="ts">
	import * as Dialog from '@syr-is/ui/dialog';
	import { Button } from '@syr-is/ui/button';
	import { toast } from 'svelte-sonner';
	import { Loader2 } from 'lucide-svelte';

	let {
		open = $bindable(false),
		registry = null,
		onSuccess
	}: {
		open?: boolean;
		registry?: { id: string; registryUrl: string } | null;
		onSuccess?: () => void;
	} = $props();

	let removing = $state(false);

	async function handleRemove() {
		if (!registry) return;

		removing = true;
		try {
			const res = await fetch(`/api/user/discovery-registries/${encodeURIComponent(registry.id)}`, {
				method: 'DELETE'
			});
			if (!res.ok) {
				const err = await res.json().catch(() => ({}));
				throw new Error(err?.message ?? 'Failed to remove discovery registry');
			}
			toast.success('Discovery registry removed');
			open = false;
			onSuccess?.();
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Failed to remove discovery registry');
		} finally {
			removing = false;
		}
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="max-w-sm">
		<Dialog.Header>
			<Dialog.Title>Remove discovery registry</Dialog.Title>
			<Dialog.Description>
				Stop using {registry?.registryUrl ?? 'this registry'} for directory search and follow discovery?
				Your identity will not be unpublished from it — use Identity settings for that.
			</Dialog.Description>
		</Dialog.Header>
		<Dialog.Footer>
			<Button variant="outline" onclick={() => (open = false)} disabled={removing}>Cancel</Button>
			<Button variant="destructive" onclick={handleRemove} disabled={removing}>
				{#if removing}
					<Loader2 class="mr-2 h-4 w-4 animate-spin" />
					Removing...
				{:else}
					Remove
				{/if}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
