<script lang="ts">
	import { resolve } from '$app/paths';
	import { goto } from '$app/navigation';
	import * as Card from '@syr-is/ui/card';
	import { Button } from '@syr-is/ui/button';
	import { Input } from '@syr-is/ui/input';
	import { toast } from 'svelte-sonner';
	import { Loader2 } from 'lucide-svelte';
	import ImportIdentityDialog from '$lib/components/fragments/import-identity-dialog.svelte';
	import type { PageData } from './$types';
	import { strToU8 } from 'fflate';
	import { analyzeBackupFile, createSyntheticZip } from '$lib/utils/migrate-file';
	import { decodePublicKey, deriveDid } from '@syr-is/crypto';
	import { buildDidDocument } from '@syr-is/did';

	let { data }: { data: PageData } = $props();

	// Migration flow (not logged in)
	let migrationFile = $state<File | null>(null);
	let migrationExportPassphrase = $state('');
	let migrationNewPassword = $state('');
	let migrationConfirmPassword = $state('');
	let migrationUsername = $state('');
	let migrationDisplayName = $state('');
	let migrationHasSigil = $state<boolean | null>(null);
	/** 'raw_sigil' = raw .sigil file; 'zip' = full .syr; 'persona' = .persona (needs synthetic bundle) */
	let migrationFileType = $state<'raw_sigil' | 'zip' | 'persona' | null>(null);
	let migrationImportToken = $state<string | null>(null);
	let migrationImportChallenge = $state<{
		challenge_id: string;
		deeplink_url: string;
		qrDataUrl: string;
	} | null>(null);
	let migrationLoading = $state(false);
	let migrationHeartbeatSource: EventSource | null = null;

	// Sync flow (logged in, has identity)
	let syncFile = $state<File | null>(null);
	let syncExportPassphrase = $state('');
	let syncNewPassword = $state('');
	let syncHasSigil = $state<boolean | null>(null);
	/** 'raw_sigil' = raw .sigil file; 'zip' = full .syr; 'persona' = .persona (needs synthetic bundle) */
	let syncFileType = $state<'raw_sigil' | 'zip' | 'persona' | null>(null);
	let syncImportToken = $state<string | null>(null);
	let syncImportChallenge = $state<{
		challenge_id: string;
		deeplink_url: string;
		qrDataUrl: string;
	} | null>(null);
	let syncLoading = $state(false);
	let syncHeartbeatSource: EventSource | null = null;

	// Import dialog (logged in, no identity)
	let importDialogOpen = $state(false);

	const isMigration = $derived(!data.user);
	const isSync = $derived(!!data.user && !!data.hasIdentity);
	const isImport = $derived(!!data.user && !data.hasIdentity);

	function disconnectHeartbeat(src: EventSource | null) {
		if (src) {
			src.close();
		}
	}

	function canSubmitMigration(): boolean {
		if (!migrationFile) return false;
		if (migrationUsername.length < 2) return false;
		if (migrationNewPassword.length < 8) return false;
		if (migrationNewPassword !== migrationConfirmPassword) return false;
		if (migrationHasSigil === false) return !!migrationImportToken;
		if (migrationHasSigil === true) {
			return migrationExportPassphrase.length >= 10;
		}
		return false;
	}

	// Migration: detect file type on select
	async function onMigrationFileSelect(e: Event) {
		const f = (e.target as HTMLInputElement).files?.[0];
		migrationFile = f ?? null;
		migrationHasSigil = null;
		migrationFileType = null;
		migrationImportToken = null;
		migrationImportChallenge = null;
		disconnectHeartbeat(migrationHeartbeatSource);
		migrationHeartbeatSource = null;
		if (!f) return;
		const result = await analyzeBackupFile(f);
		if (result.error) {
			toast.error(result.error);
			return;
		}
		migrationHasSigil = result.hasSigil;
		migrationFileType = result.fileType;
	}

	async function handleMigrationVerifySyner() {
		if (!migrationFile || migrationHasSigil !== false) return;
		migrationLoading = true;
		try {
			const { unzipSync, strFromU8 } = await import('fflate');
			const ab = await migrationFile.arrayBuffer();
			const files = unzipSync(new Uint8Array(ab));
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
			const res = await fetch('/api/identity/import-challenge-public', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ did })
			});
			const apiData = await res.json();
			if (!res.ok) throw new Error(apiData.error_description ?? apiData.message ?? 'Failed');
			const QRCode = (await import('qrcode')).default;
			const qrDataUrl = await QRCode.toDataURL(apiData.deeplink_url, { width: 256, margin: 2 });
			migrationImportChallenge = {
				challenge_id: apiData.challenge_id,
				deeplink_url: apiData.deeplink_url,
				qrDataUrl
			};
			const src = new EventSource(
				`/api/identity/import-heartbeat?challenge_id=${encodeURIComponent(apiData.challenge_id)}`
			);
			migrationHeartbeatSource = src;
			src.addEventListener('verified', (ev: MessageEvent) => {
				try {
					const payload = JSON.parse(ev.data || '{}');
					if (payload.import_token) {
						migrationImportToken = payload.import_token;
						disconnectHeartbeat(src);
						migrationHeartbeatSource = null;
					}
				} catch {
					/* ignore */
				}
			});
			src.onerror = () => {
				disconnectHeartbeat(src);
				migrationHeartbeatSource = null;
				toast.error('Connection lost — please retry migration verification');
			};
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Failed');
		} finally {
			migrationLoading = false;
		}
	}

	async function handleMigrationSubmit() {
		if (!canSubmitMigration() || !migrationFile) return;
		if (migrationHasSigil === false && !migrationImportToken) {
			toast.error('Please verify with Syner first to get an import token.');
			return;
		}
		migrationLoading = true;
		try {
			const formData = new FormData();
			formData.append('username', migrationUsername);
			formData.append('display_name', migrationDisplayName || migrationUsername);
			formData.append('password', migrationNewPassword);
			formData.append('bundle', migrationFile);
			if (migrationHasSigil === true) {
				const { decryptSigil } = await import('@syr-is/crypto/sigil');
				const { createAegisBundle } = await import('@syr-is/crypto/aegis');
				let sigilStr: string;
				let bundleFile: File;
				if (migrationFileType === 'raw_sigil') {
					sigilStr = await migrationFile.text();
					const sigil = JSON.parse(sigilStr);
					let seed: Uint8Array | null = null;
					try {
						seed = await decryptSigil(sigil, migrationExportPassphrase);
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
						const manifest = {
							version: 1 as const,
							did,
							exportedAt: new Date().toISOString(),
							postCount: 0,
							assetCount: 0
						};
						const zipFiles: Record<string, Uint8Array> = {};
						zipFiles['manifest.json'] = strToU8(JSON.stringify(manifest, null, 2));
						zipFiles['identity.json'] = strToU8(JSON.stringify(identityBundle, null, 2));
						zipFiles['posts.json'] = strToU8(JSON.stringify([]));
						zipFiles['assets.json'] = strToU8(JSON.stringify({ assets: [] }));
						zipFiles['identity.sigil'] = strToU8(sigilStr);
						zipFiles['pinned_posts.json'] = strToU8(JSON.stringify({ post_ids: [] }));
						const zipped = await createSyntheticZip(zipFiles);
						bundleFile = new File([new Uint8Array(zipped)], 'synthetic-migration.syr', {
							type: 'application/zip'
						});
						const aegisBundle = await createAegisBundle(seed, migrationNewPassword);
						formData.set('bundle', bundleFile);
						formData.append('aegisBundle', JSON.stringify(aegisBundle));
					} finally {
						if (seed) seed.fill(0);
					}
				} else if (migrationFileType === 'persona') {
					const { unzipSync, strFromU8 } = await import('fflate');
					const files = unzipSync(new Uint8Array(await migrationFile.arrayBuffer()));
					const sigilEntry = Object.keys(files).find((k) => k.endsWith('/identity.sigil'));
					const profileEntry = Object.keys(files).find((k) => k.endsWith('/profile.json'));
					if (!sigilEntry || !profileEntry || !files[sigilEntry] || !files[profileEntry]) {
						throw new Error('Invalid persona: missing identity.sigil or profile.json');
					}
					sigilStr = strFromU8(files[sigilEntry]);
					const sigil = JSON.parse(sigilStr);
					const profile = JSON.parse(strFromU8(files[profileEntry]));
					let seed: Uint8Array | null = null;
					try {
						seed = await decryptSigil(sigil, migrationExportPassphrase);
						const pubRaw = decodePublicKey(sigil.pub);
						const did = deriveDid(pubRaw);
						const didDocument = buildDidDocument({
							did,
							publicKeyMultibase: sigil.pub
						}) as unknown as Record<string, unknown>;
						const avatarPath = profile.avatarUrl?.replace('./', '');
						const bannerPath = profile.bannerUrl?.replace('./', '');
						const personaDir = sigilEntry.replace('/identity.sigil', '');
						const zipFiles: Record<string, Uint8Array> = {};
						zipFiles['manifest.json'] = strToU8(
							JSON.stringify(
								{
									version: 1,
									did,
									exportedAt: new Date().toISOString(),
									postCount: 0,
									assetCount:
										(avatarPath ? 1 : 0) + (bannerPath && bannerPath !== avatarPath ? 1 : 0)
								},
								null,
								2
							)
						);
						zipFiles['identity.json'] = strToU8(
							JSON.stringify(
								{
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
								},
								null,
								2
							)
						);
						zipFiles['posts.json'] = strToU8(JSON.stringify([]));
						zipFiles['assets.json'] = strToU8(JSON.stringify({ assets: [] }, null, 2));
						zipFiles['identity.sigil'] = strToU8(sigilStr);
						zipFiles['pinned_posts.json'] = strToU8(JSON.stringify({ post_ids: [] }));
						if (avatarPath) {
							const fullPath = `${personaDir}/${avatarPath}`;
							const data = files[fullPath];
							if (data) zipFiles[`assets/${avatarPath}`] = data;
						}
						if (bannerPath && bannerPath !== avatarPath) {
							const fullPath = `${personaDir}/${bannerPath}`;
							const data = files[fullPath];
							if (data) zipFiles[`assets/${bannerPath}`] = data;
						}
						const zipped = await createSyntheticZip(zipFiles);
						bundleFile = new File([new Uint8Array(zipped)], 'synthetic-migration.syr', {
							type: 'application/zip'
						});
						const aegisBundle = await createAegisBundle(seed, migrationNewPassword);
						formData.set('bundle', bundleFile);
						formData.append('aegisBundle', JSON.stringify(aegisBundle));
					} finally {
						if (seed) seed.fill(0);
					}
				} else {
					const { unzipSync, strFromU8 } = await import('fflate');
					const files = unzipSync(new Uint8Array(await migrationFile.arrayBuffer()));
					const rootSigil = files['identity.sigil'];
					if (rootSigil) {
						sigilStr = strFromU8(rootSigil);
					} else {
						const personaEntry = Object.keys(files).find((k) => k.endsWith('/identity.sigil'));
						if (!personaEntry || !files[personaEntry]) {
							throw new Error('No identity.sigil found');
						}
						sigilStr = strFromU8(files[personaEntry]);
					}
					const sigil = JSON.parse(sigilStr);
					let seed: Uint8Array | null = null;
					try {
						seed = await decryptSigil(sigil, migrationExportPassphrase);
						const aegisBundle = await createAegisBundle(seed, migrationNewPassword);
						formData.append('aegisBundle', JSON.stringify(aegisBundle));
					} finally {
						if (seed) seed.fill(0);
					}
				}
			} else if (migrationImportToken) {
				formData.append('import_token', migrationImportToken);
			}
			const res = await fetch('/api/auth/register-with-import', { method: 'POST', body: formData });
			const result = await res.json();
			if (!res.ok) {
				throw new Error(result.error?.message ?? result.message ?? 'Registration failed');
			}
			toast.success('Migration complete! Welcome.');
			await goto(resolve('/'));
			window.location.reload();
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Migration failed');
		} finally {
			migrationLoading = false;
		}
	}

	// Sync flow file select
	async function onSyncFileSelect(e: Event) {
		const f = (e.target as HTMLInputElement).files?.[0];
		syncFile = f ?? null;
		syncHasSigil = null;
		syncFileType = null;
		syncImportToken = null;
		syncImportChallenge = null;
		disconnectHeartbeat(syncHeartbeatSource);
		syncHeartbeatSource = null;
		if (!f) return;
		const result = await analyzeBackupFile(f);
		if (result.error) {
			toast.error(result.error);
			return;
		}
		syncHasSigil = result.hasSigil;
		syncFileType = result.fileType;
	}

	async function handleSyncVerifySyner() {
		if (!syncFile || syncHasSigil !== false || !data.did) return;
		syncLoading = true;
		try {
			const { unzipSync, strFromU8 } = await import('fflate');
			const files = unzipSync(new Uint8Array(await syncFile.arrayBuffer()));
			const identityJson = files['identity.json'];
			if (!identityJson) {
				toast.error('Bundle must contain identity.json');
				return;
			}
			const identity = JSON.parse(strFromU8(identityJson));
			const did = identity?.did;
			if (did !== data.did) {
				toast.error('This backup does not match your identity.');
				return;
			}
			const res = await fetch('/api/identity/import-challenge', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ did })
			});
			const apiData = await res.json();
			if (!res.ok) throw new Error(apiData.error_description ?? apiData.message ?? 'Failed');
			const QRCode = (await import('qrcode')).default;
			const qrDataUrl = await QRCode.toDataURL(apiData.deeplink_url, { width: 256, margin: 2 });
			syncImportChallenge = {
				challenge_id: apiData.challenge_id,
				deeplink_url: apiData.deeplink_url,
				qrDataUrl
			};
			const src = new EventSource(
				`/api/identity/import-heartbeat?challenge_id=${encodeURIComponent(apiData.challenge_id)}`
			);
			syncHeartbeatSource = src;
			src.addEventListener('verified', (ev: MessageEvent) => {
				try {
					const payload = JSON.parse(ev.data || '{}');
					if (payload.import_token) {
						syncImportToken = payload.import_token;
						disconnectHeartbeat(src);
						syncHeartbeatSource = null;
					}
				} catch {
					/* ignore */
				}
			});
			src.onerror = () => {
				disconnectHeartbeat(src);
				syncHeartbeatSource = null;
				toast.error('Connection lost — please retry sync verification');
			};
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Failed');
		} finally {
			syncLoading = false;
		}
	}

	function canSubmitSync(): boolean {
		if (!syncFile || !data.did) return false;
		if (syncHasSigil === false) return !!syncImportToken;
		if (syncHasSigil === true)
			return syncExportPassphrase.length >= 10 && syncNewPassword.length >= 8;
		return false;
	}

	async function handleSyncSubmit() {
		if (!canSubmitSync() || !syncFile) return;
		syncLoading = true;
		try {
			const formData = new FormData();
			formData.append('bundle', syncFile);
			if (syncHasSigil === true) {
				let sigilStr: string;
				if (syncFileType === 'raw_sigil') {
					sigilStr = await syncFile.text();
				} else {
					const { unzipSync, strFromU8 } = await import('fflate');
					const files = unzipSync(new Uint8Array(await syncFile.arrayBuffer()));
					const rootSigil = files['identity.sigil'];
					const personaEntry = Object.keys(files).find((k) => k.endsWith('/identity.sigil'));
					const sigilData = rootSigil ?? (personaEntry ? files[personaEntry] : null);
					if (!sigilData) throw new Error('No identity.sigil found');
					sigilStr = strFromU8(sigilData);
				}
				const { decryptSigil } = await import('@syr-is/crypto/sigil');
				const { createAegisBundle } = await import('@syr-is/crypto/aegis');
				const sigil = JSON.parse(sigilStr);
				let seed: Uint8Array | null = null;
				try {
					seed = await decryptSigil(sigil, syncExportPassphrase);
					if (syncFileType === 'raw_sigil') {
						const pubRaw = decodePublicKey(sigil.pub);
						const did = deriveDid(pubRaw);
						if (did !== data.did) {
							throw new Error('This backup does not match your identity.');
						}
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
						const manifest = {
							version: 1 as const,
							did,
							exportedAt: new Date().toISOString(),
							postCount: 0,
							assetCount: 0
						};
						const zipFiles: Record<string, Uint8Array> = {};
						zipFiles['manifest.json'] = strToU8(JSON.stringify(manifest, null, 2));
						zipFiles['identity.json'] = strToU8(JSON.stringify(identityBundle, null, 2));
						zipFiles['posts.json'] = strToU8(JSON.stringify([]));
						zipFiles['assets.json'] = strToU8(JSON.stringify({ assets: [] }));
						zipFiles['identity.sigil'] = strToU8(sigilStr);
						zipFiles['pinned_posts.json'] = strToU8(JSON.stringify({ post_ids: [] }));
						const zipped = await createSyntheticZip(zipFiles);
						const bundleFile = new File([new Uint8Array(zipped)], 'synthetic-sync.syr', {
							type: 'application/zip'
						});
						formData.set('bundle', bundleFile);
					} else if (syncFileType === 'persona') {
						const { unzipSync, strFromU8 } = await import('fflate');
						const files = unzipSync(new Uint8Array(await syncFile.arrayBuffer()));
						const sigilEntry = Object.keys(files).find((k) => k.endsWith('/identity.sigil'));
						const profileEntry = Object.keys(files).find((k) => k.endsWith('/profile.json'));
						if (!sigilEntry || !profileEntry || !files[sigilEntry] || !files[profileEntry]) {
							throw new Error('Invalid persona: missing identity.sigil or profile.json');
						}
						const profile = JSON.parse(strFromU8(files[profileEntry]));
						const pubRaw = decodePublicKey(sigil.pub);
						const did = deriveDid(pubRaw);
						if (did !== data.did) {
							throw new Error('This backup does not match your identity.');
						}
						const didDocument = buildDidDocument({
							did,
							publicKeyMultibase: sigil.pub
						}) as unknown as Record<string, unknown>;
						const avatarPath = profile.avatarUrl?.replace('./', '');
						const bannerPath = profile.bannerUrl?.replace('./', '');
						const personaDir = sigilEntry.replace('/identity.sigil', '');
						const zipFiles: Record<string, Uint8Array> = {};
						zipFiles['manifest.json'] = strToU8(
							JSON.stringify(
								{
									version: 1,
									did,
									exportedAt: new Date().toISOString(),
									postCount: 0,
									assetCount:
										(avatarPath ? 1 : 0) + (bannerPath && bannerPath !== avatarPath ? 1 : 0)
								},
								null,
								2
							)
						);
						zipFiles['identity.json'] = strToU8(
							JSON.stringify(
								{
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
								},
								null,
								2
							)
						);
						zipFiles['posts.json'] = strToU8(JSON.stringify([]));
						zipFiles['assets.json'] = strToU8(JSON.stringify({ assets: [] }, null, 2));
						zipFiles['identity.sigil'] = strToU8(sigilStr);
						zipFiles['pinned_posts.json'] = strToU8(JSON.stringify({ post_ids: [] }));
						if (avatarPath) {
							const fullPath = `${personaDir}/${avatarPath}`;
							const data = files[fullPath];
							if (data) zipFiles[`assets/${avatarPath}`] = data;
						}
						if (bannerPath && bannerPath !== avatarPath) {
							const fullPath = `${personaDir}/${bannerPath}`;
							const data = files[fullPath];
							if (data) zipFiles[`assets/${bannerPath}`] = data;
						}
						const zipped = await createSyntheticZip(zipFiles);
						const bundleFile = new File([new Uint8Array(zipped)], 'synthetic-sync.syr', {
							type: 'application/zip'
						});
						formData.set('bundle', bundleFile);
					}
					const aegisBundle = await createAegisBundle(seed, syncNewPassword);
					formData.append('aegisBundle', JSON.stringify(aegisBundle));
				} finally {
					if (seed) seed.fill(0);
				}
			} else {
				formData.append('import_token', syncImportToken!);
			}
			const res = await fetch('/api/identity/sync-from-backup', { method: 'POST', body: formData });
			const result = await res.json();
			if (!res.ok) {
				throw new Error(result.error?.message ?? result.message ?? 'Sync failed');
			}
			toast.success('Sync complete!');
			await goto(resolve('/'));
			window.location.reload();
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Sync failed');
		} finally {
			syncLoading = false;
		}
	}

	function openImportDialog() {
		importDialogOpen = true;
	}
