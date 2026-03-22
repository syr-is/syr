<script lang="ts">
	import * as Card from '@syr-is/ui/card';
	import { Label } from '@syr-is/ui/label';
	import { Input } from '@syr-is/ui/input';
	import { Button } from '@syr-is/ui/button';
	import { onMount, onDestroy } from 'svelte';
	import { toast } from 'svelte-sonner';
	import QRCode from 'qrcode';
	import {
		getSigilSessionStatus,
		getSigilSessionMeta,
		getLoadedSigilDid,
		loadSigilFromFile,
		loadSigilFromEncryptedJsonText,
		unlockSigilSession,
		clearSigilSession,
		type SigilSessionStatus
	} from '$lib/client/sigil-session';

	let { data } = $props();

	let warn = $state(true);
	let explicit = $state(true);
	let feedHideUnsigned = $state(false);
	let loading = $state(true);
	let saving = $state(false);

	let sigilStatus = $state<SigilSessionStatus>('empty');
	let sigilMeta = $state<ReturnType<typeof getSigilSessionMeta>>(null);
	let sigilDid = $state<string | null>(null);
	let sigilPassphrase = $state('');
	let sigilBusy = $state(false);
	let fileInput: HTMLInputElement | null = $state(null);

	let handoffDeeplink = $state<string | null>(null);
	let handoffQrDataUrl = $state<string | null>(null);
	let handoffPollTimer: ReturnType<typeof setInterval> | null = null;
	let handoffExpiredToast = $state(false);

	function stopHandoffPolling() {
		if (handoffPollTimer) {
			clearInterval(handoffPollTimer);
			handoffPollTimer = null;
		}
	}

	onDestroy(() => {
		stopHandoffPolling();
	});

	async function refreshSigilUi() {
		sigilStatus = getSigilSessionStatus();
		sigilMeta = getSigilSessionMeta();
		sigilDid = await getLoadedSigilDid();
	}

	onMount(async () => {
		try {
			const res = await fetch('/api/user/signing-preferences');
			const j = await res.json();
			if (res.ok && j.data) {
				warn = j.data.signing_warn_before_each_action ?? warn;
				explicit = j.data.signing_require_explicit_sign_button ?? explicit;
				feedHideUnsigned = j.data.feed_hide_unsigned_posts ?? false;
			}
		} catch {
			toast.error('Could not load signing preferences');
		} finally {
			loading = false;
		}
		await refreshSigilUi();
	});

	async function save(patch: Record<string, boolean>) {
		saving = true;
		try {
			const res = await fetch('/api/user/signing-preferences', {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(patch)
			});
			const j = await res.json();
			if (!res.ok) {
				toast.error(j.error?.message ?? 'Save failed');
				return;
			}
			toast.success('Saved');
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Save failed');
		} finally {
			saving = false;
		}
	}

	async function onSigilFile(e: Event) {
		const f = (e.target as HTMLInputElement).files?.[0];
		(e.target as HTMLInputElement).value = '';
		if (!f) return;
		sigilBusy = true;
		try {
			await loadSigilFromFile(f);
			sigilPassphrase = '';
			toast.success('Sigil loaded into this browser session');
			await refreshSigilUi();
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Failed to load Sigil');
		} finally {
			sigilBusy = false;
		}
	}

	async function onUnlockSigil() {
		if (!sigilPassphrase.trim()) {
			toast.error('Enter the Sigil passphrase');
			return;
		}
		sigilBusy = true;
		try {
			await unlockSigilSession(sigilPassphrase);
			sigilPassphrase = '';
			toast.success('Sigil unlocked for signing (this tab only)');
			await refreshSigilUi();
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Unlock failed');
		} finally {
			sigilBusy = false;
		}
	}

	async function onClearSigil() {
		stopHandoffPolling();
		handoffDeeplink = null;
		handoffQrDataUrl = null;
		handoffExpiredToast = false;
		clearSigilSession();
		sigilPassphrase = '';
		toast.success('Sigil removed from session');
		await refreshSigilUi();
	}

	function cancelSynerHandoff() {
		stopHandoffPolling();
		handoffDeeplink = null;
		handoffQrDataUrl = null;
		handoffExpiredToast = false;
	}

	async function startSynerHandoff() {
		sigilBusy = true;
		handoffExpiredToast = false;
		cancelSynerHandoff();
		try {
			const res = await fetch('/api/user/sigil-handoff-session', { method: 'POST' });
			const j = (await res.json()) as {
				data?: { session_id?: string; deeplink_url?: string };
				message?: string;
				error?: { message?: string };
			};
			if (!res.ok) {
				throw new Error(j?.error?.message ?? j?.message ?? 'Could not start Syner handoff');
			}
			const link = j.data?.deeplink_url;
			const sid = j.data?.session_id;
			if (!link || !sid) {
				throw new Error('Invalid handoff response');
			}
			handoffDeeplink = link;
			handoffQrDataUrl = await QRCode.toDataURL(link, { width: 256, margin: 2 });
			handoffPollTimer = setInterval(() => {
				void pollSynerHandoff(sid);
			}, 1500);
			toast.message('Scan the QR with Syner or open the link, then send the Sigil from Syner.');
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Handoff failed');
		} finally {
			sigilBusy = false;
		}
	}

	async function pollSynerHandoff(sessionId: string) {
		if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
		try {
			const res = await fetch(`/api/user/sigil-handoff/${encodeURIComponent(sessionId)}`);
			const j = (await res.json()) as {
				data?: { status?: string; sigil_json?: string };
			};
			const d = j.data;
			if (d?.status === 'ready' && typeof d.sigil_json === 'string') {
				const accountDid = data.identityContext?.did?.trim() ?? data.user?.did?.trim() ?? '';
				if (!accountDid.startsWith('did:syr:')) {
					toast.error('Your account has no DID; cannot verify Syner handoff.');
					cancelSynerHandoff();
					return;
				}
				stopHandoffPolling();
				handoffDeeplink = null;
				handoffQrDataUrl = null;
				handoffExpiredToast = false;
				try {
					await loadSigilFromEncryptedJsonText(
						d.sigil_json,
						{
							filename: 'from-syner.sigil',
							loadedAt: new Date().toISOString()
						},
						{ expectedDid: accountDid }
					);
				} catch (e) {
					toast.error(e instanceof Error ? e.message : 'Sigil did not match your account');
					await refreshSigilUi();
					return;
				}
				sigilPassphrase = '';
				toast.success('Sigil received from Syner');
				await refreshSigilUi();
				return;
			}
			if (d?.status === 'gone' && handoffDeeplink && !handoffExpiredToast) {
				handoffExpiredToast = true;
				toast.error('Handoff session expired or was already used. Start again if needed.');
				cancelSynerHandoff();
			}
		} catch {
			/* ignore transient poll errors */
		}
	}
