<script lang="ts">
	import { invoke } from '@tauri-apps/api/core';
	import { fetch } from '@tauri-apps/plugin-http';
	import { error as logError, info } from '@tauri-apps/plugin-log';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { get } from 'svelte/store';
	import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@syr-is/ui/card';
	import { Button } from '@syr-is/ui/button';
	import PersonaImage from '$lib/components/persona-image.svelte';
	import { Input } from '@syr-is/ui/input';
	import { Label } from '@syr-is/ui/label';
	import { Loader2, LogIn, Lock } from '@lucide/svelte';
	import { toast } from 'svelte-sonner';
	import { sessionSeed, selectedPersona } from '$lib/stores/session';
	import { validateInstanceUrl } from '$lib/utils/syr-url';
	import { syncProfileToSyr } from '$lib/sync-profile';
	import type { Persona } from '$lib/types';

	function redactErrorPayload(data: unknown): string {
		if (!data || typeof data !== 'object') return String(data);
		const o = data as Record<string, unknown>;
		return JSON.stringify({
			error: o.error,
			error_description: o.error_description,
			error_code: o.error_code
		});
	}

	let challengeId = $state<string | null>(null);
	let instanceUrl = $state<string | null>(null);
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
		if (c) challengeId = c;
		if (i) {
			const validated = validateInstanceUrl(i);
			instanceUrl = validated ?? null;
		}
	});

	$effect(() => {
		if (challengeId && instanceUrl) {
			fetchChallenge();
		}
	});

	async function fetchChallenge() {
		if (!challengeId || !instanceUrl) return;
		const base = instanceUrl.replace(/\/$/, '');
		const url = `${base}/api/auth/independent-login/challenge/${challengeId}`;
		info(`[independent-login] Fetching challenge: ${url}`);
		try {
			const res = await fetch(url);
			info(`[independent-login] Challenge response status: ${res.status} ${res.statusText}`);
			if (!res.ok) {
				const data = await res.json().catch(() => ({}));
				const errDesc = data.error_description ?? 'Challenge expired or not found';
				error = errDesc;
				logError(
					`[independent-login] Challenge fetch failed: ${res.status} - ${redactErrorPayload(data)}`
				);
				return;
			}
			const data = await res.json();
			message = data.message;
			domain = data.domain;
			error = null;
			info(`[independent-login] Challenge loaded for domain: ${domain}`);
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			const cause = e instanceof Error && e.cause ? String(e.cause) : '';
			const stack = e instanceof Error ? e.stack : '';
			logError(
				`[independent-login] Challenge fetch error: ${msg}${cause ? ` (cause: ${cause})` : ''}${stack ? `\n${stack}` : ''}`
			);
			error = msg;
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

	async function signAndVerify() {
		const s = get(sessionSeed);
		const persona = get(selectedPersona);
		if (!challengeId || !instanceUrl || !message) {
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
		const snapshotSelected = selected;
		loading = true;
		error = null;
		const base = instanceUrl.replace(/\/$/, '');
		const verifyUrl = `${base}/api/auth/independent-login/verify`;
		info(`[independent-login] Signing challenge and verifying at ${verifyUrl}`);
		try {
			const payloadBytes = Array.from(new TextEncoder().encode(message));
			const sigBytes = await invoke<number[]>('sign_payload', {
				payload: payloadBytes,
				privateKeyBase64: s
			});
			const signature = await invoke<string>('encode_multibase_cmd', {
				bytes: sigBytes
			});
			info(`[independent-login] Signature created, posting verify request`);
			const verifyRes = await fetch(verifyUrl, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					challenge_id: challengeId,
					did: persona.did,
					signature,
					profile: snapshotSelected
						? {
								display_name: snapshotSelected.displayName,
								bio: snapshotSelected.bio ?? undefined
							}
						: undefined
				})
			});
			info(`[independent-login] Verify response: ${verifyRes.status} ${verifyRes.statusText}`);
			const verifyData = await verifyRes.json();
			if (!verifyRes.ok) {
				const errMsg = verifyData.error_description ?? 'Verification failed';
				error = errMsg;
				logError(
					`[independent-login] Verify failed: ${verifyRes.status} - ${redactErrorPayload(verifyData)}`
				);
				toast.error(errMsg);
				return;
			}
			info(`[independent-login] Verification success`);

			if (snapshotSelected && s) {
				try {
					await loadPersonas();
					const fresh = personas.find((p) => p.id === snapshotSelected.id) ?? snapshotSelected;
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
						instanceUrl.replace(/\/$/, ''),
						fresh.id,
						{ displayName: fresh.displayName, bio: fresh.bio, did: fresh.did },
						{ signature, signedPayload }
					);
				} catch (e) {
					logError(`[independent-login] Profile sync failed: ${e}`);
					// Non-fatal; user can sync from onboarding
				}
			}

			toast.success('Sign in complete. Check the browser where you scanned the QR.');
			lockSession();
			goto('/');
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			const cause = e instanceof Error && e.cause ? String(e.cause) : '';
			const stack = e instanceof Error ? e.stack : '';
			logError(
				`[independent-login] Sign/verify error: ${msg}${cause ? ` (cause: ${cause})` : ''}${stack ? `\n${stack}` : ''}`
			);
			error = msg;
			toast.error(msg);
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
									<PersonaImage
										personaId={p.id}
										role="avatar"
										mtime={p.avatarMtime}
										displayName={p.displayName}
										variant="avatar"
										class="h-10 w-10 shrink-0"
									/>
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
