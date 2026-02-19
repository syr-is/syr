<script lang="ts">
	import * as Dialog from '@syr-is/ui/dialog';
	import { Button } from '@syr-is/ui/button';
	import { Input } from '@syr-is/ui/input';
	import { toast } from 'svelte-sonner';
	import { Loader2 } from 'lucide-svelte';
	import { zip, strToU8 } from 'fflate';
	import { createSigil } from '@syr-is/crypto/sigil';
	import { seedHandler } from '$lib/services/seed-handler';
	import type { AegisBundle } from '@syr-is/crypto/aegis';

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
	let unlockPassword = $state('');
	let bundle = $state<AegisBundle | null>(null);
	let step = $state<'unlock' | 'export'>('unlock');

	$effect(() => {
		if (open) {
			if (!bundle) {
				step = 'unlock';
			}
		} else {
			bundle = null;
			unlockPassword = '';
		}
	});

	function canExport(): boolean {
		if (passphrase !== confirmPassphrase) return false;
		if (passphrase.length < 10) return false;
		return true;
	}

	async function handleUnlock() {
		if (!unlockPassword || unlockPassword.length < 1) return;

		exporting = true;
		try {
			const res = await fetch('/api/identity/aegis-bundle');
			if (!res.ok) throw new Error('Failed to fetch identity');
			const data = await res.json();
			const b = data.data?.aegisBundle;
			if (!b) throw new Error('No Aegis bundle found');

			// Verify password by attempting to decrypt
			await seedHandler.verify({ bundle: b, password: unlockPassword });

			bundle = b;
			step = 'export';
			toast.success('Identity unlocked');
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Unlock failed');
		} finally {
			exporting = false;
		}
	}

	async function handleExport() {
		if (!hasIdentity || !canExport()) return;

		const b = bundle;
		const pwd = unlockPassword;
		if (!b || !pwd) {
			step = 'unlock';
			toast.error('Please unlock your identity first');
			return;
		}

		exporting = true;
		try {
			await seedHandler.run({
				bundle: b,
				password: pwd,
				action: async (seed) => {
					const dataRes = await fetch('/api/identity/export-bundle-data');
					if (!dataRes.ok) throw new Error('Failed to fetch export data');
					const { data } = await dataRes.json();

					const sigil = await createSigil(seed, passphrase);

					const zipFiles: Record<string, Uint8Array> = {};
					zipFiles['manifest.json'] = strToU8(JSON.stringify(data.manifest, null, 2));
					zipFiles['identity.json'] = strToU8(JSON.stringify(data.identity, null, 2));
					zipFiles['posts.json'] = strToU8(JSON.stringify(data.posts, null, 2));
					zipFiles['assets.json'] = strToU8(
						JSON.stringify(
							{
								assets: data.assets.map(
									(a: {
										zip_path: string;
										local_id: string;
										filename: string;
										mime_type: string;
										size: number;
										sha256?: string;
									}) => ({
										zip_path: a.zip_path,
										local_id: a.local_id,
										filename: a.filename,
										mime_type: a.mime_type,
										size: a.size,
										sha256: a.sha256
									})
								)
							},
							null,
							2
						)
					);
					zipFiles['pinned_posts.json'] = strToU8(JSON.stringify(data.pinned_posts, null, 2));
					zipFiles['identity.sigil'] = strToU8(JSON.stringify(sigil, null, 2));

					for (const asset of data.assets ?? []) {
						if (asset.content_base64 && asset.zip_path) {
							const binary = Uint8Array.from(atob(asset.content_base64), (c) => c.charCodeAt(0));
							zipFiles[asset.zip_path] = binary;
						}
					}

					const zipped = await new Promise<Uint8Array>((resolve, reject) => {
						zip(zipFiles, { level: 1 }, (err, out) => {
							if (err) reject(err);
							else resolve(out ?? new Uint8Array(0));
						});
					});

					const didShort = data.manifest?.did?.slice(8, 20) ?? 'export';
					const filename = `syr-export-${didShort}-${Date.now()}.zip`;
					const blob = new Blob([new Uint8Array(zipped)]);
					const url = URL.createObjectURL(blob);
					const a = document.createElement('a');
					a.href = url;
					a.download = filename;
					a.click();
					URL.revokeObjectURL(url);
				}
			});

			toast.success('Identity exported — store the bundle and passphrase securely!');
			open = false;
			passphrase = '';
			confirmPassphrase = '';
			unlockPassword = '';
			bundle = null;
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
				{#if step === 'unlock'}
					<p class="text-sm text-muted-foreground">
						Enter your account password to unlock your identity. The seed was encrypted at login and
						needs to be decrypted before export.
					</p>
				{:else}
					<div class="space-y-2 text-sm">
						<p>
							⚠️ You are about to download your full identity bundle (including your ROOT PRIVATE
							KEY, encrypted as Sigil).
						</p>
						<ul class="list-inside list-disc space-y-1 text-muted-foreground">
							<li>
								Choose a strong passphrase (min 10 chars) — you will need it to import this bundle.
							</li>
							<li>Store the bundle and passphrase in a secure, offline location.</li>
							<li>Anyone with both can fully impersonate your identity.</li>
						</ul>
					</div>
				{/if}
			</Dialog.Description>
		</Dialog.Header>
		<div class="space-y-4 py-4">
			{#if step === 'unlock'}
				<div class="space-y-2">
					<label for="unlock-password" class="text-sm font-medium"
						>Password (to unlock identity)</label
					>
					<Input
						id="unlock-password"
						type="password"
						bind:value={unlockPassword}
						placeholder="••••••••"
						autocomplete="current-password"
						disabled={exporting}
						onkeydown={(e) => e.key === 'Enter' && handleUnlock()}
					/>
				</div>
			{:else}
				<div class="space-y-2">
					<label for="export-passphrase" class="text-sm font-medium"
						>Export passphrase (min 10 characters)</label
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
			{/if}
		</div>
		<Dialog.Footer>
			<Button variant="outline" onclick={() => (open = false)} disabled={exporting}>Cancel</Button>
			{#if step === 'unlock'}
				<Button onclick={handleUnlock} disabled={exporting || !unlockPassword}>
					{#if exporting}
						<Loader2 class="mr-2 h-4 w-4 animate-spin" />
						Unlocking...
					{:else}
						Unlock
					{/if}
				</Button>
			{:else}
				<Button variant="destructive" onclick={handleExport} disabled={exporting || !canExport()}>
					{#if exporting}
						<Loader2 class="mr-2 h-4 w-4 animate-spin" />
						Exporting...
					{:else}
						I understand, export identity
					{/if}
				</Button>
			{/if}
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
