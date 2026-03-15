<script lang="ts">
	import { invoke } from '@tauri-apps/api/core';
	import { open } from '@tauri-apps/plugin-dialog';
	import * as Dialog from '@syr-is/ui/dialog';
	import { Button } from '@syr-is/ui/button';
	import { Input } from '@syr-is/ui/input';
	import { Label } from '@syr-is/ui/label';
	import { Textarea } from '@syr-is/ui/textarea';
	import { toast } from 'svelte-sonner';
	import { Image } from '@lucide/svelte';
	import PickedFileImage from '$lib/components/picked-file-image.svelte';
	import type { Persona } from '$lib/types';

	const IMAGE_FILTERS = [
		{ name: 'Images', extensions: ['image/png', 'image/jpeg', 'image/gif', 'image/webp'] },
		{ name: 'All files', extensions: ['*'] }
	];

	let {
		open: openState = $bindable(false),
		onSuccess
	}: {
		open?: boolean;
		onSuccess?: () => void;
	} = $props();

	let displayName = $state('');
	let bio = $state('');
	let passphrase = $state('');
	let avatarPath = $state<string | null>(null);
	let bannerPath = $state<string | null>(null);
	let loading = $state(false);
	let error = $state<string | null>(null);

	async function pickImage(): Promise<string | null> {
		const file = await open({
			multiple: false,
			directory: false,
			title: 'Select image',
			filters: IMAGE_FILTERS,
			// iOS: copy file to app sandbox; document picker more reliable than image picker
			fileAccessMode: 'copy',
			pickerMode: 'document'
		});
		// Ensure single file: take first only (Android may return array despite multiple: false)
		const paths = file == null ? null : Array.isArray(file) ? file : [file];
		return paths && paths.length > 0 ? paths[0] : null;
	}

	async function handleCreate() {
		if (!displayName.trim() || !passphrase.trim()) {
			error = 'Display name and passphrase are required.';
			return;
		}
		loading = true;
		error = null;
		try {
			const persona = await invoke<Persona>('create_persona_cmd', {
				displayName: displayName.trim(),
				bio: bio.trim() || null,
				passphrase
			});
			const avatarSource = typeof avatarPath === 'string' && avatarPath.trim() ? avatarPath : null;
			const bannerSource = typeof bannerPath === 'string' && bannerPath.trim() ? bannerPath : null;
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
			openState = false;
			displayName = '';
			bio = '';
			passphrase = '';
			avatarPath = null;
			bannerPath = null;
			await onSuccess?.();
			toast.success('Persona created');
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
			toast.error(error);
		} finally {
			loading = false;
		}
	}

	$effect(() => {
		if (openState) {
			displayName = '';
			bio = '';
			passphrase = '';
			avatarPath = null;
			bannerPath = null;
			error = null;
		}
	});
</script>

<Dialog.Root bind:open={openState}>
	<Dialog.Content>
		<Dialog.Header>
			<Dialog.Title>Create persona</Dialog.Title>
			<Dialog.Description>
				Generate a new identity. You'll set a passphrase to encrypt the key.
			</Dialog.Description>
		</Dialog.Header>
		<div class="grid gap-4 py-4">
			<div class="space-y-2">
				<Label for="create-display-name">Display name</Label>
				<Input
					id="create-display-name"
					bind:value={displayName}
					placeholder="My Persona"
					disabled={loading}
				/>
			</div>
			<div class="space-y-2">
				<Label for="create-bio">Bio (optional)</Label>
				<Textarea
					id="create-bio"
					bind:value={bio}
					placeholder="A short description"
					rows={2}
					disabled={loading}
				/>
			</div>
			<div class="space-y-2">
				<Label for="create-passphrase">Passphrase</Label>
				<Input
					id="create-passphrase"
					type="password"
					bind:value={passphrase}
					placeholder="Encryption passphrase"
					disabled={loading}
				/>
			</div>
			<div class="grid grid-cols-2 gap-4">
				<div class="space-y-2">
					<Label>Avatar (optional)</Label>
					{#if avatarPath}
						<PickedFileImage
							sourcePath={avatarPath}
							{displayName}
							variant="avatar"
							class="h-16 w-16"
						/>
					{/if}
					<Button
						type="button"
						variant="outline"
						class="w-full"
						disabled={loading}
						onclick={async () => {
							const p = await pickImage();
							if (p) avatarPath = p;
						}}
					>
						<Image class="h-4 w-4" />
						{avatarPath ? 'Change' : 'Pick image'}
					</Button>
				</div>
				<div class="space-y-2">
					<Label>Banner (optional)</Label>
					{#if bannerPath}
						<PickedFileImage sourcePath={bannerPath} variant="banner" class="h-16" />
					{/if}
					<Button
						type="button"
						variant="outline"
						class="w-full"
						disabled={loading}
						onclick={async () => {
							const p = await pickImage();
							if (p) bannerPath = p;
						}}
					>
						<Image class="h-4 w-4" />
						{bannerPath ? 'Change' : 'Pick image'}
					</Button>
				</div>
			</div>
			{#if error}
				<p class="text-destructive text-sm">{error}</p>
			{/if}
		</div>
		<Dialog.Footer>
			<Button variant="outline" onclick={() => (openState = false)} disabled={loading}>
				Cancel
			</Button>
			<Button onclick={handleCreate} disabled={loading}>
				{loading ? 'Creating…' : 'Create'}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
