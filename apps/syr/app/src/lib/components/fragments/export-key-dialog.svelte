<script lang="ts">
	import * as Dialog from '@syr-is/ui/dialog';
	import { Button } from '@syr-is/ui/button';
	import { Input } from '@syr-is/ui/input';
	import { toast } from 'svelte-sonner';
	import { Loader2, CheckCircle } from 'lucide-svelte';
	import { zipSync, strToU8 } from 'fflate';
	import { decodePublicKey, deriveDid, personaIdFromPublicKey } from '@syr-is/crypto';
	import { createSigil } from '@syr-is/crypto/sigil';
	import { signPost, signAsset } from '$lib/services/bundle-signature-verification';
	import { seedHandler } from '$lib/services/seed-handler';
	import type { AegisBundle } from '@syr-is/crypto/aegis';
	import QRCode from 'qrcode';
	import { getIdentityStore, type IdentityContextClient } from '$lib/stores/identity.svelte';

	export type ExportType = 'syr' | 'sigil' | 'persona';

	let {
		open = $bindable(false),
		exportType = 'syr' as ExportType,
		identityContext: identityContextProp = null,
		onSuccess
	}: {
		open?: boolean;
		exportType?: ExportType;
		identityContext?: IdentityContextClient | null;
		onSuccess?: () => void;
	} = $props();

	const identityStoreCtx = getIdentityStore();
	const ctx = $derived(identityContextProp ?? identityStoreCtx.identityContext ?? null);
	const hasIdentity = $derived(ctx?.hasIdentity ?? false);
	const hasAegis = $derived(ctx?.hasAegis ?? false);
	const isIndependent = $derived(!!(hasIdentity && !hasAegis));
	const isIndependentSyr = $derived(isIndependent && exportType === 'syr');

	let exporting = $state(false);
	let creatingChallenge = $state(false);
	let exportToken = $state<string | null>(null);
	let passphrase = $state('');
	let confirmPassphrase = $state('');
	let unlockPassword = $state('');
	let bundle = $state<AegisBundle | null>(null);
	let step = $state<'choose' | 'unlock' | 'export' | 'verify'>('unlock');
	let isInitialOpen = $state(true);
	// Independent SYR: verify step
	let exportChallenge = $state<{
		challenge_id: string;
		deeplink_url: string;
		expires_in: number;
		qrDataUrl: string;
	} | null>(null);
	let exportHeartbeatSource: EventSource | null = null;
	let pendingDownload = $state<{ blob: Blob; filename: string } | null>(null);
	let exportGeneration = $state(0);

	const signatureValidated = $derived(!!exportToken);

	/** Syner QR/verify flow: no Aegis, or has Aegis but user chose Syner (exportChallenge set) */
	const showSynerFlow = $derived(
		exportType === 'syr' && (isIndependentSyr || exportChallenge !== null)
	);

	function determineInitialStep(
		exportTypeVal: ExportType,
		hasAegisVal: boolean
	): 'choose' | 'verify' | 'unlock' {
		if (exportTypeVal === 'syr') return hasAegisVal ? 'choose' : 'verify';
		return 'unlock';
	}

	function resetExportState() {
		exportGeneration++;
		bundle = null;
		unlockPassword = '';
		passphrase = '';
		confirmPassphrase = '';
		creatingChallenge = false;
		exportChallenge = null;
		exportToken = null;
		pendingDownload = null;
		disconnectExportHeartbeat();
	}

	$effect(() => {
		if (open) {
			if (isInitialOpen && ctx !== null) {
				isInitialOpen = false;
				step = determineInitialStep(exportType, hasAegis);
				if (exportType === 'syr') {
					exportChallenge = null;
					exportToken = null;
				}
			}
		} else {
			isInitialOpen = true;
			resetExportState();
		}
	});

	function disconnectExportHeartbeat() {
		if (exportHeartbeatSource) {
			exportHeartbeatSource.close();
			exportHeartbeatSource = null;
		}
	}

	/**
	 * Triggers a blob download. Chrome can stall as .crdownload if the URL is revoked
	 * too early or synthetic clicks lack rel=noopener. We use delayed revoke (5s).
	 */
	function triggerBlobDownload(blob: Blob, filename: string) {
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = filename;
		a.rel = 'noopener';
		a.target = '_blank';
		document.body.appendChild(a);
		a.click();
		setTimeout(() => {
			URL.revokeObjectURL(url);
			a.remove();
		}, 5000);
	}

	/**
	 * Synchronous handler — must not use async/await to preserve user gesture for download.
	 * Call only from a direct user click handler.
	 */
	function handleSaveFile() {
		const pending = pendingDownload;
		if (!pending) return;
		triggerBlobDownload(pending.blob, pending.filename);
		pendingDownload = null;
		exportToken = null;
		exportChallenge = null;
		passphrase = '';
		confirmPassphrase = '';
		unlockPassword = '';
		bundle = null;
		open = false;
		toast.success('Export saved to your device');
		onSuccess?.();
	}

	function canExport(): boolean {
		if (passphrase !== confirmPassphrase) return false;
		if (passphrase.length < 10) return false;
		return true;
	}

	/** Decode base64 to Uint8Array. Safer for large strings than Uint8Array.from(atob(...)). */
	function base64ToBytes(base64: string): Uint8Array {
		const binary = atob(base64);
		const bytes = new Uint8Array(binary.length);
		for (let i = 0; i < binary.length; i++) {
			bytes[i] = binary.charCodeAt(i);
		}
		return bytes;
	}

	/** Sanitize a zip_path to prevent path traversal (defense-in-depth for server-provided paths). */
	function sanitizeZipPath(raw: string): string {
		const normalized = raw.replace(/\\/g, '/');
		const segments = normalized.split('/').filter((s) => s && s !== '..' && s !== '.');
		return segments.join('/');
	}

	/** Sanitize API-provided asset filename to prevent path traversal in ZIP entries. */
	function sanitizeAssetFilename(
		raw: string | undefined,
		personaId: string,
		assetType: 'avatar' | 'banner'
	): string {
		const fallback = `persona-${personaId}-${assetType}.png`;
		if (!raw || typeof raw !== 'string') return fallback;
		const s = raw.trim();
		if (!s || /[/\\]|\.\.|^\./.test(s)) return fallback;
		const base = s.replace(/^.*[/\\]/, '');
		if (!base || /\.\./.test(base) || !/^[a-zA-Z0-9._-]+$/.test(base)) return fallback;
		return base;
	}

	function getDidShort(bundleSnapshot: AegisBundle | null): string {
		if (!bundleSnapshot?.pub) return 'export';
		try {
			const raw = decodePublicKey(bundleSnapshot.pub);
			const did = deriveDid(raw);
			return did.slice(8, 20);
		} catch {
			return 'export';
		}
	}

	const dialogTitle = $derived(
		exportType === 'syr' ? 'Export SYR' : exportType === 'sigil' ? 'Export Sigil' : 'Export Persona'
	);

	const exportWarningCopy = $derived(
		exportType === 'syr'
			? {
					heading:
						'⚠️ You are about to download your full SYR backup (posts, assets, identity — including your ROOT PRIVATE KEY encrypted as Sigil).',
					importHint: 'import this backup',
					storeHint: 'Store the backup and passphrase in a secure, offline location.'
				}
			: exportType === 'sigil'
				? {
						heading:
							'⚠️ You are about to download your Sigil file — an encrypted copy of your ROOT PRIVATE KEY.',
						importHint: 'import this sigil',
						storeHint: 'Store the Sigil and passphrase in a secure, offline location.'
					}
				: {
						heading:
							'⚠️ You are about to download your Persona (Sigil + profile + avatar/banner). The Sigil contains your encrypted ROOT PRIVATE KEY.',
						importHint: 'import this persona',
						storeHint: 'Store the persona bundle and passphrase in a secure, offline location.'
					}
	);

	const exportCtaCopy = $derived(
		exportType === 'syr'
			? 'I understand, download backup'
			: exportType === 'sigil'
				? 'I understand, download sigil'
				: 'I understand, download persona'
	);

	async function handleVerifyWithSyner() {
		if (!hasIdentity || exportType !== 'syr') return;
		const gen = exportGeneration;
		creatingChallenge = true;
		exportChallenge = null;
		exportToken = null;
		try {
			const res = await fetch('/api/identity/export-challenge', { method: 'POST' });
			if (gen !== exportGeneration) return;
			const data = await res.json();
			if (!res.ok)
				throw new Error(data.error_description ?? data.message ?? 'Failed to create challenge');
			const qrDataUrl = await QRCode.toDataURL(data.deeplink_url, { width: 256, margin: 2 });
			if (gen !== exportGeneration) return;
			exportChallenge = {
				challenge_id: data.challenge_id,
				deeplink_url: data.deeplink_url,
				expires_in: data.expires_in,
				qrDataUrl
			};
			const src = new EventSource(
				`/api/identity/export-heartbeat?challenge_id=${encodeURIComponent(data.challenge_id)}`
			);
			exportHeartbeatSource = src;
			src.addEventListener('verified', (e: MessageEvent) => {
				if (gen !== exportGeneration) return;
				try {
					const payload = JSON.parse(e.data || '{}');
					const token = payload.export_token;
					if (!token) return;
					disconnectExportHeartbeat();
					exportToken = token;
				} catch (err) {
					exportChallenge = null;
					exportToken = null;
					toast.error(err instanceof Error ? err.message : 'Verification failed');
				}
			});
			src.onerror = () => {
				disconnectExportHeartbeat();
				exportChallenge = null;
				exportToken = null;
				toast.error('Connection lost, please retry');
			};
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Failed to create challenge');
		} finally {
			creatingChallenge = false;
		}
	}

	async function handleDownloadAfterValidation() {
		const token = exportToken;
		if (!token) return;
		exporting = true;
		try {
			const result = await downloadDataOnlySyr(token);
			pendingDownload = result;
			toast.success('SYR data backup ready — keys stay in Syner.');
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Export failed');
		} finally {
			exporting = false;
		}
	}

	async function downloadDataOnlySyr(exportToken: string) {
		const res = await fetch('/api/identity/export-bundle-data', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ export_token: exportToken })
		});
		if (!res.ok) throw new Error('Failed to fetch export data');
		const resJson = await res.json();
		const data = resJson?.data ?? resJson;
		if (
			!data ||
			typeof data !== 'object' ||
			!data.manifest ||
			!data.identity ||
			!Array.isArray(data.posts) ||
			!Array.isArray(data.assets)
		) {
			throw new Error('Invalid export payload: missing manifest, identity, posts, or assets');
		}
		const didShort = data.identity.did?.slice(8, 20) ?? 'export';
		const timestamp = Date.now();
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
							signature?: string;
						}) => ({
							zip_path: a.zip_path,
							local_id: a.local_id,
							filename: a.filename,
							mime_type: a.mime_type,
							size: a.size,
							sha256: a.sha256,
							...(a.signature && { signature: a.signature })
						})
					)
				},
				null,
				2
			)
		);
		zipFiles['pinned_posts.json'] = strToU8(
			JSON.stringify(data.pinned_posts ?? { post_ids: [] }, null, 2)
		);
		function sanitizeZipPath(raw: string): string {
			let p = raw.replace(/\\/g, '/').replace(/^\/+/, '');
			const segments = p.split('/').filter((s) => s !== '.' && s !== '');
			const out: string[] = [];
			for (const seg of segments) {
				if (seg === '..') continue; // Drop traversal
				out.push(seg);
			}
			const joined = out.join('/');
			return joined || `assets/${raw.split('/').pop() || 'asset'}`;
		}
		for (const asset of data.assets ?? []) {
			if (asset.content_base64 && asset.zip_path) {
				const safeKey = sanitizeZipPath(asset.zip_path);
				zipFiles[safeKey] = base64ToBytes(asset.content_base64);
			}
		}
		const zipped = zipSync(zipFiles, { level: 1 });
		const filename = `syr-export-${didShort}-${timestamp}.syr`;
		const blob = new Blob([zipped as BlobPart], { type: 'application/zip' });
		return { blob, filename };
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
			const result = await seedHandler.run({
				bundle: b,
				password: pwd,
				action: async (seed) => {
					const didShort = getDidShort(b);
					const timestamp = Date.now();

					if (exportType === 'sigil') {
						const sigil = await createSigil(seed, passphrase);
						const blob = new Blob([JSON.stringify(sigil, null, 2)], {
							type: 'application/json'
						});
						const filename = `syr-sigil-${didShort}-${timestamp}.sigil`;
						return { blob, filename };
					}

					if (exportType === 'persona') {
						const dataRes = await fetch('/api/identity/export-persona-data');
						if (!dataRes.ok) throw new Error('Failed to fetch export data');
						const json = await dataRes.json();
						const data = json?.data ?? json;
						if (!data || typeof data !== 'object' || !data.identity) {
							throw new Error('Invalid export payload: missing identity');
						}

						const sigil = await createSigil(seed, passphrase);
						// Use sigil as single source of truth for identity-derived fields
						const personaId = personaIdFromPublicKey(sigil.pub);
						const pubRaw = decodePublicKey(sigil.pub);
						const pubB64 = btoa(String.fromCharCode(...new Uint8Array(pubRaw)));
						const did = deriveDid(pubRaw);

						const avatarFilename = sanitizeAssetFilename(data.avatar_filename, personaId, 'avatar');
						const bannerFilename = sanitizeAssetFilename(data.banner_filename, personaId, 'banner');

						const profile = {
							id: personaId,
							did,
							publicKey: pubB64,
							displayName: data.identity.profile?.displayName ?? '',
							bio: data.identity.profile?.bio ?? null,
							avatarUrl: data.avatar_base64 ? `./${avatarFilename}` : null,
							bannerUrl: data.banner_base64 ? `./${bannerFilename}` : null,
							createdAt: data.identity.exportedAt ?? new Date().toISOString()
						};

						const zipFiles: Record<string, Uint8Array> = {};
						zipFiles[`${personaId}/identity.sigil`] = strToU8(JSON.stringify(sigil, null, 2));
						zipFiles[`${personaId}/profile.json`] = strToU8(JSON.stringify(profile, null, 2));
						if (data.avatar_base64) {
							zipFiles[`${personaId}/${avatarFilename}`] = base64ToBytes(data.avatar_base64);
						}
						if (data.banner_base64) {
							zipFiles[`${personaId}/${bannerFilename}`] = base64ToBytes(data.banner_base64);
						}

						const zipped = zipSync(zipFiles, { level: 1 });
						const filename = `syr-persona-${didShort}-${timestamp}.persona`;
						const blob = new Blob([zipped as BlobPart], { type: 'application/zip' });
						return { blob, filename };
					}

					// exportType === 'syr'
					const dataRes = await fetch('/api/identity/export-bundle-data');
					if (!dataRes.ok) throw new Error('Failed to fetch export data');
					const resJson = await dataRes.json();
					const data = resJson?.data ?? resJson;
					if (
						!data ||
						typeof data !== 'object' ||
						!data.manifest ||
						!data.identity ||
						!Array.isArray(data.posts) ||
						!Array.isArray(data.assets)
					) {
						throw new Error('Invalid export payload: missing manifest, identity, posts, or assets');
					}

					const sigil = await createSigil(seed, passphrase);
					const did = data.identity?.did;
					if (!did || typeof did !== 'string') {
						throw new Error('Invalid export payload: missing or invalid identity DID');
					}

					const validPosts = data.posts.filter((p: Record<string, unknown>, i: number) => {
						if (
							typeof p?.local_id !== 'string' ||
							typeof p?.type !== 'string' ||
							typeof p?.visibility !== 'string' ||
							typeof p?.status !== 'string' ||
							(p?.created_at != null && typeof p.created_at !== 'string')
						) {
							console.warn(
								`[export] Skipping invalid post at index ${i}: missing local_id, type, visibility, status, or created_at`
							);
							return false;
						}
						return true;
					});

					const validAssets = data.assets.filter(
						(
							a: {
								zip_path?: string;
								local_id?: string;
								filename?: string;
								mime_type?: string;
								size?: number;
								sha256?: string;
							},
							i: number
						) => {
							if (
								typeof a?.zip_path !== 'string' ||
								typeof a?.local_id !== 'string' ||
								typeof a?.filename !== 'string' ||
								typeof a?.mime_type !== 'string' ||
								typeof a?.size !== 'number' ||
								typeof a?.sha256 !== 'string'
							) {
								console.warn(
									`[export] Skipping invalid asset at index ${i}: missing zip_path, local_id, filename, mime_type, size, or sha256`
								);
								return false;
							}
							return true;
						}
					);

					// Sign each post and its assets
					const signedPosts = await Promise.all(
						validPosts.map((p: Record<string, unknown>) =>
							signPost(did, p as Parameters<typeof signPost>[1], seed)
						)
					);

					// Sign standalone assets
					const signedAssets = await Promise.all(
						validAssets.map(
							(a: {
								zip_path: string;
								local_id: string;
								filename: string;
								mime_type: string;
								size: number;
								sha256: string;
							}) => signAsset(did, a, seed)
						)
					);

					const zipFiles: Record<string, Uint8Array> = {};
					zipFiles['manifest.json'] = strToU8(JSON.stringify(data.manifest, null, 2));
					zipFiles['identity.json'] = strToU8(JSON.stringify(data.identity, null, 2));
					zipFiles['posts.json'] = strToU8(JSON.stringify(signedPosts, null, 2));
					zipFiles['assets.json'] = strToU8(
						JSON.stringify(
							{
								assets: signedAssets.map((a) => ({
									zip_path: a.zip_path,
									local_id: a.local_id,
									filename: a.filename,
									mime_type: a.mime_type,
									size: a.size,
									sha256: a.sha256,
									signature: a.signature
								}))
							},
							null,
							2
						)
					);
					zipFiles['pinned_posts.json'] = strToU8(JSON.stringify(data.pinned_posts, null, 2));
					zipFiles['identity.sigil'] = strToU8(JSON.stringify(sigil, null, 2));

					for (const asset of validAssets) {
						if (asset.content_base64 && asset.zip_path) {
							const safePath = sanitizeZipPath(asset.zip_path);
							if (safePath) {
								zipFiles[safePath] = base64ToBytes(asset.content_base64);
							}
						}
					}

					const zipped = zipSync(zipFiles, { level: 1 });
					const filename = `syr-export-${didShort}-${timestamp}.syr`;
					const blob = new Blob([zipped as BlobPart], { type: 'application/zip' });
					return { blob, filename };
				}
			});

			pendingDownload = result;
			toast.success(
				exportType === 'syr'
					? 'SYR backup ready — store it and your passphrase securely!'
					: exportType === 'sigil'
						? 'Sigil ready — store it and your passphrase securely!'
						: 'Persona ready — store it and your passphrase securely!'
			);
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
			<Dialog.Title>{dialogTitle}</Dialog.Title>
			<Dialog.Description>
				{#if ctx === null}
					<p class="text-sm text-muted-foreground">Loading...</p>
				{:else if pendingDownload}
					<p class="text-sm text-muted-foreground">Click Save file to download your export.</p>
				{:else if showSynerFlow}
					<p class="text-sm text-muted-foreground">
						You are about to download your SYR data backup (profile, posts, assets). Your keys are
						managed in Syner — this backup does not include them. Scan the QR or open the link with
						Syner to verify.
					</p>
				{:else if step === 'choose'}
					<p class="text-sm text-muted-foreground">
						Choose how to verify your export. Unlock with password for a full backup (includes
						keys). Verify with Syner for a data-only backup (keys stay in Syner).
					</p>
				{:else if step === 'unlock'}
					<p class="text-sm text-muted-foreground">
						Enter your account password to unlock your identity. The seed was encrypted at login and
						needs to be decrypted before export.
					</p>
				{:else}
					<div class="space-y-2 text-sm">
						<p>{exportWarningCopy.heading}</p>
						<ul class="list-inside list-disc space-y-1 text-muted-foreground">
							<li>
								Choose a strong passphrase (min 10 chars) — you will need it to {exportWarningCopy.importHint}.
							</li>
							<li>{exportWarningCopy.storeHint}</li>
							<li>Anyone with both can fully impersonate your identity.</li>
						</ul>
					</div>
				{/if}
			</Dialog.Description>
		</Dialog.Header>
		<div class="space-y-4 py-4">
			{#if ctx === null}
				<p class="flex items-center gap-2 text-sm text-muted-foreground">
					<Loader2 class="h-4 w-4 animate-spin" />
					Loading...
				</p>
			{:else if pendingDownload}
				<p class="text-sm text-muted-foreground">
					Your export is ready. Click Save file below to download.
				</p>
			{:else if exportChallenge}
				<div class="flex flex-col items-center gap-4">
					<img
						src={exportChallenge.qrDataUrl}
						alt="Scan with Syner"
						class="h-64 w-64 rounded-lg border"
					/>
					<a
						href={exportChallenge.deeplink_url}
						class="text-sm text-primary underline hover:no-underline"
					>
						Open in Syner
					</a>
					{#if signatureValidated}
						<div class="flex items-center gap-2 text-green-600">
							<CheckCircle class="h-5 w-5 shrink-0" />
							<span>Download request validated</span>
						</div>
					{:else}
						<p class="text-xs text-muted-foreground">Scan or open link, then sign in Syner.</p>
					{/if}
				</div>
			{:else if step === 'choose'}
				<div class="flex flex-col gap-3">
					<Button
						variant="outline"
						class="w-full justify-start"
						onclick={() => (step = 'unlock')}
						disabled={exporting}
					>
						Unlock with password
					</Button>
					<Button
						variant="outline"
						class="w-full justify-start"
						onclick={handleVerifyWithSyner}
						disabled={creatingChallenge}
					>
						{#if creatingChallenge}
							<Loader2 class="mr-2 h-4 w-4 animate-spin" />
							Creating...
						{:else}
							Verify with Syner
						{/if}
					</Button>
				</div>
			{:else if isIndependentSyr}
				<p class="text-sm text-muted-foreground">
					Click below to generate a QR code. Scan it with Syner to verify you control this identity.
				</p>
			{:else if step === 'unlock'}
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
			{#if pendingDownload}
				<Button variant="destructive" onclick={handleSaveFile}>Save file</Button>
			{:else if step === 'choose'}
				<!-- Choice is in content; footer only has Cancel -->
			{:else if showSynerFlow}
				{#if !exportChallenge}
					<Button onclick={handleVerifyWithSyner} disabled={creatingChallenge}>
						{#if creatingChallenge}
							<Loader2 class="mr-2 h-4 w-4 animate-spin" />
							Creating...
						{:else}
							Verify with Syner
						{/if}
					</Button>
				{:else if signatureValidated}
					<Button onclick={handleDownloadAfterValidation} disabled={exporting}>
						{#if exporting}
							<Loader2 class="mr-2 h-4 w-4 animate-spin" />
							Download...
						{:else}
							Download
						{/if}
					</Button>
				{:else}
					<Button disabled>Waiting for Syner...</Button>
				{/if}
			{:else if step === 'unlock'}
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
						{exportCtaCopy}
					{/if}
				</Button>
			{/if}
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
