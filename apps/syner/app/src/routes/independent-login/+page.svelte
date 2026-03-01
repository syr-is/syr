<script lang="ts">
	import { invoke } from '@tauri-apps/api/core';
	import { openUrl } from '@tauri-apps/plugin-opener';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { get } from 'svelte/store';
	import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@syr-is/ui/card';
	import * as Avatar from '@syr-is/ui/avatar';
	import { Button } from '@syr-is/ui/button';
	import { Input } from '@syr-is/ui/input';
	import { Label } from '@syr-is/ui/label';
	import { Loader2, LogIn, Lock } from '@lucide/svelte';
	import { toast } from 'svelte-sonner';
	import { sessionSeed, selectedPersona } from '$lib/stores/session';
	import { toAvatarSrc, getInitials } from '$lib/utils';
	import type { Persona } from '$lib/types';

	let challengeId = $state<string | null>(null);
	let instanceUrl = $state<string | null>(null);
	let callbackBase = $state<string | null>(null);
	let message = $state<string | null>(null);
	let domain = $state<string | null>(null);
	let personas = $state<Persona[]>([]);
	let selected = $state<Persona | null>(null);
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
		const url = page.url;
		const c = url.searchParams.get('challenge');
		const i = url.searchParams.get('instance');
		const cb = url.searchParams.get('callback');
		if (c) challengeId = c;
		if (i) instanceUrl = i;
		if (cb) callbackBase = cb;
	});

	$effect(() => {
		if (challengeId && instanceUrl) {
			fetchChallenge();
		}
	});

	async function fetchChallenge() {
		if (!challengeId || !instanceUrl) return;
		try {
			const base = instanceUrl.replace(/\/$/, '');
			const res = await fetch(`${base}/api/auth/independent-login/challenge/${challengeId}`);
			if (!res.ok) {
				const data = await res.json().catch(() => ({}));
				error = data.error_description ?? 'Challenge expired or not found';
				return;
			}
			const data = await res.json();
			message = data.message;
			domain = data.domain;
			error = null;
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to fetch challenge';
		}
	}

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
				bannerUrl: selected.bannerUrl
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

	async function signAndVerify() {
		const s = get(sessionSeed);
		const persona = get(selectedPersona);
		if (!challengeId || !instanceUrl || !callbackBase || !message) {
			error = 'Missing challenge data.';
			return;
		}
		if (!s) {
			error = 'Unlock a persona first.';
			return;
		}
		if (!persona) {
			error = 'Select and unlock a persona.';
			return;
		}
		loading = true;
		error = null;
		try {
			const payloadBytes = Array.from(new TextEncoder().encode(message));
			const sigBytes = await invoke<number[]>('sign_payload', {
				payload: payloadBytes,
				privateKeyBase64: s
			});
			const signature = await invoke<string>('encode_multibase_cmd', {
				bytes: sigBytes
			});
			const base = instanceUrl.replace(/\/$/, '');
			const verifyRes = await fetch(`${base}/api/auth/independent-login/verify`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					challenge_id: challengeId,
					did: persona.did,
					signature
				})
			});
			const verifyData = await verifyRes.json();
			if (!verifyRes.ok) {
				const errMsg = verifyData.error_description ?? 'Verification failed';
				error = errMsg;
				toast.error(errMsg);
				return;
			}
			const token = verifyData.callback_token;
			const callbackUrl = `${callbackBase}?token=${encodeURIComponent(token)}`;
			await openUrl(callbackUrl);
			toast.success('Sign in complete. Returning to browser.');
			lockSession();
			goto('/');
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
			toast.error(error);
		} finally {
			loading = false;
		}
	}
</script>

<div class="flex flex-col gap-6 p-4 md:p-6">
	<h1 class="flex items-center gap-2 text-2xl font-bold">
		<LogIn class="h-7 w-7" />
		Sign in with Syner
	</h1>

	{#if !challengeId || !instanceUrl}
		<Card>
			<CardContent class="pt-6">
				<p class="text-muted-foreground text-sm">
					Open this page via the QR code or link from the SYR login screen.
				</p>
				<Button variant="outline" class="mt-4" href="/">Back to Personas</Button>
			</CardContent>
		</Card>
	{:else if error && !message}
		<Card>
			<CardContent class="pt-6">
				<p class="text-destructive text-sm">{error}</p>
				<Button variant="outline" class="mt-4" href="/">Back to Personas</Button>
			</CardContent>
		</Card>
	{:else if message && domain}
		<Card>
			<CardHeader>
				<CardTitle>Authenticate with {domain}</CardTitle>
				<CardDescription>
					Sign the challenge below to prove you control this identity.
				</CardDescription>
			</CardHeader>
			<CardContent class="space-y-4">
				{#if personas.length === 0}
					<p class="text-muted-foreground text-sm">No personas. Create or import one first.</p>
					<Button variant="outline" href="/">Go to Personas</Button>
				{:else}
					<div class="space-y-2">
						<Label>Select persona</Label>
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
					</div>

					{#if selected}
						{#if hasUnlockedPersona}
							<div class="flex items-center gap-2">
								<span class="text-muted-foreground text-sm">Unlocked: {selected.displayName}</span>
								<Button variant="ghost" size="sm" onclick={lockSession}>
									<Lock class="h-4 w-4" />
									Lock
								</Button>
							</div>
						{:else}
							<div class="flex gap-2">
								<Input
									type="password"
									placeholder="Passphrase"
									bind:value={passphrase}
									disabled={unlockLoading}
								/>
								<Button onclick={unlockPersona} disabled={unlockLoading || !passphrase.trim()}>
									{unlockLoading ? 'Unlocking…' : 'Unlock'}
								</Button>
							</div>
						{/if}
					{/if}

					<div class="flex gap-2 pt-2">
						<Button onclick={signAndVerify} disabled={loading || !selected || !hasUnlockedPersona}>
							{#if loading}
								<Loader2 class="h-4 w-4 animate-spin" />
								Signing in…
							{:else}
								Sign in
							{/if}
						</Button>
						<Button variant="outline" href="/">Cancel</Button>
					</div>
				{/if}

				{#if error}
					<p class="text-destructive text-sm">{error}</p>
				{/if}
			</CardContent>
		</Card>
	{:else}
		<p class="text-muted-foreground text-sm">Loading challenge…</p>
	{/if}
</div>
