<script lang="ts">
	import * as Dialog from '@syr-is/ui/dialog';
	import { Button } from '@syr-is/ui/button';
	import { Input } from '@syr-is/ui/input';
	import { toast } from 'svelte-sonner';
	import { Loader2 } from 'lucide-svelte';
	import { unzipSync, strFromU8 } from 'fflate';
	import { decryptSigil } from '@syr-is/crypto/sigil';
	import { createAegisBundle } from '@syr-is/crypto/aegis';
	import type { SigilObject } from '@syr-is/crypto/sigil';

	let {
		open = $bindable(false),
		onSuccess
	}: {
		open?: boolean;
		onSuccess?: () => void;
	} = $props();

	let importing = $state(false);
	let bundleFile = $state<File | null>(null);
	let exportPassphrase = $state('');
	let newPassword = $state('');
	let confirmPassword = $state('');

	function canImport(): boolean {
		if (!bundleFile) return false;
		if (exportPassphrase.length < 10) return false;
		if (newPassword.length < 8) return false;
		if (newPassword !== confirmPassword) return false;
		return true;
	}

	async function handleImport() {
		if (!canImport() || !bundleFile) return;

		importing = true;
		try {
			const arrayBuffer = await bundleFile.arrayBuffer();
			const zipBytes = new Uint8Array(arrayBuffer);
			const files = unzipSync(zipBytes);

			const sigilFile = files['identity.sigil'];
			if (!sigilFile) {
				throw new Error(
					'Bundle must contain identity.sigil (Sigil format). Legacy PEM format is no longer supported.'
				);
			}

			const sigil: SigilObject = JSON.parse(strFromU8(sigilFile));
			const seed = await decryptSigil(sigil, exportPassphrase);
			const aegisBundle = await createAegisBundle(seed, newPassword);

			const formData = new FormData();
			formData.append('bundle', bundleFile);
			formData.append('aegisBundle', JSON.stringify(aegisBundle));

			const res = await fetch('/api/identity/import', {
				method: 'POST',
				body: formData
			});

			if (!res.ok) {
				const err = await res.json().catch(() => ({}));
				throw new Error(err?.message ?? 'Import failed');
			}

			toast.success('Identity imported successfully!');
			open = false;
			bundleFile = null;
			exportPassphrase = '';
			newPassword = '';
			confirmPassword = '';
			onSuccess?.();
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Import failed');
		} finally {
			importing = false;
		}
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="max-w-md">
		<Dialog.Header>
			<Dialog.Title>Import identity</Dialog.Title>
			<Dialog.Description>
				<div class="space-y-2 text-sm">
					<p>Restore your identity from an exported backup (.syr or .zip with identity.sigil).</p>
					<ul class="list-inside list-disc space-y-1 text-muted-foreground">
						<li>Export passphrase: the passphrase you set when exporting.</li>
						<li>New password: your account password on this instance.</li>
					</ul>
				</div>
			</Dialog.Description>
		</Dialog.Header>
		<div class="space-y-4 py-4">
			<div class="space-y-2">
				<label for="import-bundle" class="text-sm font-medium"
					>Bundle (.syr or .zip file)</label
				>
				<Input
					id="import-bundle"
					type="file"
					accept=".syr,.zip"
					onchange={(e) => {
						const f = (e.target as HTMLInputElement).files?.[0];
						bundleFile = f ?? null;
					}}
					disabled={importing}
				/>
				{#if bundleFile}
					<p class="text-xs text-muted-foreground">{bundleFile.name}</p>
				{/if}
			</div>
			<div class="space-y-2">
				<label for="export-passphrase" class="text-sm font-medium"
					>Export passphrase (min 10 chars)</label
				>
				<Input
					id="export-passphrase"
					type="password"
					bind:value={exportPassphrase}
					placeholder="••••••••"
					autocomplete="off"
					disabled={importing}
				/>
			</div>
			<div class="space-y-2">
				<label for="new-password" class="text-sm font-medium">New password (account)</label>
				<Input
					id="new-password"
					type="password"
					bind:value={newPassword}
					placeholder="••••••••"
					autocomplete="new-password"
					disabled={importing}
				/>
			</div>
			<div class="space-y-2">
				<label for="confirm-password" class="text-sm font-medium">Confirm new password</label>
				<Input
					id="confirm-password"
					type="password"
					bind:value={confirmPassword}
					placeholder="••••••••"
					autocomplete="new-password"
					disabled={importing}
				/>
				{#if confirmPassword && newPassword !== confirmPassword}
					<p class="text-xs text-destructive">Passwords do not match</p>
				{/if}
			</div>
		</div>
		<Dialog.Footer>
			<Button variant="outline" onclick={() => (open = false)} disabled={importing}>Cancel</Button>
			<Button onclick={handleImport} disabled={importing || !canImport()}>
				{#if importing}
					<Loader2 class="mr-2 h-4 w-4 animate-spin" />
					Importing...
				{:else}
					Import identity
				{/if}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
