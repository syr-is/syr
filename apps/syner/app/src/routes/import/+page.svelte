<script lang="ts">
	import { invoke } from '@tauri-apps/api/core';
	import { open, confirm } from '@tauri-apps/plugin-dialog';
	import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@syr-is/ui/card';
	import { Button } from '@syr-is/ui/button';
	import { Input } from '@syr-is/ui/input';
	import { Label } from '@syr-is/ui/label';
	import { goto } from '$app/navigation';
	import { toast } from 'svelte-sonner';
	import { FileInput, Loader2, Image } from '@lucide/svelte';
	import { get } from 'svelte/store';
	import { sessionSeed, selectedPersona } from '$lib/stores/session';
	import PickedFileImage from '$lib/components/picked-file-image.svelte';

	const IMAGE_FILTERS = [
		{ name: 'Images', extensions: ['image/png', 'image/jpeg', 'image/gif', 'image/webp'] },
		{ name: 'All files', extensions: ['*'] }
	];

	let selectedPath = $state<string | null>(null);
	let passphrase = $state('');
	let loading = $state(false);
	let error = $state<string | null>(null);
	let result = $state<{
		did: string;
		publicKeyBase64: string;
		seedBase64: string;
		sigilJson: string;
	} | null>(null);
	let passphraseForSave = $state('');
	let saveAsPersona = $state(false);
	let saveDisplayName = $state('');
	let saveBio = $state('');
	let saveAvatarPath = $state<string | null>(null);
	let saveBannerPath = $state<string | null>(null);
	let saveLoading = $state(false);
	let saveError = $state<string | null>(null);

	async function pickImage(): Promise<string | null> {
		const file = await open({
			multiple: false,
			directory: false,
			title: 'Select image',
			filters: IMAGE_FILTERS
		});
		// Ensure single file: take first only (Android may return array despite multiple: false)
		const paths = file == null ? null : Array.isArray(file) ? file : [file];
		return paths && paths.length > 0 ? paths[0] : null;
	}

	function bytesToBase64(bytes: number[]): string {
		return btoa(String.fromCharCode(...new Uint8Array(bytes)));
	}

	async function pickFile() {
		error = null;
		result = null;
		const file = await open({
			multiple: false,
			directory: false,
			title: 'Select Persona or Sigil file',
			filters: [
				{ name: 'Persona files', extensions: ['persona'] },
				{ name: 'Sigil files', extensions: ['sigil'] },
				{ name: 'All files', extensions: ['*'] }
			]
		});
		if (file && typeof file === 'string') {
			selectedPath = file;
		} else if (Array.isArray(file) && file.length > 0) {
			selectedPath = file[0];
		}
	}

	const _SUPPORTED_EXTENSIONS = ['persona', 'sigil'] as const;

	/**
	 * Path to send to backend. On Android, the dialog returns content URIs or encoded
	 * paths that the backend handles via tauri-plugin-android-fs. Pass as-is.
	 * On desktop, the dialog returns filesystem paths - also pass as-is.
	 */
	function pathForBackend(path: string): string {
		return path;
	}

	/** Extract file extension robustly: handles URLs, content URIs, spaces, encoding. */
	function getFileExtension(path: string | null): string | null {
		if (!path) return null;
		try {
			const decoded = decodeURIComponent(path);
			const segments = decoded.split(/[/\\]/);
			const filename = segments[segments.length - 1] || '';
			const lastDot = filename.lastIndexOf('.');
			return lastDot > 0 ? filename.slice(lastDot + 1).toLowerCase() : null;
		} catch {
			return null;
		}
	}

	const fileExt = $derived(getFileExtension(selectedPath));
	const isPersonaFile = $derived(fileExt === 'persona' || fileExt === 'zip');
	const isSigilFile = $derived(fileExt === 'sigil' || fileExt === 'json');
	const _isUnknownType = $derived(!fileExt || (!isPersonaFile && !isSigilFile));

	async function importPersona() {
		if (!selectedPath) return;
		loading = true;
		error = null;
		try {
			await invoke('import_persona_from_bundle_cmd', {
				path: pathForBackend(selectedPath),
				replaceIfExists: false
			});
			toast.success('Persona imported');
			goto('/');
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			if (msg.toLowerCase().includes('persona already exists')) {
				const confirmed = await confirm(
					'A persona with this identity already exists. Importing will replace it. Continue?',
					{ title: 'Replace Existing Persona', kind: 'warning' }
				);
				if (confirmed) {
					try {
						await invoke('import_persona_from_bundle_cmd', {
							path: pathForBackend(selectedPath),
							replaceIfExists: true
						});
						toast.success('Persona replaced');
						goto('/');
					} catch (e2) {
						error = e2 instanceof Error ? e2.message : String(e2);
						toast.error(error);
					}
				} else {
					error = null;
				}
			} else {
				error = msg;
				toast.error(msg);
			}
		} finally {
			loading = false;
		}
	}

	async function importSigil() {
		if (!selectedPath || !passphrase.trim()) {
			error = 'Please select a file and enter your passphrase.';
			return;
		}
		loading = true;
		error = null;
		result = null;
		try {
			const sigilJson = await invoke<string>('read_file_content_cmd', {
				path: pathForBackend(selectedPath)
			});
			const seed = await invoke<number[]>('decrypt_sigil_cmd', {
				sigilJson,
				passphrase: passphrase.trim()
			});
			const seedBase64 = bytesToBase64(seed);
			const publicKey = await invoke<number[]>('derive_public_key_from_seed_cmd', {
				seedBase64
			});
			const publicKeyBase64 = bytesToBase64(publicKey);
			const did = await invoke<string>('derive_did_cmd', {
				publicKeyBase64
			});
			result = { did, publicKeyBase64, seedBase64, sigilJson };
			passphraseForSave = passphrase.trim();
			passphrase = '';
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
			toast.error(error);
		} finally {
			loading = false;
		}
	}

	function reset() {
		selectedPath = null;
		passphrase = '';
		passphraseForSave = '';
		error = null;
		result = null;
		saveAsPersona = false;
		saveDisplayName = '';
		saveBio = '';
		saveAvatarPath = null;
		saveBannerPath = null;
	}
