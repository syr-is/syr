<script lang="ts">
	import { enhance } from '$app/forms';
	import { onMount } from 'svelte';
	import QRCode from 'qrcode';

	let { data } = $props();

	// ── Syner QR signing state ──
	let synerChallenge = $state<{
		challenge_id: string;
		deeplink_url: string;
		qrDataUrl: string;
		expires_in: number;
		expiresAt: number;
	} | null>(null);
	let synerLoading = $state(false);
	let synerError = $state<string | null>(null);
	let heartbeatSource: EventSource | null = null;

	async function fetchDelegationChallenge(silent = false) {
		if (!silent) {
			synerLoading = true;
			synerError = null;
			synerChallenge = null;
		}
		try {
			const res = await fetch('/api/platform/delegation-challenge', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					delegation_statement: {
						did: data.did,
						delegate: 'pending',
						scope: 'platform',
						createdAt: new Date().toISOString()
					},
					delegation_id: data.challengeId
				})
			});
			const result = await res.json();
			if (!res.ok) {
				if (!silent) synerError = result.error_description ?? 'Failed to create challenge';
				return;
			}
			const qrDataUrl = await QRCode.toDataURL(result.deeplink_url, { width: 256, margin: 2 });
			synerChallenge = {
				challenge_id: result.challenge_id,
				deeplink_url: result.deeplink_url,
				qrDataUrl,
				expires_in: result.expires_in,
				expiresAt: Date.now() + result.expires_in * 1000
			};
		} catch (e) {
			if (!silent) synerError = e instanceof Error ? e.message : 'An unexpected error occurred';
		} finally {
			if (!silent) synerLoading = false;
		}
	}

	function disconnectHeartbeat() {
		if (heartbeatSource) {
			heartbeatSource.close();
			heartbeatSource = null;
		}
	}

	function connectHeartbeat() {
		if (heartbeatSource || !synerChallenge) return;
		const src = new EventSource(
			`/api/platform/delegation-heartbeat?challenge_id=${encodeURIComponent(synerChallenge.challenge_id)}`
		);
		heartbeatSource = src;

		src.addEventListener('heartbeat', () => {
			if (!synerChallenge) return;
			if (Date.now() < synerChallenge.expiresAt - 30_000) return;
			fetchDelegationChallenge(true);
		});

		src.addEventListener('signed', (e: MessageEvent) => {
			try {
				const d = JSON.parse(e.data || '{}');
				if (d.redirect_url) {
					disconnectHeartbeat();
					window.location.href = d.redirect_url;
				}
			} catch {
				/* ignore */
			}
		});

		src.onerror = () => disconnectHeartbeat();
	}

	onMount(() => {
		if (!data.hasAegis) {
			fetchDelegationChallenge(false);
		}
		return () => disconnectHeartbeat();
	});

	$effect(() => {
		if (!data.hasAegis && synerChallenge) {
			disconnectHeartbeat();
			connectHeartbeat();
		} else {
			disconnectHeartbeat();
		}
	});
</script>

<div class="flex min-h-screen items-center justify-center bg-background p-4">
	<div class="w-full max-w-md space-y-6 rounded-lg border border-border bg-card p-8">
		<div class="space-y-2 text-center">
			<h1 class="text-2xl font-bold text-card-foreground">Platform Authorization</h1>
			<p class="text-sm text-muted-foreground">
				<span class="font-medium text-card-foreground">{data.platformName}</span> wants to connect to
				your identity
			</p>
		</div>

		<!-- Platform info -->
		<div class="rounded-md border border-border bg-muted/50 p-4">
			<div class="space-y-2 text-sm">
				<div class="flex justify-between">
					<span class="text-muted-foreground">Platform</span>
					<span class="font-medium text-card-foreground">{data.platformName}</span>
				</div>
				<div class="flex justify-between">
					<span class="text-muted-foreground">Origin</span>
					<span class="font-mono text-xs text-card-foreground">{data.platformOrigin}</span>
				</div>
			</div>
		</div>

		<!-- User identity -->
		{#if data.did}
			<div class="flex items-center gap-3 rounded-md border border-border p-3">
				{#if data.avatarUrl}
					<img src={data.avatarUrl} alt="" class="h-10 w-10 rounded-full" />
				{:else}
					<div
						class="flex h-10 w-10 items-center justify-center rounded-full bg-primary text-sm font-medium text-primary-foreground"
					>
						{data.displayName.charAt(0).toUpperCase()}
					</div>
				{/if}
				<div>
					<p class="text-sm font-medium text-card-foreground">{data.displayName}</p>
					<p class="font-mono text-xs text-muted-foreground">{data.did.slice(0, 24)}...</p>
				</div>
			</div>
		{/if}

		<p class="text-sm text-muted-foreground">
			This will let the platform request cryptographic signatures on your behalf. You can revoke
			access anytime from your settings.
		</p>

		{#if data.hasAegis}
			<!-- ── AEGIS: password form ── -->
			<form method="POST" action="?/approve" use:enhance class="space-y-4">
				<input type="hidden" name="challenge_id" value={data.challengeId} />
				<div class="space-y-2">
					<label for="password" class="text-sm font-medium text-card-foreground">Password</label>
					<input
						id="password"
						name="password"
						type="password"
						required
						autocomplete="current-password"
						class="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:ring-2 focus:ring-ring focus:outline-none"
					/>
				</div>
				<button
					type="submit"
					class="w-full rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
				>
					Approve
				</button>
			</form>
		{:else}
			<!-- ── EXTERNAL / NO IDENTITY: Syner QR ── -->
			{#if synerLoading}
				<p class="text-center text-sm text-muted-foreground">Creating challenge...</p>
			{:else if synerError}
				<div class="space-y-3 text-center">
					<p class="text-sm text-destructive">{synerError}</p>
					<button
						onclick={() => fetchDelegationChallenge(false)}
						class="rounded-md border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-accent"
					>
						Retry
					</button>
				</div>
			{:else if synerChallenge}
				<div class="flex flex-col items-center gap-4">
					<p class="text-center text-sm text-muted-foreground">
						Scan the QR code or click the link to authorize with Syner
					</p>
					<img
						src={synerChallenge.qrDataUrl}
						alt="Scan with Syner to authorize"
						class="rounded-lg border"
						width="256"
						height="256"
					/>
					<a
						href={synerChallenge.deeplink_url}
						class="text-sm font-medium text-primary hover:underline"
					>
						Open in Syner
					</a>
					<p class="text-xs text-muted-foreground">
						Challenge expires in {synerChallenge.expires_in}s
					</p>
				</div>
			{:else}
				<div class="text-center">
					<button
						onclick={() => fetchDelegationChallenge(false)}
						class="rounded-md bg-primary px-6 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
					>
						Sign with Syner
					</button>
				</div>
			{/if}
		{/if}

		<!-- Deny -->
		<form method="POST" action="?/deny" use:enhance>
			<input type="hidden" name="challenge_id" value={data.challengeId} />
			<button
				type="submit"
				class="w-full rounded-md border border-border px-4 py-2 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-accent-foreground"
			>
				Deny
			</button>
		</form>
	</div>
</div>
