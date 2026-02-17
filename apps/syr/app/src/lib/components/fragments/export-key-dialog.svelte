<script lang="ts">
	import * as Dialog from '@syr-is/ui/dialog';
	import { Button } from '@syr-is/ui/button';
	import { toast } from 'svelte-sonner';
	import { Loader2 } from 'lucide-svelte';

	let {
		open = $bindable(false),
		hasIdentity = false,
		onSuccess
	}: {
		open?: boolean;
		hasIdentity?: boolean;
		onSuccess?: () => void;
	} = $props();

	let exporting = $state(false);

	async function handleExport() {
		if (!hasIdentity) return;

		exporting = true;
		try {
			const res = await fetch('/api/identity/export-keys', { method: 'POST' });
			if (!res.ok) {
				const err = await res.json().catch(() => ({}));
				throw new Error(err?.message ?? 'Key export failed');
			}
			const result = await res.json();
			const blob = new Blob([JSON.stringify(result.data, null, 2)], {
				type: 'application/json'
			});
			const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
			const url = URL.createObjectURL(blob);
			const a = document.createElement('a');
			a.href = url;
			a.download = `private-key-${timestamp}.json`;
			a.click();
			URL.revokeObjectURL(url);
			toast.success('Private key exported — store it securely!');
			open = false;
			onSuccess?.();
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Key export failed');
		} finally {
			exporting = false;
		}
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="max-w-md">
		<Dialog.Header>
			<Dialog.Title>Export private key</Dialog.Title>
			<Dialog.Description>
				<div class="space-y-2 text-sm">
					<p>⚠️ You are about to download your ROOT PRIVATE KEY.</p>
					<ul class="list-inside list-disc space-y-1 text-muted-foreground">
						<li>Anyone with this key can fully impersonate your identity.</li>
						<li>Store it in a secure, offline location.</li>
						<li>After export, you are responsible for key custody.</li>
					</ul>
				</div>
			</Dialog.Description>
		</Dialog.Header>
		<Dialog.Footer>
			<Button variant="outline" onclick={() => (open = false)} disabled={exporting}>Cancel</Button>
			<Button variant="destructive" onclick={handleExport} disabled={exporting}>
				{#if exporting}
					<Loader2 class="mr-2 h-4 w-4 animate-spin" />
					Exporting...
				{:else}
					I understand, export key
				{/if}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
