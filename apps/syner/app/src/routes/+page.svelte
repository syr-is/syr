<script lang="ts">
	import { invoke } from '@tauri-apps/api/core';
	import { confirm } from '@tauri-apps/plugin-dialog';
	import { goto } from '$app/navigation';
	import { get } from 'svelte/store';
	import { selectedPersona } from '$lib/stores/session';
	import { Button } from '@syr-is/ui/button';
	import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@syr-is/ui/card';
	import * as Avatar from '@syr-is/ui/avatar';
	import { toast } from 'svelte-sonner';
	import { Users, Plus, FileInput, PenLine, Trash2, Pencil } from '@lucide/svelte';
	import { toAvatarSrc, getInitials } from '$lib/utils';
	import CreatePersonaDialog from '$lib/components/fragments/create-persona-dialog.svelte';
	import EditPersonaDialog from '$lib/components/fragments/edit-persona-dialog.svelte';
	import type { Persona } from '$lib/types';

	let personas = $state<Persona[]>([]);
	let loading = $state(true);
	let error = $state<string | null>(null);
	let createOpen = $state(false);
	let editOpen = $state(false);
	let editPersona = $state<Persona | null>(null);

	async function loadPersonas() {
		loading = true;
		error = null;
		try {
			personas = await invoke<Persona[]>('list_personas_cmd');
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			loading = false;
		}
	}

	$effect(() => {
		loadPersonas();
	});

	function openEdit(p: Persona) {
		editPersona = p;
		editOpen = true;
	}

	async function deletePersona(id: string) {
		const confirmed = await confirm('Delete this persona? This cannot be undone.', {
			title: 'Delete Persona',
			kind: 'warning'
		});
		if (!confirmed) return;
		try {
			await invoke('delete_persona_cmd', { personaId: id });
			if (get(selectedPersona)?.id === id) {
				selectedPersona.set(null);
			}
			await loadPersonas();
			toast.success('Persona deleted');
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
			toast.error(error);
		}
	}
</script>

<div class="flex flex-col gap-6 p-4 md:p-6">
	<div class="flex items-center justify-between">
		<h1 class="text-2xl font-bold">Personas</h1>
		<div class="flex gap-2">
			<Button onclick={() => (createOpen = true)}>
				<Plus class="h-4 w-4" />
				Create
			</Button>
			<Button variant="outline" href="/import">
				<FileInput class="h-4 w-4" />
				Import Sigil
			</Button>
		</div>
	</div>

	<Card>
		<CardHeader>
			<CardTitle class="flex items-center gap-2">
				<Users class="h-5 w-5" />
				Your identities
			</CardTitle>
			<CardDescription>
				Create or import personas to manage your identities and sign with them.
			</CardDescription>
		</CardHeader>
		<CardContent>
			{#if loading}
				<p class="text-muted-foreground text-sm">Loading…</p>
			{:else if error}
				<p class="text-sm text-destructive">{error}</p>
			{:else if personas.length === 0}
				<p class="text-muted-foreground text-sm">
					No personas yet. Create one or import from a Sigil file.
				</p>
				<div class="mt-4 flex gap-2">
					<Button onclick={() => (createOpen = true)}>Create persona</Button>
					<Button variant="outline" href="/import">Import Sigil</Button>
				</div>
			{:else}
				<ul class="space-y-3">
					{#each personas as persona (persona.id)}
						<li
							class="relative overflow-hidden rounded-lg border border-border transition-colors {persona.bannerUrl ? '' : 'bg-muted/50'} hover:bg-muted/50"
						>
							{#if toAvatarSrc(persona.bannerUrl)}
								<div
									class="absolute inset-0 bg-cover bg-center [mask-image:linear-gradient(to_right,rgba(0,0,0,0.5),transparent)] [-webkit-mask-image:linear-gradient(to_right,rgba(0,0,0,0.5),transparent)] [mask-size:cover] [-webkit-mask-size:cover]"
									style="background-image: url('{toAvatarSrc(persona.bannerUrl)}')"
								></div>
							{/if}
							<div class="relative z-10 flex items-center gap-4 p-4">
							<Avatar.Root class="h-12 w-12 shrink-0">
								{#if toAvatarSrc(persona.avatarUrl)}
									<Avatar.Image src={toAvatarSrc(persona.avatarUrl)!} alt={persona.displayName} />
								{/if}
								<Avatar.Fallback>{getInitials(persona.displayName)}</Avatar.Fallback>
							</Avatar.Root>
							<div class="min-w-0 flex-1">
								<p class="font-medium">{persona.displayName}</p>
								<p class="font-mono text-muted-foreground truncate text-xs">{persona.did}</p>
							</div>
							<div class="flex gap-2">
								<Button
									variant="outline"
									size="sm"
									onclick={() => openEdit(persona)}
								>
									<Pencil class="h-4 w-4" />
									Edit
								</Button>
								<Button
									variant="outline"
									size="sm"
									onclick={() => {
										selectedPersona.set({
											id: persona.id,
											displayName: persona.displayName,
											did: persona.did,
											avatarUrl: persona.avatarUrl,
											bannerUrl: persona.bannerUrl
										});
										goto('/sign');
									}}
								>
									<PenLine class="h-4 w-4" />
									Sign
								</Button>
								<Button
									variant="ghost"
									size="icon-sm"
									onclick={() => deletePersona(persona.id)}
								>
									<Trash2 class="h-4 w-4 text-destructive" />
								</Button>
							</div>
							</div>
						</li>
					{/each}
				</ul>
			{/if}
		</CardContent>
	</Card>

	<CreatePersonaDialog bind:open={createOpen} onSuccess={loadPersonas} />
	<EditPersonaDialog
		bind:open={editOpen}
		persona={editPersona}
		onSuccess={() => {
			editPersona = null;
			loadPersonas();
		}}
	/>
</div>
