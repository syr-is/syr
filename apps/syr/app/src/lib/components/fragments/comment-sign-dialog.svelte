<script lang="ts">
	import { onDestroy } from 'svelte';
	import * as Dialog from '@syr-is/ui/dialog';
	import { Button } from '@syr-is/ui/button';
	import { Input } from '@syr-is/ui/input';
	import { Label } from '@syr-is/ui/label';
	import { toast } from 'svelte-sonner';
	import QRCode from 'qrcode';
	import { getIdentityStore } from '$lib/stores/identity.svelte';
	import { buildCommentSignedPayloadV1 } from '$lib/client/comment-signed-payload';
	import { signMutationPayload } from '$lib/client/signed-mutation';
	import {
		getSigilSessionStatus,
		getLoadedSigilDid,
		unlockSigilSession,
		getUnlockedSigningSeed
	} from '$lib/client/sigil-session';
	import { seedHandler } from '$lib/services/seed-handler';
	import type { AegisBundle } from '@syr-is/crypto/aegis';
	import { pollPostSignSessionResult } from '$lib/client/post-sign-poll';
	import { Loader, Smartphone, KeyRound, LockKeyhole } from 'lucide-svelte';
	import { initCryptoWasm, canonicalize } from '@syr-is/crypto';

	let {
		open = $bindable(false),
		commentDid = '',
		commentLocalId = '',
		commentContent = '',
		commentPostDid = '',
		commentPostId = '',
		commentAncestorChain = [] as string[],
		visibility = 'public',
		status = 'completed',
		createdAtIso = '',
		onSigned
	}: {
		open?: boolean;
		commentDid?: string;
		commentLocalId?: string;
		commentContent?: string;
		commentPostDid?: string;
		commentPostId?: string;
		commentAncestorChain?: string[];
		visibility?: string;
		status?: string;
		createdAtIso?: string;
		onSigned?: (result: {
			content_signature: string;
			signed_payload_json: string;
			signing_device_public_key: string;
		}) => void;
	} = $props();

	const identityStore = getIdentityStore();
	const did = $derived(identityStore.identityContext?.did ?? null);
	const identityPublicKey = $derived(identityStore.identityContext?.identityPublicKey ?? null);
	const hasAegis = $derived(identityStore.identityContext?.hasAegis ?? false);

	let busy = $state(false);
	let sigilPassphrase = $state('');
	let aegisPassword = $state('');

	let synerDeeplink = $state<string | null>(null);
	let synerQr = $state<string | null>(null);
	let _synerSessionId = $state<string | null>(null);
	let synerPolling = $state(false);
	let synerPollAbort: AbortController | null = null;

	let sigilUiTick = $state(0);
	const sigilStatus = $derived.by(() => {
		void sigilUiTick;
		void open;
		return getSigilSessionStatus();
	});
	const sigilUnlocked = $derived(sigilStatus === 'unlocked');
	const sigilLocked = $derived(sigilStatus === 'loaded_locked');
	const showSynerOption = $derived(!!identityPublicKey);

	function resetSynerUi() {
		synerPollAbort?.abort();
		synerPollAbort = null;
		synerDeeplink = null;
		synerQr = null;
		_synerSessionId = null;
		synerPolling = false;
	}

	onDestroy(() => resetSynerUi());

	function buildPayload(): Record<string, unknown> {
		return buildCommentSignedPayloadV1({
			did: commentDid,
			commentLocalId,
			snapshot: {
				content: commentContent,
				post_did: commentPostDid,
				post_id: commentPostId,
				ancestor_chain: commentAncestorChain,
				visibility: visibility as 'public' | 'unlisted' | 'private',
				status: status as 'draft' | 'completed'
			},
			createdAtIso
		});
	}

	async function finishWithSeed(seed: Uint8Array) {
		await initCryptoWasm();
		const payload = buildPayload();
		const signature = await signMutationPayload(payload, seed);
		const payloadJson = canonicalize(payload);
		onSigned?.({
			content_signature: signature,
			signed_payload_json: payloadJson,
			signing_device_public_key: identityPublicKey!
		});
		open = false;
		resetSynerUi();
	}

	async function signWithUnlockedSigil() {
		let seed: Uint8Array | null = null;
		busy = true;
		try {
			const loadedDid = await getLoadedSigilDid();
			if (loadedDid !== did) throw new Error('Loaded Sigil is for a different identity.');
			seed = getUnlockedSigningSeed();
			if (!seed) throw new Error('Unlock your Sigil first.');
			await finishWithSeed(seed);
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Signing failed');
		} finally {
			seed?.fill(0);
			busy = false;
		}
	}

	async function signAfterUnlockSigil() {
		if (!sigilPassphrase.trim()) {
			toast.error('Enter your Sigil passphrase');
			return;
		}
		let seed: Uint8Array | null = null;
		busy = true;
		try {
			const loadedDid = await getLoadedSigilDid();
			if (loadedDid !== did) throw new Error('Loaded Sigil is for a different identity.');
			await unlockSigilSession(sigilPassphrase);
			sigilPassphrase = '';
			sigilUiTick++;
			seed = getUnlockedSigningSeed();
			if (!seed) throw new Error('Unlock failed.');
			await finishWithSeed(seed);
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Signing failed');
		} finally {
			seed?.fill(0);
			sigilPassphrase = '';
			busy = false;
		}
	}

	async function signWithAegis() {
		if (!aegisPassword.trim()) {
			toast.error('Enter your password');
			return;
		}
		busy = true;
		try {
			const res = await fetch('/api/identity/aegis-bundle');
			const j = await res.json();
			if (!res.ok) throw new Error(j.error?.message ?? 'Could not load Aegis bundle');
			const bundle = j.data?.aegisBundle as AegisBundle;
			if (!bundle) throw new Error('No Aegis bundle');
			await seedHandler.run({
				bundle,
				password: aegisPassword,
				action: async (seed) => {
					await finishWithSeed(seed);
				}
			});
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Aegis signing failed');
		} finally {
			aegisPassword = '';
			busy = false;
		}
	}

	async function startSynerSigning() {
		busy = true;
		resetSynerUi();
		try {
			const payload = buildPayload();
			const body = {
				payload,
				requested_device_public_key: identityPublicKey
			};
			const res = await fetch('/api/user/comment-sign-session', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(body)
			});
			const j = await res.json();
			if (!res.ok) throw new Error(j.error?.message ?? 'Could not start signing session');
			const sid = j.data?.session_id as string;
			const link = j.data?.deeplink_url as string;
			if (!sid || !link) throw new Error('Invalid session response');
			_synerSessionId = sid;
			synerDeeplink = link;
			synerQr = await QRCode.toDataURL(link, { margin: 1, width: 220 });
			void pollSyner(sid);
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Signing session failed');
			busy = false;
		}
	}

	async function pollSyner(sessionId: string) {
		synerPollAbort?.abort();
		synerPollAbort = new AbortController();
		const signal = synerPollAbort.signal;
		synerPolling = true;
		try {
			const env = await pollPostSignSessionResult(sessionId, { signal });
			synerPolling = false;
			resetSynerUi();
			// Extract signature fields from the envelope
			onSigned?.({
				content_signature: env.signature,
				signed_payload_json: canonicalize(env.payload as Record<string, unknown>),
				signing_device_public_key: env.device_public_key
			});
			open = false;
		} catch (e) {
			synerPolling = false;
			resetSynerUi();
			if (e instanceof DOMException && e.name === 'AbortError') return;
			if (open) toast.error(e instanceof Error ? e.message : 'Signing failed');
		} finally {
			busy = false;
		}
	}

	$effect(() => {
		if (!open) {
			resetSynerUi();
		}
	});
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="max-h-[90vh] max-w-lg overflow-y-auto">
		<Dialog.Header>
			<Dialog.Title>Sign comment</Dialog.Title>
			<Dialog.Description>
				Cryptographically sign this comment so viewers can verify your authorship.
			</Dialog.Description>
		</Dialog.Header>

		<div class="space-y-4 py-2">
			<div class="flex flex-col gap-2">
				{#if sigilUnlocked}
					<Button
						type="button"
						variant="secondary"
						disabled={busy || synerPolling}
						onclick={() => void signWithUnlockedSigil()}
						class="justify-start"
					>
						{#if busy}
							<Loader class="mr-2 h-4 w-4 animate-spin" />
						{:else}
							<KeyRound class="mr-2 h-4 w-4" />
						{/if}
						Sign with unlocked Sigil (this browser)
					</Button>
				{/if}

				{#if sigilLocked}
					<div class="space-y-2 rounded-md border border-border p-3">
						<Label for="comment-sigil-pass">Sigil passphrase</Label>
						<Input
							id="comment-sigil-pass"
							type="password"
							autocomplete="off"
							bind:value={sigilPassphrase}
							placeholder="Unlock Sigil in this tab…"
						/>
						<Button
							type="button"
							size="sm"
							disabled={busy || synerPolling || !sigilPassphrase.trim()}
							onclick={() => void signAfterUnlockSigil()}
						>
							Unlock &amp; sign with Sigil
						</Button>
					</div>
				{:else if sigilStatus === 'empty'}
					<p class="text-sm text-muted-foreground">
						No Sigil loaded in this tab. Use Aegis or Syner below, or load a Sigil in
						<strong>Settings &rarr; Signing</strong>.
					</p>
				{/if}

				{#if hasAegis}
					<div class="space-y-2 rounded-md border border-border p-3">
						<Label for="comment-aegis-pass" class="flex items-center gap-2">
							<LockKeyhole class="h-4 w-4" />
							Aegis password
						</Label>
						<Input
							id="comment-aegis-pass"
							type="password"
							autocomplete="off"
							bind:value={aegisPassword}
						/>
						<Button
							type="button"
							size="sm"
							disabled={busy || synerPolling || !aegisPassword.trim()}
							onclick={() => void signWithAegis()}
						>
							Sign with Aegis (custodial)
						</Button>
					</div>
				{/if}

				{#if showSynerOption}
					<div class="space-y-2">
						<Button
							type="button"
							variant="outline"
							disabled={busy || synerPolling}
							onclick={() => void startSynerSigning()}
							class="justify-start"
						>
							<Smartphone class="mr-2 h-4 w-4" />
							Sign with Syner (QR / app)
						</Button>
						{#if synerQr && synerDeeplink}
							<div class="flex flex-col items-center gap-2">
								<img src={synerQr} alt="Syner signing QR" class="rounded-md border" />
								<a
									href={synerDeeplink}
									class="text-sm font-medium text-primary underline"
									rel="noopener noreferrer"
								>
									Open in Syner
								</a>
								<p class="text-center text-xs text-muted-foreground">
									Or scan with another device. Use the persona for this DID:
								</p>
								<p
									class="max-w-full text-center font-mono text-xs break-all text-foreground select-all"
								>
									{did ?? ''}
								</p>
								{#if synerPolling}
									<p class="flex items-center gap-2 text-sm text-muted-foreground">
										<Loader class="h-4 w-4 animate-spin" />
										Waiting for Syner…
									</p>
								{/if}
							</div>
						{/if}
					</div>
				{/if}
			</div>
		</div>

		<Dialog.Footer>
			<Button
				type="button"
				variant="ghost"
				disabled={busy || synerPolling}
				onclick={() => {
					open = false;
					resetSynerUi();
				}}
			>
				Cancel
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
