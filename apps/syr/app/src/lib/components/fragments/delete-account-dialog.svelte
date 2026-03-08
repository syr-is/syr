<script lang="ts">
	import * as Dialog from '@syr-is/ui/dialog';
	import { Button } from '@syr-is/ui/button';
	import { Input } from '@syr-is/ui/input';
	import { toast } from 'svelte-sonner';
	import { Loader2 } from 'lucide-svelte';
	import QRCode from 'qrcode';
	import { useSigningOptions } from '$lib/composables/use-signing-options.svelte';

	let {
		open = $bindable(false),
		onSuccess
	}: {
		open?: boolean;
		onSuccess?: () => void;
	} = $props();

	const signingOpts = useSigningOptions();
	const canVerifyWithPassword = $derived(signingOpts.hasAegis);
	const canVerifyWithSyner = $derived(signingOpts.hasIdentity);

	let step = $state<'warning' | 'password' | 'syner'>('warning');
	let admins = $state<Array<{ username: string; did: string | null }>>([]);
	let deleting = $state(false);
	let password = $state('');

	let synerChallenge = $state<{
		challenge_id: string;
		message: string;
		deeplink_url: string;
		qrDataUrl: string;
	} | null>(null);
	let deleteAccountHeartbeatSource: EventSource | null = null;

	$effect(() => {
		if (open) {
			// Fetch admins when dialog opens (for lost-identity case)
			fetch('/api/instance-admins', { credentials: 'include' })
				.then((r) => r.json())
				.then((d) => {
					admins = d?.admins ?? [];
				})
				.catch(() => {
					admins = [];
				});
		} else {
			step = 'warning';
			password = '';
			synerChallenge = null;
			disconnectHeartbeat();
			admins = [];
		}
	});

	function disconnectHeartbeat() {
		if (deleteAccountHeartbeatSource) {
			deleteAccountHeartbeatSource.close();
			deleteAccountHeartbeatSource = null;
		}
	}

	async function handleVerifyWithPassword() {
		if (!password.trim()) {
			toast.error('Enter your password');
			return;
		}
		deleting = true;
		try {
			const res = await fetch('/api/account/delete-challenge', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				credentials: 'include',
				body: JSON.stringify({ password: password.trim() })
			});
			const data = await res.json();
			if (!res.ok) throw new Error(data.message ?? data.error_description ?? 'Failed to verify');
			if (data.delete_account_token) {
				await executeDeleteWithToken(data.delete_account_token);
				open = false;
				onSuccess?.();
			} else {
				throw new Error('Unexpected response');
			}
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Verification failed');
		} finally {
			deleting = false;
		}
	}

	async function handleVerifyWithSyner() {
		deleting = true;
		synerChallenge = null;
		try {
			const res = await fetch('/api/account/delete-challenge', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				credentials: 'include',
				body: JSON.stringify({})
			});
			const data = await res.json();
			if (!res.ok)
				throw new Error(data.message ?? data.error_description ?? 'Failed to create challenge');
			if (data.delete_account_token) {
				await executeDeleteWithToken(data.delete_account_token);
				open = false;
				onSuccess?.();
				deleting = false;
				return;
			}
			if (!data.challenge_id || !data.deeplink_url) throw new Error('Unexpected response');
			const qrDataUrl = await QRCode.toDataURL(data.deeplink_url, { width: 256, margin: 2 });
			synerChallenge = {
				challenge_id: data.challenge_id,
				message: data.message,
				deeplink_url: data.deeplink_url,
				qrDataUrl
			};
			step = 'syner';

			const src = new EventSource(
				`/api/account/delete-heartbeat?challenge_id=${encodeURIComponent(data.challenge_id)}`
			);
			deleteAccountHeartbeatSource = src;
			src.addEventListener('delete_account_verified', async (e: MessageEvent) => {
				try {
					const payload = JSON.parse(e.data || '{}');
					const token = payload.delete_account_token;
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
		const res = await fetch('/api/account/delete', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			credentials: 'include',
			body: JSON.stringify({ delete_account_token: token })
		});
		if (!res.ok) {
			const err = await res.json();
			throw new Error(err.message ?? err.error_description ?? 'Delete failed');
		}
		toast.success('Account deleted. Redirecting...');
		onSuccess?.();
		window.location.href = '/';
	}

	function goBack() {
		step = 'warning';
		synerChallenge = null;
		password = '';
		disconnectHeartbeat();
		deleting = false;
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="max-w-md">
		<Dialog.Header>
			<Dialog.Title>Delete Account</Dialog.Title>
			<Dialog.Description>
				{#if step === 'warning'}
					<p class="text-sm text-muted-foreground">
						This will <strong>permanently delete</strong> your account and all data: profile, posts,
						uploads, sessions, identity, and everything you've put on the platform.
					</p>
					<p class="mt-2 text-sm text-muted-foreground">
						{#if canVerifyWithPassword && canVerifyWithSyner}
							This cannot be undone. You must verify ownership with either your password or by
							signing with Syner.
						{:else if canVerifyWithPassword}
							This cannot be undone. You must verify ownership with your password (Aegis).
						{:else if canVerifyWithSyner}
							This cannot be undone. You must verify ownership by signing with Syner (your keys are
							not stored on the server).
						{:else}
							Deletion requires signing with your identity keys. Lost your keys? Contact instance
							administrators for assistance.
						{/if}
					</p>
				{:else if step === 'password'}
					<p class="text-sm text-muted-foreground">
						Enter your account password to verify ownership.
					</p>
				{:else}
					<p class="text-sm text-muted-foreground">
						Scan the QR code or open the link with Syner to sign the delete-account challenge.
					</p>
				{/if}
			</Dialog.Description>
		</Dialog.Header>
		<div class="space-y-4 py-4">
			{#if step === 'warning'}
				<div
					class="rounded-md border border-red-200 bg-red-50 p-3 text-sm dark:border-red-800 dark:bg-red-950/30"
				>
					<p class="font-medium text-red-800 dark:text-red-200">This action is permanent.</p>
					<p class="mt-1 text-red-700 dark:text-red-300">
						All posts, uploads, profile, and identity data will be deleted.
					</p>
				</div>
				{#if canVerifyWithPassword || canVerifyWithSyner}
					<div class="flex flex-col gap-2">
						{#if canVerifyWithPassword}
							<Button
								variant="outline"
								onclick={() => {
									step = 'password';
								}}
								disabled={deleting}
							>
								Verify with password
							</Button>
						{/if}
						{#if canVerifyWithSyner}
							<Button variant="outline" onclick={handleVerifyWithSyner} disabled={deleting}>
								{#if deleting}
									<Loader2 class="mr-2 h-4 w-4 animate-spin" />
									Loading...
								{:else}
									Sign with Syner
								{/if}
							</Button>
						{/if}
					</div>
				{:else}
					<div
						class="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm dark:border-amber-800 dark:bg-amber-950/30"
					>
						<p class="font-medium text-amber-800 dark:text-amber-200">
							Lost identity? Contact instance administrators
						</p>
						{#if admins.length > 0}
							<ul class="mt-2 space-y-1 text-amber-700 dark:text-amber-300">
								{#each admins as admin (admin.username)}
									<li>
										{admin.username}
										{#if admin.did}
											— <span class="font-mono text-xs">{admin.did}</span>
										{/if}
									</li>
								{/each}
							</ul>
						{:else}
							<p class="mt-1 text-amber-700 dark:text-amber-300">
								No administrators listed. Please contact your instance operator.
							</p>
						{/if}
					</div>
				{/if}
			{:else if step === 'password'}
				<div class="space-y-2">
					<Input
						type="password"
						placeholder="Password"
						bind:value={password}
						onkeydown={(e) => e.key === 'Enter' && handleVerifyWithPassword()}
					/>
					<Button
						variant="destructive"
						onclick={handleVerifyWithPassword}
						disabled={deleting || !password.trim()}
						class="w-full"
					>
						{#if deleting}
							<Loader2 class="mr-2 h-4 w-4 animate-spin" />
							Verifying...
						{:else}
							Delete account
						{/if}
					</Button>
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
				<Button variant="outline" onclick={() => (open = false)} disabled={deleting}>Cancel</Button>
			{:else}
				<Button variant="outline" onclick={goBack} disabled={deleting}>Back</Button>
				{#if step === 'syner'}
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
