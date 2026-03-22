<script lang="ts">
	import { onMount } from 'svelte';
	import {
		initCryptoWasm,
		verify,
		canonicalize,
		decodeMultibase,
		decodePublicKey
	} from '@syr-is/crypto';
	import { parseDid } from '@syr-is/did';
	import { Badge } from '@syr-is/ui/badge';
	import * as Accordion from '@syr-is/ui/accordion';

	let {
		did,
		signedPayloadJson,
		signatureMultibase,
		signingPublicKeyMultibase
	}: {
		did: string;
		signedPayloadJson?: string | null;
		signatureMultibase?: string | null;
		signingPublicKeyMultibase?: string | null;
	} = $props();

	type VerifyState = 'idle' | 'none' | 'bad' | 'mismatch' | 'ok_root' | 'ok_device';
	type PayloadView = 'pretty' | 'jcs';
	type MaterialEncoding = 'multibase' | 'base64';

	let status = $state<VerifyState>('idle');
	let canonicalJcs = $state<string | null>(null);
	let jcsUnavailable = $state(false);
	let payloadView = $state<PayloadView>('pretty');
	let sigMaterialEncoding = $state<MaterialEncoding>('multibase');
	let pkMaterialEncoding = $state<MaterialEncoding>('multibase');
	let signatureRawBase64 = $state<string | null>(null);
	let pubkeyRawBase64 = $state<string | null>(null);
	let signatureB64DecodeFailed = $state(false);
	let pubkeyB64DecodeFailed = $state(false);

	function bytesToBase64(bytes: Uint8Array): string {
		const chunk = 0x8000;
		let binary = '';
		for (let i = 0; i < bytes.length; i += chunk) {
			binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
		}
		return btoa(binary);
	}

	const prettySignedPayload = $derived.by(() => {
		if (!signedPayloadJson?.trim()) return '';
		try {
			return JSON.stringify(JSON.parse(signedPayloadJson) as unknown, null, 2);
		} catch {
			return signedPayloadJson;
		}
	});

	const payloadPreText = $derived.by(() => {
		if (payloadView === 'pretty') return prettySignedPayload;
		if (canonicalJcs !== null) return canonicalJcs;
		if (jcsUnavailable) return '(Could not produce RFC 8785 JCS for this payload.)';
		return 'Loading canonical form…';
	});

	const signatureDisplay = $derived.by(() => {
		if (!signatureMultibase?.trim()) return '';
		if (sigMaterialEncoding === 'multibase') return signatureMultibase;
		if (signatureRawBase64 !== null) return signatureRawBase64;
		if (signatureB64DecodeFailed) return '(Could not decode signature multibase.)';
		return 'Loading base64…';
	});

	const pubkeyDisplay = $derived.by(() => {
		if (!signingPublicKeyMultibase?.trim()) return '';
		if (pkMaterialEncoding === 'multibase') return signingPublicKeyMultibase;
		if (pubkeyRawBase64 !== null) return pubkeyRawBase64;
		if (pubkeyB64DecodeFailed) return '(Could not decode public key multibase.)';
		return 'Loading base64…';
	});

	$effect(() => {
		const sm = signatureMultibase?.trim();
		const pkm = signingPublicKeyMultibase?.trim();
		if (!sm && !pkm) {
			signatureRawBase64 = null;
			pubkeyRawBase64 = null;
			signatureB64DecodeFailed = false;
			pubkeyB64DecodeFailed = false;
			return;
		}
		let cancelled = false;
		void (async () => {
			try {
				await initCryptoWasm();
				if (cancelled) return;
				signatureB64DecodeFailed = false;
				pubkeyB64DecodeFailed = false;
				if (sm) {
					try {
						signatureRawBase64 = bytesToBase64(decodeMultibase(sm));
					} catch {
						signatureRawBase64 = null;
						signatureB64DecodeFailed = true;
					}
				} else {
					signatureRawBase64 = null;
				}
				if (pkm) {
					try {
						pubkeyRawBase64 = bytesToBase64(decodePublicKey(pkm));
					} catch {
						pubkeyRawBase64 = null;
						pubkeyB64DecodeFailed = true;
					}
				} else {
					pubkeyRawBase64 = null;
				}
			} catch {
				if (!cancelled) {
					signatureRawBase64 = null;
					pubkeyRawBase64 = null;
					signatureB64DecodeFailed = !!sm;
					pubkeyB64DecodeFailed = !!pkm;
				}
			}
		})();
		return () => {
			cancelled = true;
		};
	});

	function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
		if (a.length !== b.length) return false;
		for (let i = 0; i < a.length; i++) {
			if (a[i] !== b[i]) return false;
		}
		return true;
	}

	onMount(() => {
		(async () => {
			if (signedPayloadJson?.trim()) {
				try {
					await initCryptoWasm();
					const payload = JSON.parse(signedPayloadJson) as Record<string, unknown>;
					if (typeof payload === 'object' && payload !== null) {
						canonicalJcs = canonicalize(payload);
					} else {
						jcsUnavailable = true;
					}
				} catch {
					jcsUnavailable = true;
				}
			}

			if (!signedPayloadJson || !signatureMultibase || !signingPublicKeyMultibase) {
				status = 'none';
				return;
			}
			try {
				await initCryptoWasm();
				const payload = JSON.parse(signedPayloadJson) as Record<string, unknown>;
				if (typeof payload !== 'object' || payload === null) {
					status = 'bad';
					return;
				}
				const payloadDid = payload.did;
				if (typeof payloadDid !== 'string' || payloadDid !== did) {
					status = 'mismatch';
					return;
				}
				const msg = canonicalJcs ?? canonicalize(payload);
				const sig = decodeMultibase(signatureMultibase);
				const pk = decodePublicKey(signingPublicKeyMultibase);
				const ok = await verify(msg, sig, pk);
				if (!ok) {
					status = 'bad';
					return;
				}
				let rootPk: Uint8Array;
				try {
					rootPk = parseDid(did).publicKey;
				} catch {
					status = 'bad';
					return;
				}
				status = bytesEqual(pk, rootPk) ? 'ok_root' : 'ok_device';
			} catch {
				status = 'bad';
			}
		})();
	});
