<script lang="ts">
	import { onDestroy } from 'svelte';
	import * as Dialog from '@syr-is/ui/dialog';
	import { Button } from '@syr-is/ui/button';
	import { Input } from '@syr-is/ui/input';
	import { Label } from '@syr-is/ui/label';
	import { toast } from 'svelte-sonner';
	import QRCode from 'qrcode';
	import { getIdentityStore } from '$lib/stores/identity.svelte';
	import {
		buildProfileSignedPayloadV1,
		signProfileMutationWithRootKey,
		verifyProfileSignedMutationEnvelopeLocally,
		type ProfileSignSnapshot
	} from '$lib/client/profile-signed-payload';
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
		snapshot,
		onSigned,
		onUnsigned,
		onDefer
	}: {
		open: boolean;
		snapshot: ProfileSignSnapshot;
		onSigned: (envelope: SignedMutationEnvelope) => boolean | void | Promise<boolean | void>;
		onUnsigned: () => boolean | void | Promise<boolean | void>;
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

	onDestroy(() => {
		synerPollAbort?.abort();
		synerPollAbort = null;
		synerDeeplink = null;
		synerQr = null;
		_synerSessionId = null;
		synerPolling = false;
	});

	function assertSigningPrereqs(): void {
		if (!did?.startsWith('did:syr:')) throw new Error('Not signed in with a DID.');
		if (!identityPublicKey) throw new Error('Missing identity public key. Reload the page.');
	}

	function buildPayload() {
		assertSigningPrereqs();
		return buildProfileSignedPayloadV1({ did: did!, snapshot });
	}

	async function finishWithEnvelope(envelope: SignedMutationEnvelope) {
		const ok = await verifyProfileSignedMutationEnvelopeLocally(envelope);
		if (!ok) {
			toast.error('Local signature check failed.');
			if (requireSignedMutations) return;
			unsignedWarnOpen = true;
			return;
		}
		const saved = await onSigned(envelope);
		if (saved === false) return;
		open = false;
		resetSynerUi();
		sigilUiTick++;
	}

	async function signWithUnlockedSigil() {
		let seed: Uint8Array | null = null;
		busy = true;
		try {
			const loadedDid = await getLoadedSigilDid();
			if (loadedDid !== did) {
				throw new Error('Loaded Sigil is for a different identity.');
			}
			seed = getUnlockedSigningSeed();
			if (!seed) throw new Error('Unlock your Sigil first.');
			const payload = buildPayload();
			const env = await signProfileMutationWithRootKey(payload, seed, identityPublicKey!);
			await finishWithEnvelope(env);
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
			if (loadedDid !== did) {
				throw new Error('Loaded Sigil is for a different identity.');
			}
			await unlockSigilSession(sigilPassphrase);
			sigilUiTick++;
			seed = getUnlockedSigningSeed();
			if (!seed) throw new Error('Unlock failed.');
			const payload = buildPayload();
			const env = await signProfileMutationWithRootKey(payload, seed, identityPublicKey!);
			await finishWithEnvelope(env);
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
					const env = await signProfileMutationWithRootKey(payload, seed, identityPublicKey!);
					await finishWithEnvelope(env);
				}
			});
			aegisPassword = '';
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Aegis signing failed');
		} finally {
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
			const res = await fetch('/api/user/profile-sign-session', {
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
			resetSynerUi();
			if (e instanceof DOMException && e.name === 'AbortError') {
				return;
			}
			if (open) {
				toast.error(e instanceof Error ? e.message : 'Syner signing failed');
			}
		} finally {
			busy = false;
		}
	}

	async function confirmUnsignedAnyway() {
		busy = true;
		try {
			const ok = await onUnsigned();
			if (ok !== false) {
				open = false;
				unsignedWarnOpen = false;
				resetSynerUi();
				sigilUiTick++;
			}
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Save failed');
		} finally {
			busy = false;
		}
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
			<Dialog.Title>Sign profile update</Dialog.Title>
			<Dialog.Description>
				Sign with your identity key so your profile shows as verified. The signed snapshot must
				match the fields you are saving.
			</Dialog.Description>
		</Dialog.Header>

		<div class="space-y-4 py-2">
			{#if requireSignedMutations}
				<p class="text-sm text-muted-foreground">
					This instance requires a valid signature for profile changes. Unsigned updates are not
					accepted.
				</p>
			{:else}
				<p class="text-sm text-muted-foreground">
					You can save without signing, but verification status will be cleared until you save again
					with a signature.
				</p>
			{/if}

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
						<Label for="prof-sigil-pass">Sigil passphrase</Label>
						<Input
							id="prof-sigil-pass"
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
						No Sigil loaded in this tab. Open <strong class="font-medium text-foreground"
							>Settings → Signing</strong
						>
						to load or receive one, or use Aegis / Syner below.
					</p>
				{/if}

				{#if hasAegis}
					<div class="space-y-2 rounded-md border border-border p-3">
						<Label for="prof-aegis-pass" class="flex items-center gap-2">
							<LockKeyhole class="h-4 w-4" />
							Aegis password
						</Label>
						<Input
							id="prof-aegis-pass"
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

		<Dialog.Footer class="flex-col gap-2 sm:flex-col">
			{#if !requireSignedMutations}
				<Button
					type="button"
					variant="secondary"
					disabled={busy || synerPolling}
					onclick={() => {
						unsignedWarnOpen = true;
					}}
				>
					Save without signing
				</Button>
			{/if}
			<Button type="button" variant="ghost" disabled={busy || synerPolling} onclick={handleDefer}>
				Cancel
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>

<Dialog.Root bind:open={unsignedWarnOpen}>
	<Dialog.Content class="max-w-md">
		<Dialog.Header>
			<Dialog.Title>Save without a valid signature?</Dialog.Title>
			<Dialog.Description>
				If you continue, this profile update will not be cryptographically signed. The verification
				banner on your profile will show as unsigned until you save again with a signature.
			</Dialog.Description>
		</Dialog.Header>
		<Dialog.Footer class="gap-2">
			<Button
				type="button"
				variant="outline"
				disabled={busy}
				onclick={() => (unsignedWarnOpen = false)}
			>
				Back
			</Button>
			<Button type="button" variant="destructive" disabled={busy} onclick={confirmUnsignedAnyway}>
				{#if busy}
					<Loader class="mr-2 h-4 w-4 animate-spin" />
				{/if}
				Save anyway
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
