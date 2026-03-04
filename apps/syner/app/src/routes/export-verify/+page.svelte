<script lang="ts">
	import { tick } from 'svelte';
	import { invoke } from '@tauri-apps/api/core';
	import { fetch } from '@tauri-apps/plugin-http';
	import { error as logError, info } from '@tauri-apps/plugin-log';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { get } from 'svelte/store';
	import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@syr-is/ui/card';
	import { Button } from '@syr-is/ui/button';
	import PersonaImage from '$lib/components/persona-image.svelte';
	import ExportVerifyPersonaSelector from '$lib/components/fragments/export-verify-persona-selector.svelte';
	import { Loader, Lock, ShieldCheck } from '@lucide/svelte';
	import PersonaUnlockForm from '$lib/components/fragments/persona-unlock-form.svelte';
	import { toast } from 'svelte-sonner';
	import { sessionSeed, selectedPersona } from '$lib/stores/session';
	import { validateInstanceUrl } from '$lib/utils/syr-url';
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
	let targetDid = $state<string | null>(null);
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

	let didFromUrl = $derived(page.url.searchParams.get('did'));

	let latestFetchSeq = 0;

	$effect(() => {
		const url = page.url;
		const c = url.searchParams.get('challenge');
		const i = url.searchParams.get('instance');
		challengeId = c || null;
		instanceUrl = i ? (validateInstanceUrl(i) ?? null) : null;
	});

	$effect(() => {
		if (challengeId && instanceUrl) {
			fetchChallenge();
		}
	});

	async function fetchChallenge() {
		if (!challengeId || !instanceUrl) return;
		latestFetchSeq++;
		const seq = latestFetchSeq;
		const base = instanceUrl.replace(/\/$/, '');
		const url = `${base}/api/identity/export-challenge/${challengeId}`;
		info(`[export-verify] Fetching challenge`);
		loadError = null;
		message = null;
		domain = null;
		targetDid = null;
		selected = null;
		error = null;
		try {
			const res = await fetch(url);
			if (seq !== latestFetchSeq) return;
			info(`[export-verify] Challenge response status: ${res.status} ${res.statusText}`);
			if (!res.ok) {
				const data = await res.json().catch(() => ({}));
				if (seq !== latestFetchSeq) return;
				const errDesc = data.error_description ?? 'Challenge expired or not found';
				error = errDesc;
				logError(
					`[export-verify] Challenge fetch failed: ${res.status} - ${redactErrorPayload(data)}`
				);
				return;
			}
			const data = await res.json();
			if (seq !== latestFetchSeq) return;
			message = data.message;
			domain = data.domain;
			targetDid = didFromUrl ?? (typeof data.did === 'string' ? data.did : null) ?? null;
			error = null;
			info(`[export-verify] Challenge loaded for domain: ${domain}`);

			const list = await invoke<Persona[]>('list_personas_cmd').catch((): Persona[] => []);
			if (seq !== latestFetchSeq) return;
			personas = list ?? [];
			if (targetDid) {
				const match = personas.find((p) => p.did === targetDid);
				if (match) {
					selected = match;
				} else {
					loadError =
						'Profile not found on this device. Import the identity that matches your SYR account.';
					toast.error(loadError);
				}
			}
		} catch (e) {
			if (seq !== latestFetchSeq) return;
			const msg = e instanceof Error ? e.message : String(e);
			const cause = e instanceof Error && e.cause ? String(e.cause) : '';
			const stack = e instanceof Error ? e.stack : '';
			logError(
				`[export-verify] Challenge fetch error: ${msg}${cause ? ` (cause: ${cause})` : ''}${stack ? `\n${stack}` : ''}`
			);
			error = msg;
		}
	}

	$effect(() => {
		if (!challengeId || !instanceUrl) {
			loadPersonas();
		}
	});

	async function loadPersonas() {
		try {
			personas = await invoke<Persona[]>('list_personas_cmd');
		} catch {
			personas = [] as Persona[];
		}
	}

	async function unlockPersona() {
		if (!selected || !passphrase.trim()) {
			error = 'Select a persona and enter passphrase.';
			return;
		}
		unlockLoading = true;
		error = null;
		await tick();
		try {
			const seed = await invoke<number[]>('decrypt_persona_sigil_cmd', {
				personaId: selected.id,
				passphrase: passphrase.trim()
			});
			const bytesToBase64 = (bytes: number[]) =>
				btoa(String.fromCharCode(...new Uint8Array(bytes)));
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
		loading = true;
		error = null;
		const base = instanceUrl.replace(/\/$/, '');
		const verifyUrl = `${base}/api/identity/export-verify`;
		info(`[export-verify] Signing challenge and verifying at ${verifyUrl}`);
		try {
			const payloadBytes = Array.from(new TextEncoder().encode(message));
			const sigBytes = await invoke<number[]>('sign_payload', {
				payload: payloadBytes,
				privateKeyBase64: s
			});
			const signature = await invoke<string>('encode_multibase_cmd', {
				bytes: sigBytes
			});
			info(`[export-verify] Signature created, posting verify request`);
			const verifyRes = await fetch(verifyUrl, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					challenge_id: challengeId,
					did: persona.did,
					signature
				})
			});
			info(`[export-verify] Verify response: ${verifyRes.status} ${verifyRes.statusText}`);
			const verifyData = await verifyRes.json();
			if (!verifyRes.ok) {
				const errMsg = verifyData.error_description ?? 'Verification failed';
				error = errMsg;
				logError(
					`[export-verify] Verify failed: ${verifyRes.status} - ${redactErrorPayload(verifyData)}`
				);
				toast.error(errMsg);
				return;
			}
			info(`[export-verify] Verification success`);

			toast.success('Verification complete. Return to the browser to continue.');
			lockSession();
			goto('/');
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			const cause = e instanceof Error && e.cause ? String(e.cause) : '';
			const stack = e instanceof Error ? e.stack : '';
			logError(
				`[export-verify] Sign/verify error: ${msg}${cause ? ` (cause: ${cause})` : ''}${stack ? `\n${stack}` : ''}`
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
		<ShieldCheck class="h-7 w-7" />
		Verify with Syner
	</h1>

	{#if !challengeId || !instanceUrl}
		<Card>
			<CardContent class="pt-6">
				<p class="text-muted-foreground text-sm">
					Open this page via the QR code or link from the SYR export or import screen.
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
	{:else if loadError}
		<Card>
			<CardContent class="pt-6">
				<p class="text-destructive text-sm">{loadError}</p>
				<Button variant="outline" class="mt-4" href="/">Back to Personas</Button>
			</CardContent>
		</Card>
	{:else if message && domain}
		<Card>
			<CardHeader>
				<CardTitle>Verify identity for {domain}</CardTitle>
				<CardDescription>
					Unlock your persona to sign the challenge. Used for export or import.
				</CardDescription>
			</CardHeader>
			<CardContent class="space-y-4">
				{#if personas.length === 0}
					<p class="text-muted-foreground text-sm">No personas. Create or import one first.</p>
					<Button variant="outline" href="/">Go to Personas</Button>
				{:else if selected}
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

					{#if hasUnlockedPersona}
						<div class="flex items-center gap-2">
							<span class="text-muted-foreground text-sm">Unlocked: {selected.displayName}</span>
							<Button variant="ghost" size="sm" onclick={lockSession}>
								<Lock class="h-4 w-4" />
								Lock
							</Button>
						</div>
					{:else}
						<PersonaUnlockForm bind:passphrase loading={unlockLoading} onUnlock={unlockPersona} />
					{/if}

					<div class="flex gap-2 pt-2">
						<Button onclick={signAndVerify} disabled={loading || !hasUnlockedPersona}>
							{#if loading}
								<Loader class="h-4 w-4 animate-spin" />
								Verifying…
							{:else}
								Sign and verify
							{/if}
						</Button>
						<Button variant="outline" href="/">Cancel</Button>
					</div>
				{:else}
					<ExportVerifyPersonaSelector {personas} {selected} onSelect={(p) => (selected = p)} />
					<div class="flex gap-2 pt-2">
						<Button onclick={signAndVerify} disabled={loading || !selected || !hasUnlockedPersona}>
							{#if loading}
								<Loader class="h-4 w-4 animate-spin" />
								Verifying…
							{:else}
								Sign and verify
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
