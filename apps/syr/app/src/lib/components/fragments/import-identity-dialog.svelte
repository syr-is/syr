<script lang="ts">
	import * as Dialog from '@syr-is/ui/dialog';
	import { Button } from '@syr-is/ui/button';
	import { Input } from '@syr-is/ui/input';
	import { toast } from 'svelte-sonner';
	import { Loader2 } from 'lucide-svelte';
	import { unzipSync, strFromU8, zip, strToU8 } from 'fflate';
	import { decryptSigil } from '@syr-is/crypto/sigil';
	import { createAegisBundle } from '@syr-is/crypto/aegis';
	import { decodePublicKey, deriveDid } from '@syr-is/crypto';
import { computeSha256Hex } from '@syr-is/utils';
	import { buildDidDocument } from '@syr-is/did';
	import { signAsset } from '$lib/services/bundle-signature-verification';
	import type { SigilObject } from '@syr-is/crypto/sigil';
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

	function resetImportState() {
		bundleFile = null;
		exportPassphrase = '';
		newPassword = '';
		confirmPassword = '';
		hasSigil = null;
		fileType = null;
		importChallenge = null;
		importToken = null;
		disconnectImportHeartbeat();
	}

	async function onFileSelect(e: Event) {
		const f = (e.target as HTMLInputElement).files?.[0];
		bundleFile = f ?? null;
		hasSigil = null;
		fileType = null;
		importChallenge = null;
		importToken = null;
		disconnectImportHeartbeat();
		if (!f) return;
		try {
			const ext = f.name.toLowerCase().split('.').pop() ?? '';
			if (ext === 'sigil' || ext === 'json') {
				const text = await f.text();
				let json: unknown;
				try {
					json = JSON.parse(text);
				} catch {
					toast.error(ext === 'sigil' ? 'Invalid Sigil file' : 'Invalid JSON');
					return;
				}
				if (
					json &&
					typeof json === 'object' &&
					'v' in json &&
					'kdf' in json &&
					'enc' in json &&
					'pub' in json
				) {
					hasSigil = true;
					fileType = 'sigil';
				} else {
					toast.error(ext === 'sigil' ? 'Invalid Sigil file' : 'File is not a Sigil');
				}
				return;
			}
			const arrayBuffer = await f.arrayBuffer();
			const zipBytes = new Uint8Array(arrayBuffer);
			const files = unzipSync(zipBytes);
			const hasRootSigil = !!files['identity.sigil'];
			const hasSyrStructure =
				!!files['manifest.json'] && !!files['identity.json'] && !!files['posts.json'];
			const personaEntry = Object.keys(files).find((k) => k.endsWith('/identity.sigil'));
			const hasProfileJson = Object.keys(files).some((k) => k.endsWith('/profile.json'));
			const hasPersonaStructure = !!personaEntry && hasProfileJson;
			if (hasSyrStructure) {
				fileType = 'syr';
				hasSigil = hasRootSigil;
			} else if (hasPersonaStructure) {
				fileType = 'persona';
				hasSigil = true;
			} else {
				hasSigil = null;
				fileType = null;
				toast.error('Unrecognized file format. Expected .syr, .persona, or .sigil.');
			}
		} catch (err) {
			hasSigil = null;
			fileType = null;
			toast.error(err instanceof SyntaxError ? 'Invalid JSON' : 'Could not read bundle file');
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
					: a.data.buffer.slice(
							a.data.byteOffset,
							a.data.byteOffset + a.data.byteLength
						) as ArrayBuffer;
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
