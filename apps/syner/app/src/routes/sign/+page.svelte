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
	let signatureRawBase64 = $state<string | null>(null);
	let seedFromStore = $state<string | null>(null);

	type SigOutputEncoding = 'multibase' | 'base64';
	let sigOutputEncoding = $state<SigOutputEncoding>('multibase');

	type PayloadPreviewView = 'pretty' | 'jcs';
	let payloadPreviewView = $state<PayloadPreviewView>('pretty');
	let previewCanonicalJcs = $state<string | null>(null);
	let previewJcsError = $state(false);

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

	/** Any JSON value (object, array, etc.) — matches what “canonicalize JSON” can sign. */
	const parsedPayloadJson = $derived.by((): unknown | null => {
		const t = payload.trim();
		if (!t) return null;
		try {
			return JSON.parse(t) as unknown;
		} catch {
			return null;
		}
	});

	const prettyPreviewText = $derived(
		parsedPayloadJson !== null ? JSON.stringify(parsedPayloadJson, null, 2) : ''
	);

	const payloadPreviewText = $derived.by(() => {
		if (parsedPayloadJson === null) return '';
		if (payloadPreviewView === 'pretty') return prettyPreviewText;
		if (previewCanonicalJcs !== null) return previewCanonicalJcs;
		if (previewJcsError) return '(Could not produce RFC 8785 JCS for this payload.)';
		return 'Loading canonical form…';
	});

	$effect(() => {
		if (parsedPayloadJson === null) {
			previewCanonicalJcs = null;
			previewJcsError = false;
			return;
		}
		const obj = parsedPayloadJson;
		previewJcsError = false;
		let cancelled = false;
		void invoke<string>('canonicalize_cmd', { objJson: JSON.stringify(obj) })
			.then((s) => {
				if (cancelled) return;
				previewCanonicalJcs = s;
			})
			.catch(() => {
				if (cancelled) return;
				previewJcsError = true;
				previewCanonicalJcs = null;
			});
		return () => {
			cancelled = true;
		};
	});

	const signatureDisplay = $derived.by(() => {
		if (!signature) return '';
		if (sigOutputEncoding === 'multibase') return signature;
		return signatureRawBase64 ?? '';
	});

	function bytesToBase64(bytes: number[] | Uint8Array): string {
		const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
		const chunk = 0x8000;
		let binary = '';
		for (let i = 0; i < u8.length; i += chunk) {
			binary += String.fromCharCode(...u8.subarray(i, i + chunk));
		}
		return btoa(binary);
	}

	function lockSession() {
		sessionSeed.set(null);
		selectedPersona.set(null);
		pastedKey = '';
		personaPassphrase = '';
		signature = null;
		signatureRawBase64 = null;
		sigOutputEncoding = 'multibase';
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
		signatureRawBase64 = null;
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
			signatureRawBase64 = bytesToBase64(sigBytes);
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

			{#if parsedPayloadJson !== null}
				<div class="space-y-2">
					<div class="flex flex-wrap items-center justify-between gap-2">
						<span class="text-sm font-medium">
							{payloadPreviewView === 'pretty'
								? 'Preview: pretty JSON'
								: 'Preview: RFC 8785 JCS (what you sign if canonicalize is on)'}
						</span>
						<div
							class="border-border bg-muted/40 inline-flex rounded-md border p-0.5 text-[11px]"
							role="group"
							aria-label="Payload preview format"
						>
							<button
								type="button"
								class="rounded px-2 py-1 font-medium transition-colors {payloadPreviewView ===
								'pretty'
									? 'bg-background shadow-sm'
									: 'text-muted-foreground hover:text-foreground'}"
								onclick={() => (payloadPreviewView = 'pretty')}
							>
								Pretty
							</button>
							<button
								type="button"
								class="rounded px-2 py-1 font-medium transition-colors {payloadPreviewView === 'jcs'
									? 'bg-background shadow-sm'
									: 'text-muted-foreground hover:text-foreground'}"
								onclick={() => (payloadPreviewView = 'jcs')}
							>
								JCS
							</button>
						</div>
					</div>
					<div class="bg-muted/50 rounded-md border p-3 font-mono text-xs break-all">
						<pre
							class="max-h-48 overflow-auto whitespace-pre-wrap select-all">{payloadPreviewText}</pre>
					</div>
				</div>
			{/if}

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
					<div class="flex flex-wrap items-center justify-between gap-2">
						<p class="text-muted-foreground text-sm font-medium">
							Signature ({sigOutputEncoding === 'multibase'
								? 'multibase z…'
								: 'raw 64 bytes, base64'})
						</p>
						<div
							class="border-border bg-background inline-flex rounded-md border p-0.5 text-[11px]"
							role="group"
							aria-label="Signature encoding"
						>
							<button
								type="button"
								class="rounded px-2 py-1 font-medium transition-colors {sigOutputEncoding ===
								'multibase'
									? 'bg-muted shadow-sm'
									: 'text-muted-foreground hover:text-foreground'}"
								onclick={() => (sigOutputEncoding = 'multibase')}
							>
								Multibase
							</button>
							<button
								type="button"
								class="rounded px-2 py-1 font-medium transition-colors {sigOutputEncoding ===
								'base64'
									? 'bg-muted shadow-sm'
									: 'text-muted-foreground hover:text-foreground'}"
								onclick={() => (sigOutputEncoding = 'base64')}
							>
								Base64
							</button>
						</div>
					</div>
					<p class="font-mono text-sm break-all select-all">{signatureDisplay}</p>
					<p class="text-muted-foreground text-xs leading-relaxed">
						Syner uses <strong class="text-foreground">Ed25519</strong> over the exact bytes you
						sign (UTF-8 of the payload or JCS). For a third-party browser check, the
						<a
							class="text-primary underline underline-offset-2"
							href="https://cyphr.me/ed25519_tool/ed.html"
							target="_blank"
							rel="noopener noreferrer">Cyphr.me Ed25519 tool</a
						>
						accepts <strong class="text-foreground">Text (UTF-8)</strong> for the message and
						<strong class="text-foreground">base64</strong> for the public key and signature (use
						the
						<strong class="text-foreground">JCS</strong> preview and
						<strong class="text-foreground">Base64</strong>
						toggles above). Use <strong class="text-foreground">Ed25519</strong>, not Ed25519ph; the
						site runs client-side—only use it if you trust it.
					</p>
				</div>
			{/if}

			{#if error}
				<p class="text-destructive text-sm">{error}</p>
			{/if}
		</CardContent>
	</Card>
</div>
