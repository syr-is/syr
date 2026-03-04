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
	import PersonaImage from '$lib/components/persona-image.svelte';
	import PickedFileImage from '$lib/components/picked-file-image.svelte';
	import type { Persona } from '$lib/types';

	const IMAGE_FILTERS = [
		{ name: 'Images', extensions: ['image/png', 'image/jpeg', 'image/gif', 'image/webp'] },
		{ name: 'All files', extensions: ['*'] }
	];

	let {
		open: openState = $bindable(false),
		persona = null,
		onSuccess
	}: {
		open?: boolean;
		persona?: Persona | null;
		onSuccess?: () => void;
	} = $props();

	let displayName = $state('');
	let bio = $state('');
	let avatarPath = $state<string | null>(null);
	let bannerPath = $state<string | null>(null);
	let loading = $state(false);
	let error = $state<string | null>(null);

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

	async function handleSave() {
		if (!persona) return;
		loading = true;
		error = null;
		try {
			// Save avatar/banner assets FIRST so files are written to persona folder before profile update.
			// Pass only string paths; picker may return array on Android - ensure we use first item.
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
			// Update profile text fields only - do NOT pass avatarUrl/bannerUrl to avoid overwriting.
			await invoke('update_persona_profile_cmd', {
				personaId: persona.id,
				displayName: displayName.trim(),
				bio: bio.trim() === '' ? '' : bio.trim()
			});
			openState = false;
			await onSuccess?.();
			toast.success('Persona updated');
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
			toast.error(error);
		} finally {
			loading = false;
		}
	}

	$effect(() => {
		if (openState && persona) {
			displayName = persona.displayName;
			bio = persona.bio || '';
			avatarPath = null;
			bannerPath = null;
			error = null;
		}
	});
</script>

<Dialog.Root bind:open={openState}>
	<Dialog.Content>
		<Dialog.Header>
			<Dialog.Title>Edit persona</Dialog.Title>
			<Dialog.Description>
				Update profile and images. Images are stored in the persona folder.
			</Dialog.Description>
		</Dialog.Header>
		{#if persona}
			<div class="grid gap-4 py-4">
				<div class="space-y-2">
					<Label for="edit-display-name">Display name</Label>
					<Input
						id="edit-display-name"
						bind:value={displayName}
						placeholder="My Persona"
						disabled={loading}
					/>
				</div>
				<div class="space-y-2">
					<Label for="edit-bio">Bio (optional)</Label>
					<Textarea
						id="edit-bio"
						bind:value={bio}
						placeholder="A short description"
						rows={2}
						disabled={loading}
					/>
				</div>
				<div class="grid grid-cols-2 gap-4">
					<div class="space-y-2">
						<Label>Avatar</Label>
						<div class="flex flex-col gap-2">
							{#if avatarPath}
								<PickedFileImage
									sourcePath={avatarPath}
									displayName={persona.displayName}
									variant="avatar"
									class="h-16 w-16"
								/>
							{:else}
								<PersonaImage
									personaId={persona.id}
									role="avatar"
									mtime={persona.avatarMtime}
									displayName={persona.displayName}
									variant="avatar"
									class="h-16 w-16"
								/>
							{/if}
							<Button
								type="button"
								variant="outline"
								size="sm"
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
					</div>
					<div class="space-y-2">
						<Label>Banner</Label>
						<div class="flex flex-col gap-2">
							{#if bannerPath}
								<PickedFileImage sourcePath={bannerPath} variant="banner" class="h-16" />
							{:else if persona.bannerUrl}
								<PersonaImage
									personaId={persona.id}
									role="banner"
									mtime={persona.bannerMtime}
									variant="banner"
									class="h-16 overflow-hidden rounded border"
								/>
							{/if}
							<Button
								type="button"
								variant="outline"
								size="sm"
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
				</div>
				{#if error}
					<p class="text-destructive text-sm">{error}</p>
				{/if}
			</div>
			<Dialog.Footer>
				<Button variant="outline" onclick={() => (openState = false)} disabled={loading}>
					Cancel
				</Button>
				<Button onclick={handleSave} disabled={loading}>
					{loading ? 'Saving…' : 'Save'}
				</Button>
			</Dialog.Footer>
		{/if}
	</Dialog.Content>
</Dialog.Root>
