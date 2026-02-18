<script lang="ts">
	import * as Dialog from '@syr-is/ui/dialog';
	import { Button } from '@syr-is/ui/button';
	import { Input } from '@syr-is/ui/input';
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
	let passphrase = $state('');
	let confirmPassphrase = $state('');

	function canExport(): boolean {
		if (passphrase !== confirmPassphrase) return false;
		if (passphrase.length > 0 && passphrase.length < 8) return false;
		return true;
	}

	async function handleExport() {
		if (!hasIdentity || !canExport()) return;

		exporting = true;
		try {
			const res = await fetch('/api/identity/export-bundle', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ passphrase })
			});
			if (!res.ok) {
				const err = await res.json().catch(() => ({}));
				throw new Error(err?.message ?? 'Export failed');
			}
			const blob = await res.blob();
			const disposition = res.headers.get('Content-Disposition');
			const match = disposition?.match(/filename="([^"]+)"/);
			const filename = match?.[1] ?? `syr-export-${Date.now()}.zip`;
			const url = URL.createObjectURL(blob);
			const a = document.createElement('a');
			a.href = url;
			a.download = filename;
			a.click();
			URL.revokeObjectURL(url);
			toast.success('Identity exported — store the bundle and passphrase securely!');
			open = false;
			passphrase = '';
			confirmPassphrase = '';
			onSuccess?.();
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Export failed');
		} finally {
			exporting = false;
		}
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="max-w-md">
		<Dialog.Header>
			<Dialog.Title>Export identity</Dialog.Title>
			<Dialog.Description>
				<div class="space-y-2 text-sm">
					<p>
						⚠️ You are about to download your full identity bundle (including your ROOT PRIVATE KEY,
						encrypted).
					</p>
					<ul class="list-inside list-disc space-y-1 text-muted-foreground">
						<li>Choose a strong passphrase — you will need it to import this bundle.</li>
						<li>Store the bundle and passphrase in a secure, offline location.</li>
						<li>Anyone with both can fully impersonate your identity.</li>
					</ul>
				</div>
			</Dialog.Description>
		</Dialog.Header>
		<div class="space-y-4 py-4">
			<div class="space-y-2">
				<label for="export-passphrase" class="text-sm font-medium"
					>Passphrase (min 8 characters)</label
				>
				<Input
					id="export-passphrase"
					type="password"
					bind:value={passphrase}
					placeholder="••••••••"
					autocomplete="new-password"
					disabled={exporting}
				/>
			</div>
			<div class="space-y-2">
				<label for="export-confirm" class="text-sm font-medium">Confirm passphrase</label>
				<Input
					id="export-confirm"
					type="password"
					bind:value={confirmPassphrase}
					placeholder="••••••••"
					autocomplete="new-password"
					disabled={exporting}
				/>
				{#if confirmPassphrase && passphrase !== confirmPassphrase}
					<p class="text-xs text-destructive">Passphrases do not match</p>
				{/if}
			</div>
		</div>
		<Dialog.Footer>
			<Button variant="outline" onclick={() => (open = false)} disabled={exporting}>Cancel</Button>
			<Button variant="destructive" onclick={handleExport} disabled={exporting || !canExport()}>
				{#if exporting}
					<Loader2 class="mr-2 h-4 w-4 animate-spin" />
					Exporting...
				{:else}
					I understand, export identity
				{/if}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
