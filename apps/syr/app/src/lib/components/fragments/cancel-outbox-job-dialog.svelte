<script lang="ts">
	import * as Dialog from '@syr-is/ui/dialog';
	import { Button } from '@syr-is/ui/button';
	import { toast } from 'svelte-sonner';
	import { Loader2 } from 'lucide-svelte';

	let {
		open = $bindable(false),
		jobId = null,
		onSuccess
	}: {
		open?: boolean;
		jobId?: string | null;
		onSuccess?: () => void;
	} = $props();

	let cancelling = $state(false);

	async function handleCancel() {
		if (!jobId) return;

		cancelling = true;
		try {
			const idPart = jobId.includes(':') ? jobId.split(':').slice(1).join(':') : jobId;
			const res = await fetch(`/api/identity/outbox/${encodeURIComponent(idPart)}/cancel`, {
				method: 'POST'
			});
			if (!res.ok) {
				const err = await res.json().catch(() => ({}));
				throw new Error(err?.message ?? 'Cancel failed');
			}
			toast.success('Job cancelled');
			open = false;
			onSuccess?.();
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Cancel failed');
		} finally {
			cancelling = false;
		}
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="max-w-sm">
		<Dialog.Header>
			<Dialog.Title>Cancel sync job</Dialog.Title>
			<Dialog.Description>Cancel this outbox job? The sync will not be retried.</Dialog.Description>
		</Dialog.Header>
		<Dialog.Footer>
			<Button variant="outline" onclick={() => (open = false)} disabled={cancelling}>Keep</Button>
			<Button variant="destructive" onclick={handleCancel} disabled={cancelling}>
				{#if cancelling}
					<Loader2 class="mr-2 h-4 w-4 animate-spin" />
					Cancelling...
				{:else}
					Cancel job
				{/if}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