</script>

<div class="flex min-h-full flex-col items-center justify-center p-4">
	<div class="w-full max-w-lg space-y-6">
		{#if isMigration}
			<Card.Root>
				<Card.Header>
					<Card.Title>Migrate your identity</Card.Title>
					<Card.Description>
						Import your identity from a backup and create your account. Upload a .syr, .persona, or
						.sigil file, then complete registration.
					</Card.Description>
				</Card.Header>
				<Card.Content class="space-y-4">
					<div>
						<label for="migration-file" class="text-sm font-medium">Backup file</label>
						<Input
							id="migration-file"
							type="file"
							accept=".syr,.zip,.persona,.sigil,.json"
							onchange={onMigrationFileSelect}
							disabled={migrationLoading}
						/>
						{#if migrationFile}
							<p class="mt-1 text-xs text-muted-foreground">
								{migrationFile.name}
								{#if migrationHasSigil === true}
									— Full backup (with Sigil)
								{:else if migrationHasSigil === false}
									— Data-only (verify with Syner)
								{/if}
							</p>
						{/if}
					</div>

					{#if migrationHasSigil === true}
						<div>
							<label for="migration-passphrase" class="text-sm font-medium"
								>Export passphrase (min 10 chars)</label
							>
							<Input
								id="migration-passphrase"
								type="password"
								bind:value={migrationExportPassphrase}
								placeholder="••••••••"
								disabled={migrationLoading}
							/>
						</div>
					{:else if migrationHasSigil === false}
						{#if migrationImportChallenge}
							<div class="flex flex-col items-center gap-2">
								<img
									src={migrationImportChallenge.qrDataUrl}
									alt="Scan with Syner"
									class="h-48 w-48 rounded border"
								/>
								<a
									href={migrationImportChallenge.deeplink_url}
									class="text-sm text-primary underline"
								>
									Open in Syner
								</a>
								{#if migrationImportToken}
									<p class="text-sm text-green-600">Verified. Complete registration below.</p>
								{/if}
							</div>
						{:else}
							<Button
								variant="outline"
								onclick={handleMigrationVerifySyner}
								disabled={migrationLoading || !migrationFile}
							>
								{migrationLoading ? 'Creating challenge…' : 'Verify with Syner'}
							</Button>
						{/if}
					{/if}

					{#if migrationFile && (migrationHasSigil === true || migrationImportToken)}
						<div class="space-y-4 border-t pt-4">
							<p class="text-sm font-medium">Complete registration</p>
							<div>
								<label for="migration-username" class="text-sm font-medium">Username</label>
								<Input
									id="migration-username"
									bind:value={migrationUsername}
									placeholder="alice"
									disabled={migrationLoading}
								/>
							</div>
							<div>
								<label for="migration-display" class="text-sm font-medium">Display name</label>
								<Input
									id="migration-display"
									bind:value={migrationDisplayName}
									placeholder="Alice"
									disabled={migrationLoading}
								/>
							</div>
							<div>
								<label for="migration-pw" class="text-sm font-medium">Password</label>
								<Input
									id="migration-pw"
									type="password"
									bind:value={migrationNewPassword}
									placeholder="••••••••"
									disabled={migrationLoading}
								/>
							</div>
							<div>
								<label for="migration-pw2" class="text-sm font-medium">Confirm password</label>
								<Input
									id="migration-pw2"
									type="password"
									bind:value={migrationConfirmPassword}
									placeholder="••••••••"
									disabled={migrationLoading}
								/>
								{#if migrationConfirmPassword && migrationNewPassword !== migrationConfirmPassword}
									<p class="text-xs text-destructive">Passwords do not match</p>
								{/if}
							</div>
						</div>
					{/if}
				</Card.Content>
				<Card.Footer class="flex flex-row items-center justify-between gap-4">
					<a href={resolve('/login')} class="text-sm text-primary underline">Back to login</a>
					<Button
						onclick={handleMigrationSubmit}
						disabled={!canSubmitMigration() || migrationLoading}
					>
						{#if migrationLoading}
							<Loader2 class="mr-2 h-4 w-4 animate-spin" />
						{/if}
						Migrate
					</Button>
				</Card.Footer>
			</Card.Root>
		{:else if isSync}
			<Card.Root>
				<Card.Header>
					<Card.Title>Sync from backup</Card.Title>
					<Card.Description>
						Sync posts and profile from a .syr or .persona backup from another instance. The backup
						must match your identity.
					</Card.Description>
				</Card.Header>
				<Card.Content class="space-y-4">
					<div>
						<label for="sync-file" class="text-sm font-medium">Backup file</label>
						<Input
							id="sync-file"
							type="file"
							accept=".syr,.zip,.persona"
							onchange={onSyncFileSelect}
							disabled={syncLoading}
						/>
						{#if syncFile}
							<p class="mt-1 text-xs text-muted-foreground">
								{syncFile.name}
								{#if syncHasSigil === true}
									— With Sigil
								{:else if syncHasSigil === false}
									— Data-only (verify with Syner)
								{/if}
							</p>
						{/if}
					</div>

					{#if syncHasSigil === true}
						<div>
							<label for="sync-passphrase" class="text-sm font-medium"
								>Export passphrase (min 10 chars)</label
							>
							<Input
								id="sync-passphrase"
								type="password"
								bind:value={syncExportPassphrase}
								disabled={syncLoading}
							/>
						</div>
						<div>
							<label for="sync-pw" class="text-sm font-medium">Account password (to verify)</label>
							<Input
								id="sync-pw"
								type="password"
								bind:value={syncNewPassword}
								disabled={syncLoading}
							/>
						</div>
					{:else if syncHasSigil === false}
						{#if syncImportChallenge}
							<div class="flex flex-col items-center gap-2">
								<img
									src={syncImportChallenge.qrDataUrl}
									alt="Scan with Syner"
									class="h-48 w-48 rounded border"
								/>
								<a href={syncImportChallenge.deeplink_url} class="text-sm text-primary underline"
									>Open in Syner</a
								>
								{#if syncImportToken}
									<p class="text-sm text-green-600">Verified. Click Sync below.</p>
								{/if}
							</div>
						{:else}
							<Button
								variant="outline"
								onclick={handleSyncVerifySyner}
								disabled={syncLoading || !syncFile}
							>
								{syncLoading ? 'Creating…' : 'Verify with Syner'}
							</Button>
						{/if}
					{/if}
				</Card.Content>
				<Card.Footer class="flex flex-row items-center justify-between gap-4">
					<a href={resolve('/')} class="text-sm text-primary underline">Back to home</a>
					<Button onclick={handleSyncSubmit} disabled={!canSubmitSync() || syncLoading}>
						{#if syncLoading}
							<Loader2 class="mr-2 h-4 w-4 animate-spin" />
						{/if}
						Sync
					</Button>
				</Card.Footer>
			</Card.Root>
		{:else if isImport}
			<Card.Root>
				<Card.Header>
					<Card.Title>Import identity</Card.Title>
					<Card.Description>
						You have an account but no identity. Import from a backup to get started.
					</Card.Description>
				</Card.Header>
				<Card.Content>
					<Button onclick={openImportDialog}>Import identity</Button>
				</Card.Content>
				<Card.Footer>
					<a href={resolve('/')} class="text-sm text-primary underline">Back to home</a>
				</Card.Footer>
			</Card.Root>
		{/if}
	</div>
</div>

{#if isImport}
	<ImportIdentityDialog
		bind:open={importDialogOpen}
		onSuccess={() => {
			importDialogOpen = false;
			goto(resolve('/'));
			window.location.reload();
		}}
	/>
{/if}
