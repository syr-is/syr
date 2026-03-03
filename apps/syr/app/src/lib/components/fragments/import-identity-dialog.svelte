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
	import QRCode from 'qrcode';

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
	// Data-only import (no Sigil)
	let hasSigil = $state<boolean | null>(null);
	let importChallenge = $state<{
		challenge_id: string;
		deeplink_url: string;
		expires_in: number;
		qrDataUrl: string;
	} | null>(null);
	let importToken = $state<string | null>(null);
	let importHeartbeatSource: EventSource | null = null;

	function canImport(): boolean {
		if (!bundleFile) return false;
		if (hasSigil === false) return !!importToken; // data-only: need token
		if (hasSigil === true) {
			if (exportPassphrase.length < 10) return false;
			if (newPassword.length < 8) return false;
			if (newPassword !== confirmPassword) return false;
			return true;
		}
		return false;
	}

	function disconnectImportHeartbeat() {
		if (importHeartbeatSource) {
			importHeartbeatSource.close();
			importHeartbeatSource = null;
		}
	}

	async function onFileSelect(e: Event) {
		const f = (e.target as HTMLInputElement).files?.[0];
		bundleFile = f ?? null;
		hasSigil = null;
		importChallenge = null;
		importToken = null;
		disconnectImportHeartbeat();
		if (!f) return;
		try {
			const arrayBuffer = await f.arrayBuffer();
			const zipBytes = new Uint8Array(arrayBuffer);
			const files = unzipSync(zipBytes);
			hasSigil = !!files['identity.sigil'];
		} catch {
			hasSigil = null;
			toast.error('Could not read bundle file');
		}
	}

	async function handleVerifyWithSyner() {
		if (!bundleFile || hasSigil !== false) return;
		importing = true;
		importChallenge = null;
		try {
			const arrayBuffer = await bundleFile.arrayBuffer();
			const zipBytes = new Uint8Array(arrayBuffer);
			const files = unzipSync(zipBytes);
			const identityJson = files['identity.json'];
			if (!identityJson) {
				toast.error('Bundle must contain identity.json');
				return;
			}
			const identity = JSON.parse(strFromU8(identityJson));
			const did = identity?.did;
			if (!did || typeof did !== 'string') {
				toast.error('Invalid identity.json: missing did');
				return;
			}
			const res = await fetch('/api/identity/import-challenge', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ did })
			});
			const data = await res.json();
			if (!res.ok)
				throw new Error(data.error_description ?? data.message ?? 'Failed to create challenge');
			const qrDataUrl = await QRCode.toDataURL(data.deeplink_url, { width: 256, margin: 2 });
			importChallenge = {
				challenge_id: data.challenge_id,
				deeplink_url: data.deeplink_url,
				expires_in: data.expires_in,
				qrDataUrl
			};
			const src = new EventSource(
				`/api/identity/import-heartbeat?challenge_id=${encodeURIComponent(data.challenge_id)}`
			);
			importHeartbeatSource = src;
			src.addEventListener('verified', (ev: MessageEvent) => {
				try {
					const payload = JSON.parse(ev.data || '{}');
					const token = payload.import_token;
					if (token) {
						importToken = token;
						disconnectImportHeartbeat();
					}
				} catch {
					/* ignore JSON parse errors */
				}
			});
			src.onerror = () => disconnectImportHeartbeat();
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Failed to create challenge');
		} finally {
			importing = false;
		}
	}

	async function handleImport() {
		if (!canImport() || !bundleFile) return;

		importing = true;
		try {
			if (hasSigil === true) {
				// Full import with Sigil
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
				hasSigil = null;
				onSuccess?.();
			} else if (hasSigil === false && importToken) {
				// Data-only import with token
				const formData = new FormData();
				formData.append('bundle', bundleFile);
				formData.append('import_token', importToken);

				const res = await fetch('/api/identity/import', {
					method: 'POST',
					body: formData
				});

				if (!res.ok) {
					const err = await res.json().catch(() => ({}));
					throw new Error(err?.message ?? 'Import failed');
				}

				toast.success('Identity imported successfully! Keys remain in Syner.');
				open = false;
				bundleFile = null;
				hasSigil = null;
				importChallenge = null;
				importToken = null;
				onSuccess?.();
			}
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Import failed');
		} finally {
			importing = false;
		}
	}

	$effect(() => {
		if (!open) {
			disconnectImportHeartbeat();
		}
	});
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="max-w-md">
		<Dialog.Header>
			<Dialog.Title>Import identity</Dialog.Title>
			<Dialog.Description>
				<div class="space-y-2 text-sm">
					{#if hasSigil === true}
						<p>
							Restore from full backup (with keys). Decrypt Sigil and set your account password.
						</p>
						<ul class="list-inside list-disc space-y-1 text-muted-foreground">
							<li>Export passphrase: the passphrase you set when exporting.</li>
							<li>New password: your account password on this instance.</li>
						</ul>
					{:else if hasSigil === false}
						<p>
							Restore from data backup (no keys). Verify with Syner to prove you control this
							identity.
						</p>
					{:else}
						<p>Restore your identity from an exported backup (.syr or .zip).</p>
					{/if}
				</div>
			</Dialog.Description>
		</Dialog.Header>
		<div class="space-y-4 py-4">
			<div class="space-y-2">
				<label for="import-bundle" class="text-sm font-medium">Bundle (.syr or .zip file)</label>
				<Input
					id="import-bundle"
					type="file"
					accept=".syr,.zip"
					onchange={onFileSelect}
					disabled={importing}
				/>
				{#if bundleFile}
					<p class="text-xs text-muted-foreground">
						{bundleFile.name}
						{#if hasSigil === true}
							— Full backup (with Sigil)
						{:else if hasSigil === false}
							— Data-only (verify with Syner)
						{/if}
					</p>
				{/if}
			</div>

			{#if hasSigil === true}
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
			{:else if hasSigil === false}
				{#if importChallenge}
					<div class="flex flex-col items-center gap-4">
						<img
							src={importChallenge.qrDataUrl}
							alt="Scan with Syner"
							class="h-64 w-64 rounded-lg border"
						/>
						<a
							href={importChallenge.deeplink_url}
							class="text-sm text-primary underline hover:no-underline"
						>
							Open in Syner
						</a>
						<p class="text-xs text-muted-foreground">
							Scan or open link, then sign the challenge in Syner.
						</p>
						{#if importToken}
							<p class="text-xs text-green-600">Verified. Click Import below.</p>
						{/if}
					</div>
				{:else}
					<p class="text-sm text-muted-foreground">
						Click below to generate a QR code. Scan it with Syner to verify you control this
						identity.
					</p>
				{/if}
			{/if}
		</div>
		<Dialog.Footer>
			<Button variant="outline" onclick={() => (open = false)} disabled={importing}>Cancel</Button>
			{#if hasSigil === false && !importToken}
				<Button onclick={handleVerifyWithSyner} disabled={importing || !bundleFile}>
					{#if importing}
						<Loader2 class="mr-2 h-4 w-4 animate-spin" />
						Creating...
					{:else}
						Verify with Syner
					{/if}
				</Button>
			{:else}
				<Button onclick={handleImport} disabled={importing || !canImport()}>
					{#if importing}
						<Loader2 class="mr-2 h-4 w-4 animate-spin" />
						Importing...
					{:else}
						Import identity
					{/if}
				</Button>
			{/if}
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
