<script lang="ts">
	import { page } from '$app/state';
	import { invoke } from '@tauri-apps/api/core';
	import { fetch } from '@tauri-apps/plugin-http';
	import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@syr-is/ui/card';
	import { Button } from '@syr-is/ui/button';
	import { Input } from '@syr-is/ui/input';
	import { Label } from '@syr-is/ui/label';
	import { toast } from 'svelte-sonner';
	import { Loader } from '@lucide/svelte';
	import { validateInstanceUrl } from '$lib/utils/syr-url';
	import { resolveSynerEndpoint } from '$lib/instance-manifest';
	import type { Persona } from '$lib/types';
	import PersonaImage from '$lib/components/persona-image.svelte';

	const origin = $derived(page.url.searchParams.get('origin') ?? '');
	const sessionId = $derived(page.url.searchParams.get('session') ?? '');
	const expectedDid = $derived(page.url.searchParams.get('did')?.trim() ?? '');

	const hasSession = $derived(!!sessionId.trim());
	const hasDidBinding = $derived(expectedDid.startsWith('did:syr:'));

	let instanceUrl = $derived(
		origin ? (validateInstanceUrl(origin) ?? validateInstanceUrl(`${origin}/`) ?? null) : null
	);

	let personas = $state<Persona[]>([]);
	let loadingList = $state(true);
	let sending = $state(false);
	let userConfirmed = $state(false);
	let passphrase = $state('');

	let payload = $state<Record<string, unknown> | null>(null);
	let requestedDevicePk = $state<string | null>(null);
	let loadError = $state<string | null>(null);

	type PayloadView = 'pretty' | 'jcs';
	let payloadView = $state<PayloadView>('pretty');
	let canonicalJcs = $state<string | null>(null);
	let jcsError = $state(false);

	const prettyPayloadText = $derived(payload ? JSON.stringify(payload, null, 2) : '');

	const payloadPreviewText = $derived.by(() => {
		if (!payload) return '';
		if (payloadView === 'pretty') return prettyPayloadText;
		if (canonicalJcs !== null) return canonicalJcs;
		if (jcsError) return '(Could not produce RFC 8785 JCS for this payload.)';
		return 'Loading canonical form…';
	});

	$effect(() => {
		if (!payload) {
			canonicalJcs = null;
			jcsError = false;
			return;
		}
		const obj = payload;
		jcsError = false;
		let cancelled = false;
		void invoke<string>('canonicalize_cmd', { objJson: JSON.stringify(obj) })
			.then((s) => {
				if (cancelled) return;
				canonicalJcs = s;
			})
			.catch(() => {
				if (cancelled) return;
				jcsError = true;
				canonicalJcs = null;
			});
		return () => {
			cancelled = true;
		};
	});

	const isProfilePayload = $derived(payload?.type === 'profile@v1');
	const isCommentPayload = $derived(payload?.type === 'comment@v1');

	const payloadLabel = $derived(
		isProfilePayload ? 'profile' : isCommentPayload ? 'comment' : 'post'
	);

	let matchingPersonas = $derived(
		hasDidBinding ? personas.filter((p) => p.did === expectedDid) : []
	);
	let targetPersona = $derived(matchingPersonas.length === 1 ? matchingPersonas[0]! : null);

	function bytesToBase64(bytes: number[]): string {
		const u8 = new Uint8Array(bytes);
		const step = 8192;
		let bin = '';
		for (let i = 0; i < u8.length; i += step) {
			const slice = u8.subarray(i, Math.min(i + step, u8.length));
			bin += String.fromCharCode(...slice);
		}
		return btoa(bin);
	}

	/** Syner `profile.json` stores the raw Ed25519 pubkey as standard base64; SYR stores multibase(`z…`) of multicodec-prefixed key (same as `did:syr` method id). */
	const ED25519_PUB_MULTICODEC = new Uint8Array([0xed, 0x01]);

	function base64ToBytes(b64: string): Uint8Array {
		const s = b64.trim();
		const bin = atob(s);
		const out = new Uint8Array(bin.length);
		for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
		return out;
	}

	async function personaPublicKeyMultibase(persona: Persona): Promise<string> {
		const pk = persona.publicKey.trim();
		if (pk.startsWith('z')) {
			return pk;
		}
		const raw = base64ToBytes(pk);
		if (raw.length !== 32) {
			throw new Error('Invalid persona public key (expected 32-byte Ed25519 key)');
		}
		const prefixed = new Uint8Array(ED25519_PUB_MULTICODEC.length + 32);
		prefixed.set(ED25519_PUB_MULTICODEC, 0);
		prefixed.set(raw, ED25519_PUB_MULTICODEC.length);
		return await invoke<string>('encode_multibase_cmd', { bytes: Array.from(prefixed) });
	}

	$effect(() => {
		if (!hasSession || !hasDidBinding) {
			loadingList = false;
			return;
		}
		loadingList = true;
		void invoke<Persona[]>('list_personas_cmd')
			.then((list) => {
				personas = list ?? [];
			})
			.catch(() => {
				toast.error('Could not load personas');
				personas = [];
			})
			.finally(() => {
				loadingList = false;
			});
	});

	let fetchSeq = 0;
	$effect(() => {
		if (!instanceUrl || !sessionId.trim()) {
			fetchSeq++;
			payload = null;
			requestedDevicePk = null;
			loadError = null;
			userConfirmed = false;
			passphrase = '';
			return;
		}
		fetchSeq++;
		const seq = fetchSeq;
		loadError = null;
		payload = null;
		userConfirmed = false;
		passphrase = '';
		void (async () => {
			try {
				const url = await resolveSynerEndpoint(instanceUrl, 'post_sign_payload', sessionId);
				const res = await fetch(url, { method: 'GET' });
				const j = await res.json().catch(() => ({}));
				if (seq !== fetchSeq) return;
				if (!res.ok) {
					loadError =
						(j as { error?: { message?: string } }).error?.message ?? `HTTP ${res.status}`;
					return;
				}
				const data = (j as { data?: { payload?: unknown; requested_device_public_key?: string } })
					.data;
				const p = data?.payload;
				if (!p || typeof p !== 'object') {
					loadError = 'Invalid payload from server';
					return;
				}
				payload = p as Record<string, unknown>;
				requestedDevicePk = data?.requested_device_public_key ?? null;
			} catch (e) {
				if (seq !== fetchSeq) return;
				loadError = e instanceof Error ? e.message : 'Failed to load payload';
			}
		})();
	});

	async function signAndUpload() {
		if (!instanceUrl || !sessionId.trim() || !targetPersona || !userConfirmed || !payload) return;
		if (!requestedDevicePk) {
			toast.error('Missing signing key from server');
			return;
		}
		if (!passphrase.trim()) {
			toast.error('Enter your Sigil passphrase');
			return;
		}

		sending = true;
		try {
			const expectedMb = requestedDevicePk.trim();
			let personaMb: string;
			try {
				personaMb = await personaPublicKeyMultibase(targetPersona);
			} catch (e) {
				toast.error(e instanceof Error ? e.message : 'Invalid persona public key');
				return;
			}
			if (personaMb !== expectedMb) {
				toast.error(
					'This persona key does not match the signing session. Use the root identity that started publish in SYR.'
				);
				return;
			}

			const seed = await invoke<number[]>('decrypt_persona_sigil_cmd', {
				personaId: targetPersona.id,
				passphrase
			});
			const seedB64 = bytesToBase64(seed);
			const canonicalStr = await invoke<string>('canonicalize_cmd', {
				objJson: JSON.stringify(payload)
			});
			const payloadBytes = Array.from(new TextEncoder().encode(canonicalStr));
			const sigBytes = await invoke<number[]>('sign_payload', {
				payload: payloadBytes,
				privateKeyBase64: seedB64
			});
			const signature = await invoke<string>('encode_multibase_cmd', { bytes: sigBytes });

			const envelope = {
				payload,
				signature,
				device_public_key: expectedMb
			};

			const putUrl = await resolveSynerEndpoint(instanceUrl, 'post_sign_signature', sessionId);
			const res = await fetch(putUrl, {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(envelope)
			});
			if (!res.ok) {
				const errJ = await res.json().catch(() => ({}));
				const msg =
					(errJ as { error?: { message?: string } }).error?.message ?? `HTTP ${res.status}`;
				throw new Error(msg);
			}
			toast.success(`Signature sent. Return to SYR to finish your ${payloadLabel}.`);
			userConfirmed = false;
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Signing failed');
		} finally {
			passphrase = '';
			sending = false;
		}
	}