</script>

<div class="mx-auto max-w-2xl space-y-6 p-4">
	<Card.Root>
		<Card.Header>
			<Card.Title>Signing behavior</Card.Title>
			<Card.Description>
				Controls how the app asks you before cryptographic signing (profile, posts, follows when
				signed).
			</Card.Description>
		</Card.Header>
		<Card.Content class="space-y-6">
			{#if loading}
				<p class="text-sm text-muted-foreground">Loading…</p>
			{:else}
				<div class="flex items-start justify-between gap-4">
					<div class="space-y-1">
						<Label for="warn">Warn before each sign</Label>
						<p class="text-xs text-muted-foreground">
							Show a confirmation step summarizing what will be signed.
						</p>
					</div>
					<input
						id="warn"
						type="checkbox"
						class="mt-1 size-4"
						checked={warn}
						disabled={saving}
						onchange={(e) => {
							const v = e.currentTarget.checked;
							warn = v;
							void save({ signing_warn_before_each_action: v });
						}}
					/>
				</div>
				<div class="flex items-start justify-between gap-4">
					<div class="space-y-1">
						<Label for="explicit">Require explicit Sign control</Label>
						<p class="text-xs text-muted-foreground">
							Prefer a dedicated “Sign” / “Sign and submit” action where the UI supports it.
						</p>
					</div>
					<input
						id="explicit"
						type="checkbox"
						class="mt-1 size-4"
						checked={explicit}
						disabled={saving}
						onchange={(e) => {
							const v = e.currentTarget.checked;
							explicit = v;
							void save({ signing_require_explicit_sign_button: v });
						}}
					/>
				</div>
				<div class="flex items-start justify-between gap-4">
					<div class="space-y-1">
						<Label for="hide-unsigned">Hide unsigned posts in My posts</Label>
						<p class="text-xs text-muted-foreground">
							When enabled, posts without a stored signature are omitted from your posts list (you
							can still open them by URL).
						</p>
					</div>
					<input
						id="hide-unsigned"
						type="checkbox"
						class="mt-1 size-4"
						checked={feedHideUnsigned}
						disabled={saving}
						onchange={(e) => {
							const v = e.currentTarget.checked;
							feedHideUnsigned = v;
							void save({ feed_hide_unsigned_posts: v });
						}}
					/>
				</div>
			{/if}
		</Card.Content>
	</Card.Root>

	<Card.Root>
		<Card.Header>
			<Card.Title>Sigil signing session</Card.Title>
			<Card.Description>
				Load an encrypted Sigil into this browser tab for signing (file picker or Syner QR / deep
				link). The ciphertext stays in session storage; the decrypted key exists only in memory
				until you clear it or sign out. Prefer a trusted personal device.
			</Card.Description>
		</Card.Header>
		<Card.Content class="space-y-4">
			<div class="rounded-md border bg-muted/30 px-3 py-2 text-sm">
				<p class="font-medium">Status</p>
				<p class="text-muted-foreground">
					{#if sigilStatus === 'empty'}
						No Sigil loaded.
					{:else if sigilStatus === 'loaded_locked'}
						Loaded (locked){#if sigilMeta?.filename}
							— {sigilMeta.filename}{/if}
					{:else}
						Unlocked — ready to sign in this tab
					{/if}
				</p>
				{#if sigilDid}
					<p class="mt-1 font-mono text-xs text-muted-foreground">{sigilDid}</p>
				{/if}
			</div>

			<input
				bind:this={fileInput}
				type="file"
				accept=".sigil,.json,application/json"
				class="sr-only"
				onchange={(e) => void onSigilFile(e)}
			/>

			<div class="flex flex-wrap gap-2">
				<Button
					type="button"
					variant="secondary"
					disabled={sigilBusy}
					onclick={() => fileInput?.click()}
				>
					Load Sigil file…
				</Button>
				<Button
					type="button"
					variant="secondary"
					disabled={sigilBusy}
					onclick={() => void startSynerHandoff()}
				>
					Receive from Syner (QR)
				</Button>
				{#if sigilStatus !== 'empty'}
					<Button
						type="button"
						variant="outline"
						disabled={sigilBusy}
						onclick={() => void onClearSigil()}
					>
						Clear from session
					</Button>
				{/if}
			</div>

			{#if handoffQrDataUrl && handoffDeeplink}
				<div class="space-y-3 rounded-md border bg-muted/20 p-4">
					<p class="text-sm font-medium">Syner handoff</p>
					<p class="text-xs text-muted-foreground">
						Scan with Syner or tap “Open in Syner”. Choose a persona and send the encrypted Sigil;
						this tab will pick it up automatically.
					</p>
					<div class="flex flex-col items-center gap-3 sm:flex-row sm:items-start">
						<img
							src={handoffQrDataUrl}
							alt="Syner Sigil handoff QR"
							class="rounded-lg border"
							width="256"
							height="256"
						/>
						<div class="flex flex-col gap-2 text-sm">
							<a
								href={handoffDeeplink}
								class="font-medium text-primary underline"
								rel="noopener noreferrer"
							>
								Open in Syner
							</a>
							<Button
								type="button"
								variant="ghost"
								size="sm"
								class="self-start"
								onclick={cancelSynerHandoff}
							>
								Cancel handoff
							</Button>
						</div>
					</div>
				</div>
			{/if}

			{#if sigilStatus === 'loaded_locked'}
				<div class="space-y-2">
					<Label for="sigil-pass">Sigil passphrase</Label>
					<div class="flex flex-wrap gap-2">
						<Input
							id="sigil-pass"
							type="password"
							autocomplete="off"
							class="max-w-sm"
							bind:value={sigilPassphrase}
							disabled={sigilBusy}
							onkeydown={(e) => e.key === 'Enter' && void onUnlockSigil()}
						/>
						<Button type="button" disabled={sigilBusy} onclick={() => void onUnlockSigil()}>
							Unlock
						</Button>
					</div>
				</div>
			{/if}

			{#if sigilStatus === 'unlocked'}
				<p class="text-xs text-muted-foreground">
					Signing flows that support browser Sigil will use this session’s key until you clear it or
					sign out.
				</p>
			{/if}
		</Card.Content>
	</Card.Root>
</div>
