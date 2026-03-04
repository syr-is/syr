<script lang="ts">
	import { tick } from 'svelte';
	import { invoke } from '@tauri-apps/api/core';
	import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@syr-is/ui/card';
	import { Button } from '@syr-is/ui/button';
	import { Input } from '@syr-is/ui/input';
	import { Label } from '@syr-is/ui/label';
	import { Textarea } from '@syr-is/ui/textarea';
	import { Loader, PenLine, Lock } from '@lucide/svelte';
	import PersonaUnlockForm from '$lib/components/fragments/persona-unlock-form.svelte';
	import { toast } from 'svelte-sonner';
	import { sessionSeed, selectedPersona } from '$lib/stores/session';
	import PersonaImage from '$lib/components/persona-image.svelte';

	let payload = $state('');
	let pastedKey = $state('');
	let personaPassphrase = $state('');
	let canonicalizeJson = $state(true);
	let loading = $state(false);
	let unlockLoading = $state(false);
	let error = $state<string | null>(null);
	let signature = $state<string | null>(null);
	let seedFromStore = $state<string | null>(null);
	let persona = $state<{
		id: string;
		displayName: string;
		did: string;
		avatarUrl?: string;
		bannerUrl?: string;
		avatarMtime?: number;
		bannerMtime?: number;
	} | null>(null);

	$effect(() => {
		const unsubSeed = sessionSeed.subscribe((v) => {
			seedFromStore = v;
		});
		const unsubPersona = selectedPersona.subscribe((v) => {
			persona = v;
		});
		return () => {
			unsubSeed();
			unsubPersona();
		};
	});

	/** Effective key: from session, from persona unlock, or from pasted */
	let effectiveKey = $derived(
		seedFromStore ?? (pastedKey.trim().length > 0 ? pastedKey.trim() : null)
	);

	function bytesToBase64(bytes: number[]): string {
		return btoa(String.fromCharCode(...new Uint8Array(bytes)));
	}

	function lockSession() {
		sessionSeed.set(null);
		selectedPersona.set(null);
		pastedKey = '';
		personaPassphrase = '';
		signature = null;
		error = null;
	}

	async function unlockPersona() {
		if (!persona || !personaPassphrase.trim()) {
			error = 'Enter passphrase to unlock persona.';
			return;
		}
		unlockLoading = true;
		error = null;
		await tick();
		try {
			const seed = await invoke<number[]>('decrypt_persona_sigil_cmd', {
				personaId: persona.id,
				passphrase: personaPassphrase.trim()
			});
			sessionSeed.set(bytesToBase64(seed));
			personaPassphrase = '';
			toast.success('Persona unlocked');
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
			toast.error(error);
		} finally {
			unlockLoading = false;
		}
	}

	async function signPayload() {
		const seed = effectiveKey;
		if (!seed) {
			if (persona) {
				error = 'Unlock the persona with your passphrase first.';
			} else {
				error =
					'No key. Import a sigil and use "Use for signing", select a persona, or paste a private key.';
			}
			return;
		}
		if (!payload.trim()) {
			error = 'Enter a payload to sign.';
			return;
		}
		loading = true;
		error = null;
		signature = null;
		try {
			let payloadStr = payload;
			if (canonicalizeJson) {
				try {
					const parsed = JSON.parse(payloadStr);
					payloadStr = await invoke<string>('canonicalize_cmd', {
						objJson: JSON.stringify(parsed)
					});
				} catch (parseErr) {
					error = parseErr instanceof Error ? parseErr.message : 'Invalid JSON';
					toast.error(error);
					loading = false;
					return;
				}
			}
			const payloadBytes = Array.from(new TextEncoder().encode(payloadStr));
			const sigBytes = await invoke<number[]>('sign_payload', {
				payload: payloadBytes,
				privateKeyBase64: seed
			});
			const sigMultibase = await invoke<string>('encode_multibase_cmd', {
				bytes: sigBytes
			});
			signature = sigMultibase;
			toast.success('Payload signed');
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
			toast.error(error);
		} finally {
			loading = false;
		}
	}
</script>

