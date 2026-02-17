<script lang="ts">
	import * as Dialog from '@syr-is/ui/dialog';
	import { Button } from '@syr-is/ui/button';
	import { toast } from 'svelte-sonner';
	import { Loader2 } from 'lucide-svelte';

	let {
		open = $bindable(false),
		publicKey = null,
		onSuccess
	}: {
		open?: boolean;
		publicKey?: string | null;
		onSuccess?: () => void;
	} = $props();

	let revoking = $state(false);

	async function handleRevoke() {
		if (!publicKey) return;

		revoking = true;
		try {
			const res = await fetch('/api/identity/delegate/revoke', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ devicePublicKey: publicKey })
			});
			if (!res.ok) {
				const err = await res.json().catch(() => ({}));
				throw new Error(err?.message ?? 'Revoke failed');
			}
			toast.success('Device key revoked');
			open = false;
			onSuccess?.();
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Revoke failed');
		} finally {
			revoking = false;
		}
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="max-w-sm">
		<Dialog.Header>
			<Dialog.Title>Revoke device key</Dialog.Title>
			<Dialog.Description>
				Revoke this device key? This device will no longer be able to sign mutations.
			</Dialog.Description>
		</Dialog.Header>
		<Dialog.Footer>
			<Button variant="outline" onclick={() => (open = false)} disabled={revoking}>Cancel</Button>
			<Button variant="destructive" onclick={handleRevoke} disabled={revoking}>
				{#if revoking}
					<Loader2 class="mr-2 h-4 w-4 animate-spin" />
					Revoking...
				{:else}
					Revoke
				{/if}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
