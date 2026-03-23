<script lang="ts">
	import * as Dialog from '@syr-is/ui/dialog';
	import { Button } from '@syr-is/ui/button';
	import { Input } from '@syr-is/ui/input';
	import { Label } from '@syr-is/ui/label';
	import { toast } from 'svelte-sonner';
	import QRCode from 'qrcode';
	import { getIdentityStore } from '$lib/stores/identity.svelte';
	import {
		buildPostSignedPayloadV1,
		signPostMutationWithRootKey,
		verifySignedMutationEnvelopeLocally,
		type PostSignSnapshot
	} from '$lib/client/post-signed-payload';
	import type { SignedMutationEnvelope } from '@syr-is/types';
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

	let {
		open = $bindable(false),
		signMode,
		postLocalId,
		existingCreatedAtIso = null,
		snapshot,
		onSigned,
		onUnsigned,
		onDefer
	}: {
		open: boolean;
		signMode: 'create' | 'update';
		postLocalId: string;
		existingCreatedAtIso?: string | null;
		snapshot: PostSignSnapshot;
		onSigned: (envelope: SignedMutationEnvelope) => void | Promise<void>;
		onUnsigned: () => void | Promise<void>;
		onDefer: () => void;
	} = $props();

	const identityStore = getIdentityStore();

	const did = $derived(identityStore.identityContext?.did ?? null);
	const identityPublicKey = $derived(identityStore.identityContext?.identityPublicKey ?? null);
	const requireSignedMutations = $derived(
		identityStore.identityContext?.requireSignedMutations ?? false
	);
	const hasAegis = $derived(identityStore.identityContext?.hasAegis ?? false);
	let busy = $state(false);
	let sigilPassphrase = $state('');
	let aegisPassword = $state('');
	let unsignedWarnOpen = $state(false);

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

	function assertSigningPrereqs(): void {
		if (!did?.startsWith('did:syr:')) throw new Error('Not signed in with a DID.');
		if (!identityPublicKey) throw new Error('Missing identity public key. Reload the page.');
		if (signMode === 'update' && !existingCreatedAtIso?.trim()) {
			throw new Error('Missing post creation time for signed update.');
		}
	}

	function buildPayload() {
		assertSigningPrereqs();
		return buildPostSignedPayloadV1({
			did: did!,
			postLocalId,
			status: 'completed',
			snapshot,
			mode: signMode,
			existingCreatedAtIso: signMode === 'update' ? existingCreatedAtIso!.trim() : undefined
		});
	}

	async function finishWithEnvelope(envelope: SignedMutationEnvelope) {
		const ok = await verifySignedMutationEnvelopeLocally(envelope);
		if (!ok) {
			toast.error('Local signature check failed.');
			if (requireSignedMutations) return;
			unsignedWarnOpen = true;
			return;
		}
		await onSigned(envelope);
		open = false;
		resetSynerUi();
		sigilUiTick++;
	}

	async function signWithUnlockedSigil() {
		busy = true;
		try {
			const loadedDid = await getLoadedSigilDid();
			if (loadedDid !== did) {
				throw new Error('Loaded Sigil is for a different identity.');
			}
			const seed = getUnlockedSigningSeed();
			if (!seed) throw new Error('Unlock your Sigil first.');
			const payload = buildPayload();
			const env = await signPostMutationWithRootKey(payload, seed, identityPublicKey!);
			await finishWithEnvelope(env);
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Signing failed');
		} finally {
			busy = false;
		}
	}

	async function signAfterUnlockSigil() {
		if (!sigilPassphrase.trim()) {
			toast.error('Enter your Sigil passphrase');
			return;
		}
		busy = true;
		try {
			const loadedDid = await getLoadedSigilDid();
			if (loadedDid !== did) {
				throw new Error('Loaded Sigil is for a different identity.');
			}
			await unlockSigilSession(sigilPassphrase);
			sigilPassphrase = '';
			sigilUiTick++;
			const seed = getUnlockedSigningSeed();
			if (!seed) throw new Error('Unlock failed.');
			const payload = buildPayload();
			const env = await signPostMutationWithRootKey(payload, seed, identityPublicKey!);
			await finishWithEnvelope(env);
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Signing failed');
		} finally {
			busy = false;
		}
	}

	async function signWithAegis() {
		if (!aegisPassword.trim()) {
			toast.error('Enter your Aegis password');
			return;
		}
		busy = true;
		try {
			const res = await fetch('/api/identity/aegis-bundle');
			const j = await res.json();
			if (!res.ok) {
				throw new Error(j.error?.message ?? 'Could not load Aegis bundle');
			}
			const bundle = j.data?.aegisBundle as AegisBundle;
			if (!bundle) throw new Error('No Aegis bundle');
			const payload = buildPayload();
			await seedHandler.run({
				bundle,
				password: aegisPassword,
				action: async (seed) => {
					const env = await signPostMutationWithRootKey(payload, seed, identityPublicKey!);
					await finishWithEnvelope(env);
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
			const res = await fetch('/api/user/post-sign-session', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(body)
			});
			const j = await res.json();
			if (!res.ok) {
				throw new Error(j.error?.message ?? 'Could not start Syner session');
			}
			const sid = j.data?.session_id as string;
			const link = j.data?.deeplink_url as string;
			if (!sid || !link) throw new Error('Invalid session response');
			_synerSessionId = sid;
			synerDeeplink = link;
			synerQr = await QRCode.toDataURL(link, { margin: 1, width: 220 });
			void pollSyner(sid);
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Syner session failed');
		} finally {
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
			await finishWithEnvelope(env);
		} catch (e) {
			synerPolling = false;
			if (e instanceof DOMException && e.name === 'AbortError') return;
			if (open) {
				toast.error(e instanceof Error ? e.message : 'Syner signing failed');
			}
		}
	}

	function confirmUnsignedAnyway() {
		unsignedWarnOpen = false;
		resetSynerUi();
		open = false;
		void onUnsigned();
	}

	function handleDefer() {
		open = false;
		resetSynerUi();
		onDefer();
	}

	$effect(() => {
		if (!open) {
			resetSynerUi();
			unsignedWarnOpen = false;
		}
	});
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="max-h-[90vh] max-w-lg overflow-y-auto">
		<Dialog.Header>
			<Dialog.Title>Sign post</Dialog.Title>
			<Dialog.Description>
				Choose how to sign this publish action. Followers can verify the signature when viewing the
				post.
			</Dialog.Description>
		</Dialog.Header>

		<div class="space-y-4 py-2">
			{#if requireSignedMutations}
				<p class="text-sm text-muted-foreground">
					This instance requires a valid signature to publish. Unsigned or invalid signatures are
					not accepted by the server.
				</p>
			{:else}
				<p class="text-sm text-muted-foreground">
					You may publish without signing. Viewers may treat unsigned posts differently, and can see
					verification status in post details.
				</p>
			{/if}

			<div class="flex flex-col gap-2">
				{#if sigilUnlocked}
					<Button
						type="button"
						variant="secondary"
						disabled={busy}
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
						<Label for="pub-sigil-pass">Sigil passphrase</Label>
						<Input
							id="pub-sigil-pass"
							type="password"
							autocomplete="off"
							bind:value={sigilPassphrase}
							placeholder="Unlock Sigil in this tab…"
						/>
						<Button
							type="button"
							size="sm"
							disabled={busy || !sigilPassphrase.trim()}
							onclick={() => void signAfterUnlockSigil()}
						>
							Unlock &amp; sign with Sigil
						</Button>
					</div>
				{:else if sigilStatus === 'empty'}
					<p class="text-sm text-muted-foreground">
						No Sigil loaded in this tab. Open <strong>Settings → Signing</strong> to load or receive
						one, or use Aegis / Syner below.
					</p>
				{/if}

				{#if hasAegis}
					<div class="space-y-2 rounded-md border border-border p-3">
						<Label for="pub-aegis-pass" class="flex items-center gap-2">
							<LockKeyhole class="h-4 w-4" />
							Aegis password
						</Label>
						<Input
							id="pub-aegis-pass"
							type="password"
							autocomplete="off"
							bind:value={aegisPassword}
						/>
						<Button
							type="button"
							size="sm"
							disabled={busy || !aegisPassword.trim()}
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

		<Dialog.Footer class="flex-col gap-2 sm:flex-col">
			{#if !requireSignedMutations}
				<Button
					type="button"
					variant="secondary"
					disabled={busy}
					onclick={() => {
						unsignedWarnOpen = true;
					}}
				>
					Publish without signing
				</Button>
			{/if}
			<Button type="button" variant="ghost" disabled={busy} onclick={handleDefer}>
				Keep as draft
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>

<Dialog.Root bind:open={unsignedWarnOpen}>
	<Dialog.Content class="max-w-md">
		<Dialog.Header>
			<Dialog.Title>Publish without a valid signature?</Dialog.Title>
			<Dialog.Description>
				If you continue, this post will not be cryptographically signed. Followers may hide unsigned
				posts or see verification as failed when inspecting post data.
			</Dialog.Description>
		</Dialog.Header>
		<Dialog.Footer class="gap-2">
			<Button type="button" variant="outline" onclick={() => (unsignedWarnOpen = false)}>
				Back
			</Button>
			<Button type="button" variant="destructive" onclick={confirmUnsignedAnyway}>
				Publish anyway
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