<div class="flex flex-col gap-6 p-4 md:p-6">
	<h1 class="text-2xl font-bold">Sign</h1>

	{#if seedFromStore || pastedKey.trim()}
		<div
			class="border-border relative flex items-center gap-3 overflow-hidden rounded-lg border px-3 py-2 text-sm {persona?.bannerUrl
				? ''
				: 'bg-muted/50'}"
		>
			{#if persona?.bannerUrl}
				<PersonaImage
					personaId={persona.id}
					role="banner"
					mtime={persona.bannerMtime}
					variant="banner"
					class="absolute inset-0 bg-cover bg-center"
				/>
			{/if}
			{#if persona}
				<PersonaImage
					personaId={persona.id}
					role="avatar"
					mtime={persona.avatarMtime}
					displayName={persona.displayName}
					variant="avatar"
					class="relative z-10 h-8 w-8 shrink-0"
				/>
			{/if}
			<span class="text-muted-foreground relative z-10 flex-1">
				{seedFromStore
					? persona
						? `Unlocked: ${persona.displayName}`
						: 'Key in session'
					: 'Key from input'}
			</span>
			<Button class="relative z-10" variant="ghost" size="sm" onclick={lockSession}>
				<Lock class="h-4 w-4" />
				Lock
			</Button>
		</div>
	{:else if persona}
		<div
			class="border-border relative space-y-3 overflow-hidden rounded-lg border p-4 {persona.bannerUrl
				? ''
				: 'bg-muted/50'}"
		>
			{#if persona.bannerUrl}
				<PersonaImage
					personaId={persona.id}
					role="banner"
					mtime={persona.bannerMtime}
					variant="banner"
					class="absolute inset-0 bg-cover bg-center"
				/>
			{/if}
			<div class="relative z-10 flex items-center gap-3">
				<PersonaImage
					personaId={persona.id}
					role="avatar"
					mtime={persona.avatarMtime}
					displayName={persona.displayName}
					variant="avatar"
					class="h-12 w-12 shrink-0"
				/>
				<div class="min-w-0 flex-1">
					<p class="text-sm font-medium">Sign with: {persona.displayName}</p>
					<p class="text-muted-foreground truncate font-mono text-xs">{persona.did}</p>
				</div>
			</div>
			<div class="relative z-10 flex gap-2">
				<PersonaUnlockForm
					bind:passphrase={personaPassphrase}
					loading={unlockLoading}
					onUnlock={unlockPersona}
					placeholder="Passphrase to unlock"
				/>
			</div>
		</div>
	{/if}

	<Card>
		<CardHeader>
			<CardTitle class="flex items-center gap-2">
				<PenLine class="h-5 w-5" />
				Sign payload
			</CardTitle>
			<CardDescription>
				Sign a payload with your identity. Select a persona from the list, import a sigil, or paste
				a private key.
			</CardDescription>
		</CardHeader>
		<CardContent class="flex flex-col gap-4">
			{#if !seedFromStore && !persona}
				<p class="text-muted-foreground text-sm">
					Select a persona from the
					<a href="/" class="text-primary underline">Personas</a> page, or
					<a href="/import" class="text-primary underline">import a sigil</a> and use "Use for signing",
					or paste your private key (base64, 32 bytes) below.
				</p>
				<div class="space-y-2">
					<Label for="private-key">Private key (base64)</Label>
					<Input
						id="private-key"
						type="password"
						placeholder="Paste 32-byte private key as base64"
						bind:value={pastedKey}
						disabled={loading}
					/>
				</div>
			{/if}

			<div class="space-y-2">
				<Label for="payload">Payload (text or JSON)</Label>
				<Textarea
					id="payload"
					bind:value={payload}
					placeholder={'{"hello": "world"} or plain text'}
					rows={4}
					disabled={loading}
				/>
			</div>

			<div class="flex items-center gap-2">
				<input
					type="checkbox"
					id="canonicalize"
					bind:checked={canonicalizeJson}
					disabled={loading}
				/>
				<Label for="canonicalize">Canonicalize JSON before signing</Label>
			</div>

			<div class="flex gap-2">
				<Button onclick={signPayload} disabled={loading || !effectiveKey}>
					{#if loading}
						<Loader class="h-4 w-4 animate-spin" />
						Signing…
					{:else}
						Sign
					{/if}
				</Button>
			</div>

			{#if signature}
				<div class="border-border bg-muted/50 space-y-2 rounded-lg border p-4">
					<p class="text-muted-foreground text-sm font-medium">Signature (multibase)</p>
					<p class="font-mono text-sm break-all select-all">{signature}</p>
				</div>
			{/if}

			{#if error}
				<p class="text-destructive text-sm">{error}</p>
			{/if}
		</CardContent>
	</Card>
</div>
