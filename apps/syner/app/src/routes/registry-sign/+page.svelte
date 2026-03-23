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

	let signObject = $state<Record<string, unknown> | null>(null);
	let canonicalPayload = $state<string | null>(null);
	let directorySignObject = $state<Record<string, unknown> | null>(null);
	let directoryCanonicalPayload = $state<string | null>(null);
	let registryUrl = $state<string | null>(null);
	let registryAction = $state<string | null>(null);
	let requestedDevicePk = $state<string | null>(null);
	let loadError = $state<string | null>(null);

	type PayloadView = 'pretty' | 'jcs';
	let payloadView = $state<PayloadView>('pretty');
	let canonicalJcs = $state<string | null>(null);
	let jcsError = $state(false);
	let directoryCanonicalJcs = $state<string | null>(null);
	let directoryJcsError = $state(false);

	const prettyPayloadText = $derived(signObject ? JSON.stringify(signObject, null, 2) : '');

	const prettyDirectoryText = $derived(
		directorySignObject ? JSON.stringify(directorySignObject, null, 2) : ''
	);

	const payloadPreviewText = $derived.by(() => {
		if (!signObject) return '';
		if (payloadView === 'pretty') return prettyPayloadText;
		if (canonicalJcs !== null) return canonicalJcs;
		if (jcsError) return '(Could not produce RFC 8785 JCS for this payload.)';
		return 'Loading canonical form…';
	});

	const directoryPreviewText = $derived.by(() => {
		if (!directorySignObject) return '';
		if (payloadView === 'pretty') return prettyDirectoryText;
		if (directoryCanonicalJcs !== null) return directoryCanonicalJcs;
		if (directoryJcsError) return '(Could not produce RFC 8785 JCS for this payload.)';
		return 'Loading canonical form…';
	});

	$effect(() => {
		if (!signObject) {
			canonicalJcs = null;
			jcsError = false;
			return;
		}
		const obj = signObject;
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

	$effect(() => {
		if (!directorySignObject) {
			directoryCanonicalJcs = null;
			directoryJcsError = false;
			return;
		}
		const obj = directorySignObject;
		directoryJcsError = false;
		let cancelled = false;
		void invoke<string>('canonicalize_cmd', { objJson: JSON.stringify(obj) })
			.then((s) => {
				if (cancelled) return;
				directoryCanonicalJcs = s;
			})
			.catch(() => {
				if (cancelled) return;
				directoryJcsError = true;
				directoryCanonicalJcs = null;
			});
		return () => {
			cancelled = true;
		};
	});

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
			signObject = null;
			canonicalPayload = null;
			directorySignObject = null;
			directoryCanonicalPayload = null;
			registryUrl = null;
			registryAction = null;
			requestedDevicePk = null;
			loadError = null;
			return;
		}
		fetchSeq++;
		const seq = fetchSeq;
		loadError = null;
		signObject = null;
		canonicalPayload = null;
		directorySignObject = null;
		directoryCanonicalPayload = null;
		void (async () => {
			try {
				const base = instanceUrl.replace(/\/$/, '');
				const url = `${base}/api/user/registry-sign/${encodeURIComponent(sessionId)}/payload`;
				const res = await fetch(url, { method: 'GET' });
				if (seq !== fetchSeq) return;
				if (!res.ok) {
					loadError = `HTTP ${res.status}`;
					try {
						const j = (await res.json()) as { error?: { message?: string } };
						loadError = j.error?.message ?? loadError;
					} catch {
						/* non-JSON error body */
					}
					return;
				}
				let j: unknown;
				try {
					j = await res.json();
				} catch {
					if (seq !== fetchSeq) return;
					loadError = 'Invalid JSON from server';
					return;
				}
				if (seq !== fetchSeq) return;
				const data = (
					j as {
						data?: {
							sign_object?: unknown;
							canonical_payload?: string;
							directory_sign_object?: unknown;
							directory_canonical_payload?: string;
							registry_url?: string;
							action?: string;
							requested_device_public_key?: string;
						};
					}
				)?.data;
				const so = data?.sign_object;
				if (!so || typeof so !== 'object' || Array.isArray(so)) {
					loadError = 'Invalid payload from server';
					return;
				}
				const cp = data?.canonical_payload;
				if (typeof cp !== 'string' || !cp.trim()) {
					loadError = 'Missing canonical payload from server';
					return;
				}
				const dso = data?.directory_sign_object;
				if (!dso || typeof dso !== 'object' || Array.isArray(dso)) {
					loadError = 'Invalid directory payload from server';
					return;
				}
				const dcp = data?.directory_canonical_payload;
				if (typeof dcp !== 'string' || !dcp.trim()) {
					loadError = 'Missing directory canonical payload from server';
					return;
				}
				signObject = so as Record<string, unknown>;
				canonicalPayload = cp;
				directorySignObject = dso as Record<string, unknown>;
				directoryCanonicalPayload = dcp;
				registryUrl = data?.registry_url ?? null;
				registryAction = data?.action ?? null;
				requestedDevicePk = data?.requested_device_public_key ?? null;
			} catch (e) {
				if (seq !== fetchSeq) return;
				loadError = e instanceof Error ? e.message : 'Failed to load payload';
			}
		})();
	});

	async function signAndUpload() {
		if (
			!instanceUrl ||
			!sessionId.trim() ||
			!targetPersona ||
			!userConfirmed ||
			!canonicalPayload?.trim() ||
			!directoryCanonicalPayload?.trim()
		)
			return;
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
					'This persona key does not match the signing session. Use the root identity that started registry sync in SYR.'
				);
				return;
			}

			const seed = await invoke<number[]>('decrypt_persona_sigil_cmd', {
				personaId: targetPersona.id,
				passphrase: passphrase.trim()
			});
			const seedB64 = bytesToBase64(seed);
			const payloadBytes = Array.from(new TextEncoder().encode(canonicalPayload));
			const sigBytes = await invoke<number[]>('sign_payload', {
				payload: payloadBytes,
				privateKeyBase64: seedB64
			});
			const signature = await invoke<string>('encode_multibase_cmd', { bytes: sigBytes });

			const dirPayloadBytes = Array.from(new TextEncoder().encode(directoryCanonicalPayload));
			const dirSigBytes = await invoke<number[]>('sign_payload', {
				payload: dirPayloadBytes,
				privateKeyBase64: seedB64
			});
			const directory_signature = await invoke<string>('encode_multibase_cmd', {
				bytes: dirSigBytes
			});

			const base = instanceUrl.replace(/\/$/, '');
			const putUrl = `${base}/api/user/registry-sign/${encodeURIComponent(sessionId)}/signature`;
			const res = await fetch(putUrl, {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					signature,
					directory_signature,
					device_public_key: expectedMb
				})
			});
			const putBody = (await res.json().catch(() => ({}))) as {
				status?: string;
				error?: { message?: string };
			};
			if (!res.ok) {
				const msg = putBody.error?.message ?? `HTTP ${res.status}`;
				throw new Error(msg);
			}
			if (putBody.status === 'partial') {
				toast.warning(
					'The registry accepted your signature, but SYR could not finalize the signing session. Open SYR → Identity to check status or retry.'
				);
				userConfirmed = false;
				return;
			}
			toast.success('Registry signature sent. Return to SYR.');
			userConfirmed = false;
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Signing failed');
		} finally {
			passphrase = '';
			userConfirmed = false;
			sending = false;
		}
	}
