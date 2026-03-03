<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { invoke } from '@tauri-apps/api/core';
	import { get } from 'svelte/store';
	import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@syr-is/ui/card';
	import { Button } from '@syr-is/ui/button';
	import { Input } from '@syr-is/ui/input';
	import { Label } from '@syr-is/ui/label';
	import { toast } from 'svelte-sonner';
	import { Lock } from '@lucide/svelte';
	import PersonaImage from '$lib/components/persona-image.svelte';
	import { validateInstanceUrl } from '$lib/utils/syr-url';
	import { syncProfileToSyr } from '$lib/sync-profile';
	import { sessionSeed, selectedPersona } from '$lib/stores/session';
	import type { Persona } from '$lib/types';

	let instanceRaw = $derived(page.url.searchParams.get('instance'));
	let didFromUrl = $derived(page.url.searchParams.get('did'));
	let instanceUrl = $derived(instanceRaw ? validateInstanceUrl(instanceRaw) : null);

	let targetDid = $state<string | null>(null);
	let targetLoading = $state(false);
	let personas = $state<Persona[]>([]);
	let selected = $state<Persona | null>(null);
	let loadError = $state<string | null>(null);
	let passphrase = $state('');
	let loading = $state(false);
	let unlockLoading = $state(false);
	let error = $state<string | null>(null);
	let seedValue = $state<string | null>(null);
	let personaValue = $state<{ id: string } | null>(null);

	$effect(() => {
		const unsubSeed = sessionSeed.subscribe((v) => {
			seedValue = v;
		});
		const unsubPersona = selectedPersona.subscribe((v) => {
			personaValue = v;
		});
		return () => {
			unsubSeed();
			unsubPersona();
		};
	});

	let hasUnlockedPersona = $derived(
		!!seedValue && !!personaValue && !!selected && personaValue.id === selected.id
	);

	$effect(() => {
		if (instanceUrl && didFromUrl) {
			loadTargetAndPersonas();
		} else {
			loadPersonas();
		}
	});

	async function loadPersonas() {
		try {
			personas = await invoke<Persona[]>('list_personas_cmd');
		} catch {
			personas = [];
		}
	}

	async function loadTargetAndPersonas() {
		if (!instanceUrl || !didFromUrl) return;
		targetLoading = true;
		loadError = null;
		targetDid = null;
		selected = null;
		try {
			const list = await invoke<Persona[]>('list_personas_cmd');
			personas = list ?? [];
			targetDid = didFromUrl;
			const match = personas.find((p) => p.did === targetDid);
			if (match) {
				selected = match;
			} else {
				loadError =
					'Profile not found on this device. Import the identity that matches your SYR account.';
				toast.error(loadError);
			}
		} catch (e) {
			loadError = e instanceof Error ? e.message : 'Failed to load profile';
			toast.error(loadError);
		} finally {
			targetLoading = false;
		}
	}

	function bytesToBase64(bytes: number[]): string {
		return btoa(String.fromCharCode(...new Uint8Array(bytes)));
	}

	async function unlockPersona() {
		if (!selected || !passphrase.trim()) {
			error = 'Select a persona and enter passphrase.';
			return;
		}
		unlockLoading = true;
		error = null;
		try {
			const seed = await invoke<number[]>('decrypt_persona_sigil_cmd', {
				personaId: selected.id,
				passphrase: passphrase.trim()
			});
			sessionSeed.set(bytesToBase64(seed));
			selectedPersona.set({
				id: selected.id,
				displayName: selected.displayName,
				did: selected.did,
				avatarUrl: selected.avatarUrl,
				bannerUrl: selected.bannerUrl,
				avatarMtime: selected.avatarMtime,
				bannerMtime: selected.bannerMtime
			});
			passphrase = '';
			toast.success('Persona unlocked');
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
			toast.error(error);
		} finally {
			unlockLoading = false;
		}
	}

	function lockSession() {
		sessionSeed.set(null);
		selectedPersona.set(null);
	}

	async function handleSync() {
		if (!selected || !instanceUrl) return;
		const s = get(sessionSeed);
		if (!s || !hasUnlockedPersona) {
			error = 'Unlock a persona first.';
			return;
		}
		loading = true;
		error = null;
		try {
			await loadPersonas();
			const fresh = personas.find((p) => p.did === selected?.did) ?? selected;
			selected = fresh;

			const payload = {
				action: 'profile-sync' as const,
				did: fresh.did,
				issued_at: new Date().toISOString(),
				...(fresh.displayName ? { display_name: fresh.displayName } : {}),
				...(fresh.bio ? { bio: fresh.bio } : {})
			};
			const signedPayload = await invoke<string>('canonicalize_cmd', {
				objJson: JSON.stringify(payload)
			});
			const payloadBytes = Array.from(new TextEncoder().encode(signedPayload));
			const sigBytes = await invoke<number[]>('sign_payload', {
				payload: payloadBytes,
				privateKeyBase64: s
			});
			const signature = await invoke<string>('encode_multibase_cmd', {
				bytes: sigBytes
			});

			await syncProfileToSyr(
				instanceUrl,
				fresh.id,
				{
					displayName: fresh.displayName,
					bio: fresh.bio,
					did: fresh.did
				},
				{ signature, signedPayload }
			);
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

	{#if !instanceUrl || !didFromUrl}
		<Card>
			<CardContent class="pt-6">
				<p class="text-muted-foreground text-sm">
					Invalid or missing parameters. Scan the QR code from the SYR onboarding page again.
				</p>
				<Button variant="outline" class="mt-4" onclick={() => goto('/')}>Back to Personas</Button>
			</CardContent>
		</Card>
	{:else if targetLoading}
		<Card>
			<CardContent class="pt-6">
				<p class="text-muted-foreground text-sm">Loading…</p>
			</CardContent>
		</Card>
	{:else if loadError}
		<Card>
			<CardContent class="pt-6">
				<p class="text-destructive text-sm">{loadError}</p>
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
	{:else if selected}
		<Card>
			<CardHeader>
				<CardTitle>Sync profile to SYR</CardTitle>
				<CardDescription>
					Unlock your persona to sync display name, bio, avatar, and banner.
				</CardDescription>
			</CardHeader>
			<CardContent class="space-y-4">
				<div class="border-border flex items-center gap-3 rounded-lg border p-3">
					<PersonaImage
						personaId={selected.id}
						role="avatar"
						mtime={selected.avatarMtime}
						displayName={selected.displayName}
						variant="avatar"
						class="h-12 w-12 shrink-0"
					/>
					<div class="min-w-0 flex-1">
						<p class="font-medium">{selected.displayName}</p>
						<p class="text-muted-foreground truncate font-mono text-xs">{selected.did}</p>
					</div>
				</div>

				{#if !hasUnlockedPersona}
					<div class="space-y-2">
						<Label for="passphrase">Passphrase to unlock persona</Label>
						<div class="flex gap-2">
							<Input
								id="passphrase"
								type="password"
								placeholder="Enter passphrase"
								bind:value={passphrase}
								onkeydown={(e) => e.key === 'Enter' && unlockPersona()}
								disabled={unlockLoading}
							/>
							<Button onclick={unlockPersona} disabled={unlockLoading || !passphrase.trim()}>
								{unlockLoading ? 'Unlocking…' : 'Unlock'}
							</Button>
						</div>
						{#if error}
							<p class="text-destructive text-sm">{error}</p>
						{/if}
					</div>
				{:else if hasUnlockedPersona}
					<div class="text-muted-foreground flex items-center gap-2 text-sm">
						<span>Persona unlocked</span>
						<Button variant="ghost" size="sm" onclick={lockSession}>
							<Lock class="h-4 w-4" />
							Lock
						</Button>
					</div>
				{/if}

				<div class="flex gap-2 pt-2">
					<Button onclick={handleSync} disabled={loading || !selected || !hasUnlockedPersona}>
						{loading ? 'Syncing…' : 'Sync profile'}
					</Button>
					<Button variant="outline" onclick={() => goto('/')}>Cancel</Button>
				</div>
			</CardContent>
		</Card>
	{/if}
</div>