</script>

<div class="mx-auto max-w-lg space-y-4 p-4">
	<Card>
		<CardHeader>
			<CardTitle>Sign {payloadLabel} in Syner</CardTitle>
			<CardDescription>
				{#if instanceUrl}
					Instance <span class="font-mono">{instanceUrl}</span>
				{:else}
					<span class="font-mono">{origin || '—'}</span>
				{/if}
			</CardDescription>
		</CardHeader>
		<CardContent class="space-y-4 text-sm">
			<p class="text-muted-foreground">
				<strong class="text-foreground">Trust:</strong>
				Only sign if you started this {payloadLabel} action on a SYR tab you trust. Syner signs the exact
				payload shown by your instance.
			</p>

			{#if !hasSession}
				<p
					class="rounded-md border border-amber-200 bg-amber-50 p-3 text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-100"
				>
					Missing <code class="font-mono">session</code>. Start the signing flow from SYR first.
				</p>
			{:else if !hasDidBinding}
				<p
					class="rounded-md border border-amber-200 bg-amber-50 p-3 text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-100"
				>
					Missing or invalid <code class="font-mono">did</code> in the link.
				</p>
			{:else if loadingList}
				<p class="text-muted-foreground flex items-center gap-2">
					<Loader class="h-4 w-4 animate-spin" />
					Loading…
				</p>
			{:else if loadError}
				<p class="text-destructive">{loadError}</p>
			{:else if !payload}
				<p class="text-muted-foreground">Loading payload…</p>
			{:else}
				<div class="space-y-2">
					<div class="flex flex-wrap items-center justify-between gap-2">
						<span class="text-foreground text-sm font-medium">
							{payloadView === 'pretty' ? 'Payload (pretty JSON)' : 'Signed bytes (RFC 8785 JCS)'}
						</span>
						<div
							class="border-border bg-muted/40 inline-flex rounded-md border p-0.5 text-[11px]"
							role="group"
							aria-label="Payload display format"
						>
							<button
								type="button"
								class="rounded px-2 py-1 font-medium transition-colors {payloadView === 'pretty'
									? 'bg-background text-foreground shadow-sm'
									: 'text-muted-foreground hover:text-foreground'}"
								onclick={() => (payloadView = 'pretty')}
							>
								Pretty
							</button>
							<button
								type="button"
								class="rounded px-2 py-1 font-medium transition-colors {payloadView === 'jcs'
									? 'bg-background text-foreground shadow-sm'
									: 'text-muted-foreground hover:text-foreground'}"
								onclick={() => (payloadView = 'jcs')}
							>
								JCS
							</button>
						</div>
					</div>
					<div class="bg-muted/40 rounded-md border p-3 font-mono text-xs break-all">
						<pre
							class="text-foreground max-h-40 overflow-auto whitespace-pre-wrap select-all">{payloadPreviewText}</pre>
					</div>
					<p class="text-muted-foreground text-xs">
						Syner signs the <strong class="text-foreground">JCS</strong> string, not the pretty-printed
						view.
					</p>
				</div>

				{#if matchingPersonas.length === 0}
					<p class="text-destructive">
						No Syner persona for this DID. Import this identity in Syner first.
					</p>
					<p class="text-muted-foreground font-mono text-xs break-all select-all">{expectedDid}</p>
				{:else if matchingPersonas.length > 1}
					<p class="text-destructive">
						Multiple personas match this DID. Remove duplicates or pick one in Syner (not supported
						on this screen yet).
					</p>
				{:else if targetPersona}
					<div class="flex items-center gap-3 rounded-md border p-3">
						<PersonaImage
							personaId={targetPersona.id}
							role="avatar"
							mtime={targetPersona.avatarMtime}
							displayName={targetPersona.displayName}
							variant="avatar"
							class="size-12 shrink-0 rounded-full"
						/>
						<div class="min-w-0 flex-1">
							<p class="truncate font-medium">{targetPersona.displayName}</p>
							<p class="text-muted-foreground font-mono text-xs break-all select-all">
								{targetPersona.did}
							</p>
						</div>
					</div>

					<label class="flex cursor-pointer items-start gap-2">
						<input type="checkbox" bind:checked={userConfirmed} class="mt-1" />
						<span>
							I am signing this {payloadLabel} on SYR and want to sign this payload.
						</span>
					</label>

					<div class="space-y-2">
						<Label for="ps-pass">Sigil passphrase</Label>
						<Input
							id="ps-pass"
							type="password"
							autocomplete="off"
							bind:value={passphrase}
							disabled={sending}
						/>
					</div>

					<Button
						type="button"
						disabled={sending || !userConfirmed || !passphrase.trim()}
						onclick={() => void signAndUpload()}
						class="w-full"
					>
						{#if sending}
							<Loader class="mr-2 h-4 w-4 animate-spin" />
						{/if}
						Sign and send to SYR
					</Button>
				{/if}
			{/if}
		</CardContent>
	</Card>
</div>