</script>

<div class="mx-auto max-w-lg space-y-4 p-4">
	<Card>
		<CardHeader>
			<CardTitle>Sign publication registry in Syner</CardTitle>
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
				<strong class="text-foreground">Trust:</strong> Only sign if you started registry sync on a SYR
				tab you trust. Syner signs two payloads: the hosting record and the searchable directory row
				(same root key).
			</p>

			{#if !hasSession}
				<p
					class="rounded-md border border-amber-200 bg-amber-50 p-3 text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-100"
				>
					Missing <code class="font-mono">session</code>. Start from SYR → Settings → Identity →
					Sign with Syner.
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
			{:else if !signObject}
				<p class="text-muted-foreground">Loading payload…</p>
			{:else}
				{#if registryUrl}
					<p class="text-muted-foreground text-xs">
						Registry: <span class="text-foreground font-mono break-all">{registryUrl}</span>
						{#if registryAction}
							· <span class="font-mono">{registryAction}</span>
						{/if}
					</p>
				{/if}
				<div class="space-y-2">
					<p class="text-foreground text-xs font-medium">1. Publication (hosting record)</p>
					<div class="flex flex-wrap items-center justify-between gap-2">
						<span class="text-foreground text-sm font-medium">
							{payloadView === 'pretty'
								? 'Signed object (pretty JSON)'
								: 'Signed bytes (RFC 8785 JCS)'}
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
						Syner signs the UTF-8 bytes of each <strong class="text-foreground">JCS</strong> string (must
						match the server).
					</p>
				</div>

				<div class="space-y-2">
					<p class="text-foreground text-xs font-medium">2. Directory (search / discovery)</p>
					<div class="bg-muted/40 rounded-md border p-3 font-mono text-xs break-all">
						<pre
							class="text-foreground max-h-40 overflow-auto whitespace-pre-wrap select-all">{directoryPreviewText}</pre>
					</div>
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
						<span>I want to sign this registry update (hosting + directory) for SYR.</span>
					</label>

					<div class="space-y-2">
						<Label for="rs-pass">Sigil passphrase</Label>
						<Input
							id="rs-pass"
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