</script>

<Accordion.Root type="single" class="@container w-full rounded-md border border-border bg-muted/30">
	<Accordion.Item value="verification" class="border-b-0">
		<Accordion.Trigger class="px-3 py-3 hover:no-underline data-[state=open]:pb-2 [&>svg]:shrink-0">
			<div class="flex min-w-0 flex-1 flex-wrap items-center gap-2 text-start">
				{#if status === 'none'}
					<Badge variant="secondary" title="No signature was stored for this content">
						Not signed
					</Badge>
				{:else if status === 'idle'}
					<Badge variant="outline">Checking…</Badge>
				{:else if status === 'mismatch'}
					<Badge variant="destructive">Payload DID mismatch</Badge>
				{:else if status === 'ok_root'}
					<Badge variant="default" class="bg-emerald-600 hover:bg-emerald-600">
						Signature valid (root)
					</Badge>
				{:else if status === 'ok_device'}
					<Badge
						variant="outline"
						title="Ed25519 verifies; delegation chain is not re-checked in the browser"
					>
						Device signature valid
					</Badge>
				{:else}
					<Badge
						variant="destructive"
						title="Ed25519 verification failed or the signed payload could not be read"
					>
						Signature invalid
					</Badge>
				{/if}
				<span class="hidden text-xs font-normal text-muted-foreground @min-[22rem]:inline">
					Expand for signed payload, crypto material, and manual verification steps
				</span>
			</div>
		</Accordion.Trigger>
		<Accordion.Content class="px-3 pb-4">
			<div class="space-y-4 border-t border-border pt-3 text-xs text-muted-foreground">
				{#if prettySignedPayload}
					<div>
						<div class="mb-2 flex flex-wrap items-center justify-between gap-2">
							<span class="font-medium text-foreground">
								{payloadView === 'pretty'
									? 'Signed payload (pretty JSON)'
									: 'Signed bytes (RFC 8785 JCS)'}
							</span>
							<div
								class="inline-flex rounded-md border border-border bg-muted/40 p-0.5 text-[11px]"
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
						<pre
							class="max-h-64 overflow-auto rounded-md border border-border bg-background/80 p-2 font-mono text-[11px] leading-relaxed break-all whitespace-pre-wrap text-foreground select-all">{payloadPreText}</pre>
					</div>
				{/if}
				<div>
					<span class="mb-0.5 block font-medium text-foreground">DID</span>
					<span class="block font-mono break-all text-foreground select-all">{did}</span>
				</div>
				{#if signatureMultibase}
					<div>
						<div class="mb-2 flex flex-wrap items-center justify-between gap-2">
							<span class="font-medium text-foreground">
								Signature ({sigMaterialEncoding === 'multibase'
									? 'multibase z…'
									: 'raw bytes, base64'})
							</span>
							<div
								class="inline-flex rounded-md border border-border bg-muted/40 p-0.5 text-[11px]"
								role="group"
								aria-label="Signature encoding"
							>
								<button
									type="button"
									class="rounded px-2 py-1 font-medium transition-colors {sigMaterialEncoding ===
									'multibase'
										? 'bg-background text-foreground shadow-sm'
										: 'text-muted-foreground hover:text-foreground'}"
									onclick={() => (sigMaterialEncoding = 'multibase')}
								>
									Multibase
								</button>
								<button
									type="button"
									class="rounded px-2 py-1 font-medium transition-colors {sigMaterialEncoding ===
									'base64'
										? 'bg-background text-foreground shadow-sm'
										: 'text-muted-foreground hover:text-foreground'}"
									onclick={() => (sigMaterialEncoding = 'base64')}
								>
									Base64
								</button>
							</div>
						</div>
						<span class="block font-mono break-all text-foreground select-all"
							>{signatureDisplay}</span
						>
					</div>
				{/if}
				{#if signingPublicKeyMultibase}
					<div>
						<div class="mb-2 flex flex-wrap items-center justify-between gap-2">
							<span class="font-medium text-foreground">
								Signing public key ({pkMaterialEncoding === 'multibase'
									? 'multibase z…'
									: 'raw 32-byte key, base64'})
							</span>
							<div
								class="inline-flex rounded-md border border-border bg-muted/40 p-0.5 text-[11px]"
								role="group"
								aria-label="Public key encoding"
							>
								<button
									type="button"
									class="rounded px-2 py-1 font-medium transition-colors {pkMaterialEncoding ===
									'multibase'
										? 'bg-background text-foreground shadow-sm'
										: 'text-muted-foreground hover:text-foreground'}"
									onclick={() => (pkMaterialEncoding = 'multibase')}
								>
									Multibase
								</button>
								<button
									type="button"
									class="rounded px-2 py-1 font-medium transition-colors {pkMaterialEncoding ===
									'base64'
										? 'bg-background text-foreground shadow-sm'
										: 'text-muted-foreground hover:text-foreground'}"
									onclick={() => (pkMaterialEncoding = 'base64')}
								>
									Base64
								</button>
							</div>
						</div>
						<span class="block font-mono break-all text-foreground select-all">{pubkeyDisplay}</span
						>
					</div>
				{/if}
				<div class="space-y-2 rounded-md border border-border bg-background/60 p-3">
					<span class="block font-medium text-foreground">Manual verification</span>
					<p class="leading-relaxed">
						Syr signs the <strong class="font-medium text-foreground">RFC&nbsp;8785 JCS</strong>
						string (use the <strong class="font-medium text-foreground">JCS</strong> toggle above), not
						the pretty-printed view. To verify offline:
					</p>
					<p class="leading-relaxed">
						<strong class="font-medium text-foreground">Base64</strong> above is the raw Ed25519
						material:
						<strong class="font-medium text-foreground">64&nbsp;bytes</strong> for the signature,
						<strong class="font-medium text-foreground">32&nbsp;bytes</strong> for the public key
						(multicodec stripped). For a quick check in the browser, the third-party
						<a
							class="text-primary underline underline-offset-2"
							href="https://cyphr.me/ed25519_tool/ed.html"
							target="_blank"
							rel="noopener noreferrer">Cyphr.me Ed25519 tool</a
						>
						(<strong class="font-medium text-foreground">Algorithm: Ed25519</strong>, not Ed25519ph)
						can verify: paste the <strong class="font-medium text-foreground">JCS</strong> string as
						the message (<strong class="font-medium text-foreground">Text / UTF-8</strong>), set key
						and signature encoding to <strong class="font-medium text-foreground">base64</strong>,
						and paste the toggles above. It runs client-side; treat it like any other external tool.
						You can also use OpenSSL 3
						<code class="rounded bg-muted px-1 py-0.5 font-mono text-[11px]">pkeyutl</code>,
						libsodium, or this page’s built-in check.
					</p>
					<ol class="list-decimal space-y-1.5 pl-4 leading-relaxed">
						<li>
							Parse the payload as a JSON object. Confirm <code
								class="rounded bg-muted px-1 py-0.5 font-mono text-[11px] text-foreground">did</code
							>
							matches the author DID shown here.
						</li>
						<li>
							Apply <strong class="font-medium text-foreground">RFC&nbsp;8785</strong> JSON Canonicalization
							Scheme (JCS) to that object to produce a single canonical string (stable key order and
							serialization rules).
						</li>
						<li>
							Encode that string as <strong class="font-medium text-foreground">UTF-8</strong> bytes
							— those bytes are the message
							<code class="rounded bg-muted px-1 py-0.5 font-mono text-[11px] text-foreground"
								>M</code
							>
							passed to Ed25519. You do <em>not</em> apply an extra hash yourself; standard Ed25519 verification
							(RFC&nbsp;8032) uses SHA-512 inside the algorithm.
						</li>
						<li>
							Decode the signature multibase string (Syr uses <strong
								class="font-medium text-foreground">base58btc</strong
							>, prefix
							<code class="rounded bg-muted px-1 py-0.5 font-mono text-[11px] text-foreground"
								>z</code
							>) to <strong class="font-medium text-foreground">64 raw bytes</strong> (Ed25519
							signature), or copy the <strong class="font-medium text-foreground">Base64</strong> toggle
							value (same bytes).
						</li>
						<li>
							Decode the signing public key multibase to bytes, strip the <strong
								class="font-medium text-foreground">multicodec</strong
							>
							prefix for Ed25519 public keys (<code
								class="rounded bg-muted px-1 py-0.5 font-mono text-[11px] text-foreground"
								>0xed 0x01</code
							>), leaving the <strong class="font-medium text-foreground">32-byte</strong> Ed25519
							public key — or use the <strong class="font-medium text-foreground">Base64</strong> toggle
							(same 32 bytes).
						</li>
						<li>
							Run <strong class="font-medium text-foreground">Ed25519 verify</strong> on
							<code class="rounded bg-muted px-1 py-0.5 font-mono text-[11px] text-foreground"
								>M</code
							>, signature, and public key. If the signing key equals the key embedded in
							<code class="rounded bg-muted px-1 py-0.5 font-mono text-[11px] text-foreground"
								>did:syr:…</code
							>, the post was signed by the identity root key; otherwise it may be a delegated
							device key (delegation is enforced server-side, not re-checked here).
						</li>
					</ol>
				</div>
			</div>
		</Accordion.Content>
	</Accordion.Item>
</Accordion.Root>
