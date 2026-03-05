<script lang="ts">
	import * as Dialog from '@syr-is/ui/dialog';
	import { Button } from '@syr-is/ui/button';
	import { Input } from '@syr-is/ui/input';
	import { toast } from 'svelte-sonner';
	import { Loader2 } from 'lucide-svelte';
	import { sign, encodeMultibase } from '@syr-is/crypto';
	import { seedHandler } from '$lib/services/seed-handler';
	import type { AegisBundle } from '@syr-is/crypto/aegis';
	import QRCode from 'qrcode';

	let {
		open = $bindable(false),
		onSuccess
	}: {
		open?: boolean;
		onSuccess?: () => void;
	} = $props();

	let step = $state<'warning' | 'unlock' | 'syner'>('warning');
	let unlockPassword = $state('');
	let bundle = $state<AegisBundle | null>(null);
	let deleting = $state(false);
	let isLoadingBundle = $state(false);

	let synerChallenge = $state<{
		challenge_id: string;
		message: string;
		deeplink_url: string;
		qrDataUrl: string;
	} | null>(null);
	let deleteAegisHeartbeatSource: EventSource | null = null;

	$effect(() => {
		if (!open) {
			step = 'warning';
			unlockPassword = '';
			bundle = null;
			synerChallenge = null;
			isLoadingBundle = false;
			disconnectHeartbeat();
		}
	});

	function disconnectHeartbeat() {
		if (deleteAegisHeartbeatSource) {
			deleteAegisHeartbeatSource.close();
			deleteAegisHeartbeatSource = null;
		}
	}

	async function handleVerifyWithPassword() {
		isLoadingBundle = true;
		try {
			const res = await fetch('/api/identity/aegis-bundle');
			if (!res.ok) throw new Error('Failed to fetch identity');
			const data = await res.json();
			bundle = data.data?.aegisBundle ?? null;
			if (!bundle) throw new Error('No Aegis bundle found');
			step = 'unlock';
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Failed to fetch identity');
			step = 'warning';
		} finally {
			isLoadingBundle = false;
		}
	}

	async function handleVerifyWithSyner() {
		deleting = true;
		synerChallenge = null;
		try {
			const res = await fetch('/api/identity/delete-aegis-challenge', { method: 'POST' });
			const data = await res.json();
			if (!res.ok)
				throw new Error(data.message ?? data.error_description ?? 'Failed to create challenge');
			const qrDataUrl = await QRCode.toDataURL(data.deeplink_url, { width: 256, margin: 2 });
			synerChallenge = {
				challenge_id: data.challenge_id,
				message: data.message,
				deeplink_url: data.deeplink_url,
				qrDataUrl
			};
			step = 'syner';

			const src = new EventSource(
				`/api/identity/delete-aegis-heartbeat?challenge_id=${encodeURIComponent(data.challenge_id)}`
			);
			deleteAegisHeartbeatSource = src;
			src.addEventListener('delete_aegis_verified', async (e: MessageEvent) => {
				try {
					const payload = JSON.parse(e.data || '{}');
					const token = payload.delete_aegis_token;
					if (!token) return;
					disconnectHeartbeat();
					await executeDeleteWithToken(token);
					open = false;
					synerChallenge = null;
					onSuccess?.();
				} catch (err) {
					synerChallenge = null;
					toast.error(err instanceof Error ? err.message : 'Delete failed');
				} finally {
					deleting = false;
				}
			});
			src.onerror = () => {
				disconnectHeartbeat();
				synerChallenge = null;
				deleting = false;
				step = 'warning';
				toast.error('Connection lost. Please try again.');
			};
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Failed to create challenge');
			deleting = false;
		}
	}

	async function executeDeleteWithToken(token: string) {
		const res = await fetch('/api/identity/delete-aegis', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			credentials: 'include',
			body: JSON.stringify({ delete_aegis_token: token })
		});
		if (!res.ok) {
			const err = await res.json();
			throw new Error(err.message ?? err.error_description ?? 'Delete failed');
		}
		toast.success('Aegis removed — your keys are no longer stored on the server.');
	}

	async function handleUnlock() {
		if (!unlockPassword || !bundle) return;

		deleting = true;
		try {
			await seedHandler.verify({ bundle, password: unlockPassword });
			// Unlock successful, now get challenge and sign
			const challengeRes = await fetch('/api/identity/delete-aegis-challenge', {
				method: 'POST'
			});
			const challengeData = await challengeRes.json();
			if (!challengeRes.ok)
				throw new Error(
					challengeData.message ?? challengeData.error_description ?? 'Failed to create challenge'
				);

			await seedHandler.run({
				bundle,
				password: unlockPassword,
				action: async (seed) => {
					const signatureBytes = await sign(challengeData.message, seed);
					const signature = encodeMultibase(signatureBytes);
					const deleteRes = await fetch('/api/identity/delete-aegis', {
						method: 'POST',
						headers: { 'Content-Type': 'application/json' },
						credentials: 'include',
						body: JSON.stringify({
							challenge_id: challengeData.challenge_id,
							signature
						})
					});
					if (!deleteRes.ok) {
						const err = await deleteRes.json();
						throw new Error(err.message ?? err.error_description ?? 'Delete failed');
					}
				}
			});

			toast.success('Aegis removed — your keys are no longer stored on the server.');
			open = false;
			onSuccess?.();
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Delete failed');
		} finally {
			deleting = false;
		}
	}

	function goBack() {
		step = 'warning';
		synerChallenge = null;
		disconnectHeartbeat();
		deleting = false;
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="max-w-md">
		<Dialog.Header>
			<Dialog.Title>Delete Aegis</Dialog.Title>
			<Dialog.Description>
				{#if step === 'warning'}
					<p class="text-sm text-muted-foreground">
						Remove the server-stored encrypted key (Aegis) from your identity. Only do this after
						you have
						<strong>exported your Sigil or Persona</strong> and stored it securely.
					</p>
					<p class="mt-2 text-sm text-muted-foreground">
						This is irreversible. After deletion, you will need <strong>Syner</strong> to sign actions
						(registry sync, etc.). Your identity (DID, profile, posts) stays; only the encrypted key
						backup is removed.
					</p>
				{:else if step === 'unlock'}
					<p class="text-sm text-muted-foreground">
						Enter your account password to prove you have your key. This signs a challenge before
						deletion.
					</p>
				{:else}
					<p class="text-sm text-muted-foreground">
						Scan the QR code or open the link with Syner to sign the delete-aegis challenge. You
						must have imported your persona (from exported Sigil/Persona) into Syner.
					</p>
				{/if}
			</Dialog.Description>
		</Dialog.Header>
		<div class="space-y-4 py-4">
			{#if step === 'warning'}
				<div
					class="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm dark:border-amber-800 dark:bg-amber-950/30"
				>
					<p class="font-medium text-amber-800 dark:text-amber-200">
						Export your Sigil or Persona first.
					</p>
					<p class="mt-1 text-amber-700 dark:text-amber-300">
						If you delete without a backup, you will lose access to your identity.
					</p>
				</div>
				<p class="text-sm text-muted-foreground">Choose how to verify you have your key:</p>
			{:else if step === 'unlock'}
				<div class="space-y-2">
					<label for="delete-aegis-password" class="text-sm font-medium">Account password</label>
					<Input
						id="delete-aegis-password"
						type="password"
						bind:value={unlockPassword}
						placeholder="••••••••"
						autocomplete="current-password"
						disabled={deleting}
						onkeydown={(e) => e.key === 'Enter' && handleUnlock()}
					/>
				</div>
			{:else if step === 'syner' && synerChallenge}
				<div class="flex flex-col items-center gap-4">
					<img
						src={synerChallenge.qrDataUrl}
						alt="Scan with Syner"
						class="h-64 w-64 rounded-lg border"
					/>
					<a
						href={synerChallenge.deeplink_url}
						class="text-sm text-primary underline hover:no-underline"
					>
						Open in Syner
					</a>
					<p class="text-xs text-muted-foreground">
						Scan or open link in Syner, then sign the challenge. Delete will complete automatically.
					</p>
				</div>
			{/if}
		</div>
		<Dialog.Footer>
			{#if step === 'warning'}
				<Button variant="outline" onclick={() => (open = false)} disabled={isLoadingBundle}>
					Cancel
				</Button>
				<Button variant="destructive" onclick={handleVerifyWithPassword} disabled={isLoadingBundle}>
					{#if isLoadingBundle}
						<Loader2 class="mr-2 h-4 w-4 animate-spin" />
						Loading...
					{:else}
						Unlock with password
					{/if}
				</Button>
				<Button variant="destructive" onclick={handleVerifyWithSyner}>Sign with Syner</Button>
			{:else}
				<Button variant="outline" onclick={goBack} disabled={deleting}>Back</Button>
				{#if step === 'unlock'}
					<Button
						variant="destructive"
						onclick={handleUnlock}
						disabled={deleting || !unlockPassword || !bundle}
					>
						{#if deleting}
							<Loader2 class="mr-2 h-4 w-4 animate-spin" />
							Deleting...
						{:else}
							Delete Aegis
						{/if}
					</Button>
				{:else if step === 'syner'}
					<Button disabled={deleting}>
						{#if deleting}
							<Loader2 class="mr-2 h-4 w-4 animate-spin" />
							Waiting for Syner...
						{:else}
							Waiting for Syner...
						{/if}
					</Button>
				{/if}
			{/if}
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