</script>

<div class="flex flex-col gap-6 p-4 md:p-6">
	<h1 class="text-2xl font-bold">Import</h1>

	<Card>
		<CardHeader>
			<CardTitle class="flex items-center gap-2">
				<FileInput class="h-5 w-5" />
				Import persona or sigil
			</CardTitle>
			<CardDescription>
				Select a .persona file (from SYR Export Persona) or .sigil file to import. .persona includes
				profile, avatar, and banner. .sigil is a bare identity you can save as persona.
			</CardDescription>
		</CardHeader>
		<CardContent class="flex flex-col gap-4">
			{#if result}
				<div class="border-border bg-muted/50 space-y-4 rounded-lg border p-4">
					<p class="text-muted-foreground text-sm font-medium">Identity imported successfully</p>
					<p class="font-mono text-sm break-all">{result.did}</p>
					{#if saveAsPersona}
						<div class="space-y-2">
							<Label for="save-display-name">Display name</Label>
							<Input
								id="save-display-name"
								bind:value={saveDisplayName}
								placeholder="My Persona"
								disabled={saveLoading}
							/>
							<Label for="save-bio">Bio (optional)</Label>
							<Input
								id="save-bio"
								bind:value={saveBio}
								placeholder="Short description"
								disabled={saveLoading}
							/>
							<div class="grid grid-cols-2 gap-4">
								<div class="space-y-2">
									<Label>Avatar (optional)</Label>
									{#if saveAvatarPath}
										<PickedFileImage
											sourcePath={saveAvatarPath}
											displayName={saveDisplayName}
											variant="avatar"
											class="h-16 w-16"
										/>
									{/if}
									<Button
										type="button"
										variant="outline"
										class="w-full"
										disabled={saveLoading}
										onclick={async () => {
											const p = await pickImage();
											if (p) saveAvatarPath = p;
										}}
									>
										<Image class="h-4 w-4" />
										{saveAvatarPath ? 'Change' : 'Pick image'}
									</Button>
								</div>
								<div class="space-y-2">
									<Label>Banner (optional)</Label>
									{#if saveBannerPath}
										<PickedFileImage sourcePath={saveBannerPath} variant="banner" class="h-16" />
									{/if}
									<Button
										type="button"
										variant="outline"
										class="w-full"
										disabled={saveLoading}
										onclick={async () => {
											const p = await pickImage();
											if (p) saveBannerPath = p;
										}}
									>
										<Image class="h-4 w-4" />
										{saveBannerPath ? 'Change' : 'Pick image'}
									</Button>
								</div>
							</div>
							{#if saveError}
								<p class="text-destructive text-sm">{saveError}</p>
							{/if}
							<div class="flex gap-2">
								<Button
									onclick={async () => {
										if (!saveDisplayName.trim()) {
											saveError = 'Display name is required.';
											return;
										}
										saveLoading = true;
										saveError = null;
										try {
											const personaId = await invoke<string>('persona_id_from_public_key_cmd', {
												publicKeyBase64: result!.publicKeyBase64
											});
											const exists = await invoke<boolean>('persona_exists_cmd', {
												personaId
											});
											if (exists) {
												const confirmed = await confirm(
													'A persona with this identity already exists. Importing will replace it and remove its avatar and banner. Continue?',
													{
														title: 'Replace Existing Persona',
														kind: 'warning'
													}
												);
												if (!confirmed) {
													saveLoading = false;
													return;
												}
											}
											const persona = await invoke<{ id: string }>(
												'import_persona_from_sigil_cmd',
												{
													sigilJson: result!.sigilJson,
													passphrase: passphraseForSave,
													displayName: saveDisplayName.trim(),
													bio: saveBio.trim() || null
												}
											);
											const avatarSource =
												typeof saveAvatarPath === 'string' && saveAvatarPath.trim()
													? saveAvatarPath
													: null;
											const bannerSource =
												typeof saveBannerPath === 'string' && saveBannerPath.trim()
													? saveBannerPath
													: null;
											if (avatarSource) {
												await invoke('save_persona_avatar_cmd', {
													personaId: persona.id,
													sourcePath: avatarSource
												});
											}
											if (bannerSource) {
												await invoke('save_persona_banner_cmd', {
													personaId: persona.id,
													sourcePath: bannerSource
												});
											}
											passphraseForSave = '';
											if (exists && get(selectedPersona)?.id === personaId) {
												selectedPersona.set(null);
											}
											toast.success(exists ? 'Persona replaced' : 'Persona saved');
											goto('/');
										} catch (e) {
											saveError = e instanceof Error ? e.message : String(e);
											toast.error(saveError);
										} finally {
											saveLoading = false;
										}
									}}
									disabled={saveLoading || !saveDisplayName.trim()}
								>
									{saveLoading ? 'Saving…' : 'Save as persona'}
								</Button>
								<Button
									variant="outline"
									onclick={() => (saveAsPersona = false)}
									disabled={saveLoading}
								>
									Cancel
								</Button>
							</div>
						</div>
					{:else}
						<div class="flex flex-wrap gap-2">
							<Button
								variant="default"
								size="sm"
								onclick={() => {
									sessionSeed.set(result!.seedBase64);
									goto('/sign');
								}}
							>
								Use for signing
							</Button>
							<Button variant="outline" size="sm" onclick={() => (saveAsPersona = true)}>
								Save as persona
							</Button>
							<Button variant="outline" size="sm" onclick={reset}>Import another</Button>
						</div>
					{/if}
				</div>
			{:else}
				<div class="space-y-4">
					<div class="space-y-2">
						<Label for="file-picker">File</Label>
						<div class="flex gap-2">
							<Button
								id="file-picker"
								type="button"
								variant="outline"
								onclick={pickFile}
								disabled={loading}
							>
								{selectedPath
									? selectedPath.split(/[/\\]/).pop()
									: 'Select .persona or .sigil file'}
							</Button>
						</div>
					</div>

					{#if selectedPath}
						{#if isPersonaFile}
							<div class="flex gap-2">
								<Button onclick={importPersona} disabled={loading}>
									{#if loading}
										<Loader2 class="mr-2 h-4 w-4 animate-spin" />
										Importing…
									{:else}
										Import persona
									{/if}
								</Button>
								<Button variant="outline" onclick={reset} disabled={loading}>Cancel</Button>
							</div>
						{:else if isSigilFile}
							<div class="space-y-2">
								<Label for="passphrase">Passphrase</Label>
								<Input
									id="passphrase"
									type="password"
									bind:value={passphrase}
									placeholder="Enter passphrase"
									disabled={loading}
								/>
							</div>
							<div class="flex gap-2">
								<Button onclick={importSigil} disabled={loading || !passphrase.trim()}>
									{#if loading}
										<Loader2 class="mr-2 h-4 w-4 animate-spin" />
										Importing…
									{:else}
										Import
									{/if}
								</Button>
								<Button variant="outline" onclick={reset} disabled={loading}>Cancel</Button>
							</div>
						{:else}
							<p class="text-muted-foreground text-sm">
								File type unclear (extension missing or renamed). Try importing by type:
							</p>
							<div class="flex flex-col gap-4">
								<div class="flex gap-2">
									<Button onclick={importPersona} disabled={loading}>
										{#if loading}
											<Loader2 class="mr-2 h-4 w-4 animate-spin" />
											Importing…
										{:else}
											Import as persona
										{/if}
									</Button>
								</div>
								<div class="space-y-2">
									<Label for="passphrase">Or import as sigil</Label>
									<Input
										id="passphrase"
										type="password"
										bind:value={passphrase}
										placeholder="Enter passphrase"
										disabled={loading}
									/>
									<Button onclick={importSigil} disabled={loading || !passphrase.trim()}>
										{#if loading}
											<Loader2 class="mr-2 h-4 w-4 animate-spin" />
											Importing…
										{:else}
											Import as sigil
										{/if}
									</Button>
								</div>
							</div>
							<Button variant="outline" onclick={reset} disabled={loading}>Cancel</Button>
						{/if}
					{/if}
				</div>

				{#if error}
					<p class="text-destructive text-sm">{error}</p>
				{/if}
			{/if}
		</CardContent>
	</Card>
</div>
