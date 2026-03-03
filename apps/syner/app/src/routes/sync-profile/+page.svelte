<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { invoke } from '@tauri-apps/api/core';
	import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@syr-is/ui/card';
	import * as Avatar from '@syr-is/ui/avatar';
	import { Button } from '@syr-is/ui/button';
	import { toast } from 'svelte-sonner';
	import { toAvatarSrc, getInitials } from '$lib/utils';
	import { validateInstanceUrl } from '$lib/utils/syr-url';
	import { syncProfileToSyr } from '$lib/sync-profile';
	import type { Persona } from '$lib/types';

	let instanceRaw = $derived(page.url.searchParams.get('instance'));
	let syncToken = $derived(page.url.searchParams.get('sync_token'));
	let instanceUrl = $derived(instanceRaw ? validateInstanceUrl(instanceRaw) : null);

	let personas = $state<Persona[]>([]);
	let selected = $state<Persona | null>(null);
	let loading = $state(false);

	$effect(() => {
		loadPersonas();
	});

	async function loadPersonas() {
		try {
			personas = await invoke<Persona[]>('list_personas_cmd');
		} catch {
			personas = [];
		}
	}

	async function handleSync() {
		if (!selected || !instanceUrl || !syncToken) return;
		loading = true;
		try {
			await syncProfileToSyr(instanceUrl, syncToken, selected.id, {
				displayName: selected.displayName,
				bio: selected.bio
			});
			toast.success('Profile synced. Check the browser.');
			goto('/');
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Profile sync failed');
		} finally {
			loading = false;
		}
	}
</script>

<div class="flex flex-col gap-6 p-4 md:p-6">
	<h1 class="text-2xl font-bold">Sync profile to SYR</h1>

	{#if !instanceUrl || !syncToken}
		<Card>
			<CardContent class="pt-6">
				<p class="text-muted-foreground text-sm">
					Invalid or missing parameters. Scan the QR code from the SYR onboarding page again.
				</p>
				<Button variant="outline" class="mt-4" onclick={() => goto('/')}>Back to Personas</Button>
			</CardContent>
		</Card>
	{:else if personas.length === 0}
		<Card>
			<CardContent class="pt-6">
				<p class="text-muted-foreground text-sm">No personas. Create or import one first.</p>
				<Button variant="outline" class="mt-4" onclick={() => goto('/')}>Go to Personas</Button>
			</CardContent>
		</Card>
	{:else}
		<Card>
			<CardHeader>
				<CardTitle>Select persona</CardTitle>
				<CardDescription>
					Choose the persona to import display name, bio, avatar, and banner to SYR.
				</CardDescription>
			</CardHeader>
			<CardContent class="space-y-4">
				<div class="flex flex-col gap-2">
					{#each personas as p (p.id)}
						<button
							type="button"
							class="border-border hover:bg-muted/50 flex items-center gap-3 rounded-lg border p-3 text-left transition-colors {selected?.id ===
							p.id
								? 'border-primary bg-muted/50'
								: ''}"
							onclick={() => (selected = p)}
						>
							<Avatar.Root class="h-10 w-10 shrink-0">
								{#if toAvatarSrc(p.avatarUrl)}
									<Avatar.Image src={toAvatarSrc(p.avatarUrl)!} alt={p.displayName} />
								{/if}
								<Avatar.Fallback>{getInitials(p.displayName)}</Avatar.Fallback>
							</Avatar.Root>
							<div class="min-w-0 flex-1">
								<p class="font-medium">{p.displayName}</p>
								<p class="text-muted-foreground truncate font-mono text-xs">{p.did}</p>
							</div>
						</button>
					{/each}
				</div>

				<div class="flex gap-2 pt-2">
					<Button onclick={handleSync} disabled={loading || !selected}>
						{loading ? 'Syncing…' : 'Sync profile'}
					</Button>
					<Button variant="outline" onclick={() => goto('/')}>Cancel</Button>
				</div>
			</CardContent>
		</Card>
	{/if}
</div>
