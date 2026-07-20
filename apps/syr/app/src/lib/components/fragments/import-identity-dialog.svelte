<script lang="ts">
	import * as Dialog from '@syr-is/ui/dialog';
	import { Button } from '@syr-is/ui/button';
	import { Input } from '@syr-is/ui/input';
	import { toast } from 'svelte-sonner';
	import { Loader2, ShieldCheck, ShieldAlert, ShieldQuestion } from 'lucide-svelte';
	import { unzipSync, strFromU8, zip, strToU8 } from 'fflate';
	import { decryptSigil } from '@syr-is/crypto/sigil';
	import { createAegisBundle } from '@syr-is/crypto/aegis';
	import { decodePublicKey, deriveDid } from '@syr-is/crypto';
	import { computeSha256Hex } from '@syr-is/utils';
	import { buildDidDocument } from '@syr-is/did';
	import { signAsset } from '$lib/services/bundle-signature-verification';
	import { verifyBundleTrust, type BundleTrustState } from '$lib/services/export-manifest';
	import type { SigilObject } from '@syr-is/crypto/sigil';
	import { analyzeBackupFile } from '$lib/utils/migrate-file';
	import QRCode from 'qrcode';
	import { ulid } from '@syr-is/types';

	function inferMimeType(filename: string): string {
		const ext = filename.toLowerCase().split('.').pop() ?? '';
		const map: Record<string, string> = {
			png: 'image/png',
			jpg: 'image/jpeg',
			jpeg: 'image/jpeg',
			gif: 'image/gif',
			webp: 'image/webp',
			svg: 'image/svg+xml'
		};
		return map[ext] ?? 'application/octet-stream';
	}

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
	// Data-only import (no Sigil) — only for .syr
	let hasSigil = $state<boolean | null>(null);
	let fileType = $state<'syr' | 'persona' | 'sigil' | null>(null);
	let importChallenge = $state<{
		challenge_id: string;
		deeplink_url: string;
		expires_in: number;
		qrDataUrl: string;
	} | null>(null);
	let importToken = $state<string | null>(null);
	let importHeartbeatSource: EventSource | null = null;
	// Manifest-v2 authenticity state for .syr bundles (null = not a .syr / not yet checked).
	let trustState = $state<BundleTrustState | null>(null);
	let trustMessage = $state<string | null>(null);

	function canImport(): boolean {
		if (!bundleFile) return false;
		if (trustState === 'tampered') return false; // never import a tampered signed bundle
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

	function resetImportState() {
		bundleFile = null;
		exportPassphrase = '';
		newPassword = '';
		confirmPassword = '';
		hasSigil = null;
		fileType = null;
		importChallenge = null;
		importToken = null;
		trustState = null;
		trustMessage = null;
		disconnectImportHeartbeat();
	}

	async function onFileSelect(e: Event) {
		const f = (e.target as HTMLInputElement).files?.[0];
		bundleFile = f ?? null;
		hasSigil = null;
		fileType = null;
		importChallenge = null;
		importToken = null;
		trustState = null;
		trustMessage = null;
		disconnectImportHeartbeat();
		if (!f) return;
		const result = await analyzeBackupFile(f);
		if (result.error) {
			toast.error(result.error);
			return;
		}
		if (result.fileType == null) {
			toast.error('Unrecognized file format. Expected .syr, .persona, or .sigil.');
			return;
		}
		hasSigil = result.hasSigil;
		fileType =
			result.fileType === 'raw_sigil'
				? 'sigil'
				: result.fileType === 'zip'
					? 'syr'
					: result.fileType === 'persona'
						? 'persona'
						: null;

		// Classify .syr authenticity from the manifest (v2 signed / legacy-unsigned / tampered).
		// The server re-verifies on import; this only drives the badge and blocks tampered bundles.
		if (fileType === 'syr') {
			try {
				const ab = await f.arrayBuffer();
				const files = unzipSync(new Uint8Array(ab));
				const trust = await verifyBundleTrust(files);
				trustState = trust.state;
				trustMessage = trust.message ?? null;
				if (trust.state === 'tampered') {
					toast.error(trust.message ?? 'This backup failed verification and cannot be imported.');
				}
			} catch {
				// Non-fatal: leave trustState null; the server remains the authority on import.
				trustState = null;
				trustMessage = null;
			}
		}
	}

	async function handleVerifyWithSyner() {
		if (!bundleFile || hasSigil !== false) return;
		if (trustState === 'tampered') return; // block Syner verification for a tampered bundle
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

	async function buildSyntheticBundleAndImport(
		sigil: SigilObject,
		seed: Uint8Array,
		identityBundle: {
			did: string;
			publicKey: string;
			profile: { displayName: string; bio?: string; avatarUrl?: string; bannerUrl?: string };
			didDocument: Record<string, unknown>;
			delegatedKeys: unknown[];
			exportedAt: string;
		},
		sigilBytes: Uint8Array,
		assetEntries: Array<{ zipPath: string; data: Uint8Array; filename: string; mimeType: string }>
	): Promise<void> {
		const assetsWithSignatures = [];
		for (const a of assetEntries) {
			const localId = ulid();
			const buf: ArrayBuffer =
				a.data.byteOffset === 0 && a.data.byteLength === a.data.buffer.byteLength
					? (a.data.buffer as ArrayBuffer)
					: (a.data.buffer.slice(
							a.data.byteOffset,
							a.data.byteOffset + a.data.byteLength
						) as ArrayBuffer);
			const sha256 = await computeSha256Hex(buf);
			const unsigned = {
				local_id: localId,
				filename: a.filename,
				mime_type: a.mimeType,
				size: a.data.length,
				zip_path: a.zipPath,
				sha256
			};
			const signed = await signAsset(identityBundle.did, unsigned, seed);
			assetsWithSignatures.push({
				...signed,
				content_base64: undefined
			});
		}
		const manifest = {
			version: 1 as const,
			did: identityBundle.did,
			exportedAt: new Date().toISOString(),
			postCount: 0,
			assetCount: assetEntries.length
		};
		const zipFiles: Record<string, Uint8Array> = {};
		zipFiles['manifest.json'] = strToU8(JSON.stringify(manifest, null, 2));
		const { privateKey: _pk, ...identityWithoutPrivateKey } = identityBundle as Record<
			string,
			unknown
		> & { privateKey?: unknown };
		zipFiles['identity.json'] = strToU8(JSON.stringify(identityWithoutPrivateKey, null, 2));
		zipFiles['posts.json'] = strToU8(JSON.stringify([]));
		zipFiles['identity.sigil'] = sigilBytes;
		zipFiles['assets.json'] = strToU8(JSON.stringify({ assets: assetsWithSignatures }, null, 2));
		for (const a of assetEntries) {
			zipFiles[a.zipPath] = a.data;
		}
		const zipped = await new Promise<Uint8Array>((resolve, reject) => {
			zip(zipFiles, { level: 1 }, (err, out) => {
				if (err) reject(err);
				else if (out === undefined) reject(new Error('Zip produced no output'));
				else resolve(out);
			});
		});
		const bundleBlob = new Blob([zipped as BlobPart], { type: 'application/zip' });
		const bundleFile = new File([bundleBlob], 'synthetic-import.syr');
		const aegisBundle = await createAegisBundle(seed, newPassword);
		const formData = new FormData();
		formData.append('bundle', bundleFile);
		formData.append('aegisBundle', JSON.stringify(aegisBundle));
		const res = await fetch('/api/identity/import', { method: 'POST', body: formData });
		if (!res.ok) {
			const err = await res.json().catch(() => ({}));
			throw new Error(err?.error?.message ?? err?.message ?? 'Import failed');
		}
	}

	async function handleImport() {
		if (!canImport() || !bundleFile) return;

		importing = true;
		try {
			if (hasSigil === true) {
				if (fileType === 'sigil') {
					// Bare .sigil file
					const text = await bundleFile.text();
					const sigil: SigilObject = JSON.parse(text);
					const seed = await decryptSigil(sigil, exportPassphrase);
					const pubRaw = decodePublicKey(sigil.pub);
					const did = deriveDid(pubRaw);
					const didDocument = buildDidDocument({
						did,
						publicKeyMultibase: sigil.pub
					}) as unknown as Record<string, unknown>;
					const identityBundle = {
						did,
						publicKey: sigil.pub,
						didDocument,
						delegatedKeys: [],
						profile: { displayName: 'Imported Identity', bio: undefined as string | undefined },
						exportedAt: new Date().toISOString()
					};
					const sigilBytes = strToU8(JSON.stringify(sigil, null, 2));
					await buildSyntheticBundleAndImport(sigil, seed, identityBundle, sigilBytes, []);
					toast.success('Identity imported successfully!');
					resetImportState();
					open = false;
					onSuccess?.();
					return;
				}
				if (fileType === 'persona') {
					// .persona file
					const arrayBuffer = await bundleFile.arrayBuffer();
					const zipBytes = new Uint8Array(arrayBuffer);
					const files = unzipSync(zipBytes);
					const sigilEntry = Object.keys(files).find((k) => k.endsWith('/identity.sigil'));
					const profileEntry = Object.keys(files).find((k) => k.endsWith('/profile.json'));
					if (!sigilEntry || !profileEntry || !files[sigilEntry] || !files[profileEntry]) {
						throw new Error('Invalid persona: missing identity.sigil or profile.json');
					}
					const sigil: SigilObject = JSON.parse(strFromU8(files[sigilEntry]));
					const profile = JSON.parse(strFromU8(files[profileEntry]));
					const seed = await decryptSigil(sigil, exportPassphrase);
					const pubRaw = decodePublicKey(sigil.pub);
					const did = deriveDid(pubRaw);
					const didDocument = buildDidDocument({
						did,
						publicKeyMultibase: sigil.pub
					}) as unknown as Record<string, unknown>;
					const avatarPath = profile.avatarUrl?.replace('./', '');
					const bannerPath = profile.bannerUrl?.replace('./', '');
					const personaDir = sigilEntry.replace('/identity.sigil', '');
					const assetEntries: Array<{
						zipPath: string;
						data: Uint8Array;
						filename: string;
						mimeType: string;
					}> = [];
					if (avatarPath) {
						const fullPath = `${personaDir}/${avatarPath}`;
						const data = files[fullPath];
						if (data) {
							assetEntries.push({
								zipPath: `assets/${avatarPath}`,
								data,
								filename: avatarPath,
								mimeType: inferMimeType(avatarPath)
							});
						}
					}
					if (bannerPath && bannerPath !== avatarPath) {
						const fullPath = `${personaDir}/${bannerPath}`;
						const data = files[fullPath];
						if (data) {
							assetEntries.push({
								zipPath: `assets/${bannerPath}`,
								data,
								filename: bannerPath,
								mimeType: inferMimeType(bannerPath)
							});
						}
					}
					const identityBundle = {
						did,
						publicKey: sigil.pub,
						didDocument,
						delegatedKeys: [],
						profile: {
							displayName: profile.displayName ?? 'Imported Identity',
							bio: profile.bio,
							avatarUrl: avatarPath ? `assets/${avatarPath}` : undefined,
							bannerUrl: bannerPath ? `assets/${bannerPath}` : undefined
						},
						exportedAt: profile.createdAt ?? new Date().toISOString()
					};
					const sigilBytes = strToU8(JSON.stringify(sigil, null, 2));
					await buildSyntheticBundleAndImport(
						sigil,
						seed,
						identityBundle,
						sigilBytes,
						assetEntries
					);
					toast.success('Identity imported successfully!');
					resetImportState();
					open = false;
					onSuccess?.();
					return;
				}
				// fileType === 'syr' — Full .syr import with Sigil
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
				resetImportState();
				open = false;
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
				resetImportState();
				open = false;
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
			resetImportState();
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
						<p>Restore from .syr (full/data-only), .persona, or .sigil backup.</p>
					{/if}
				</div>
			</Dialog.Description>
		</Dialog.Header>
		<div class="space-y-4 py-4">
			<div class="space-y-2">
				<label for="import-bundle" class="text-sm font-medium"
					>Bundle (.syr, .persona, .sigil, or .zip)</label
				>
				<Input
					id="import-bundle"
					type="file"
					accept=".syr,.zip,.persona,.sigil,.json"
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

			{#if fileType === 'syr' && trustState === 'verified'}
				<div
					class="flex items-start gap-2 rounded-md border border-green-600/40 bg-green-600/10 p-3"
				>
					<ShieldCheck class="mt-0.5 h-4 w-4 shrink-0 text-green-600" />
					<div class="space-y-0.5">
						<p class="text-sm font-medium text-green-700 dark:text-green-400">Verified backup</p>
						<p class="text-xs text-muted-foreground">
							Signed by this identity's root key. Every file and the rotation chain check out.
						</p>
					</div>
				</div>
			{:else if fileType === 'syr' && trustState === 'tampered'}
				<div
					class="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3"
				>
					<ShieldAlert class="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
					<div class="space-y-0.5">
						<p class="text-sm font-medium text-destructive">Tampered backup — import blocked</p>
						<p class="text-xs text-muted-foreground">
							{trustMessage ?? 'This bundle failed signature or integrity verification.'}
						</p>
					</div>
				</div>
			{:else if fileType === 'syr' && trustState === 'legacy_unsigned'}
				<div
					class="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3"
				>
					<ShieldQuestion class="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
					<div class="space-y-0.5">
						<p class="text-sm font-medium text-amber-700 dark:text-amber-400">
							Legacy unsigned backup
						</p>
						<p class="text-xs text-muted-foreground">
							Authenticity cannot be verified. Import only if you trust where this file came from.
						</p>
					</div>
				</div>
			{/if}

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
			<Button
				variant="outline"
				onclick={() => {
					resetImportState();
					open = false;
				}}
				disabled={importing}
			>
				Cancel
			</Button>
			{#if hasSigil === false && !importToken}
				<Button
					onclick={handleVerifyWithSyner}
					disabled={importing || !bundleFile || trustState === 'tampered'}
				>
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
