<script lang="ts">
	import { goto } from '$app/navigation';
	import { invalidateAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@syr-is/ui/card';
	import { Button } from '@syr-is/ui/button';
	import QRCode from 'qrcode';
	import { Smartphone, CheckCircle } from 'lucide-svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	let syncToken = $state<string | null>(null);
	let syncTokenLoading = $state(false);
	let syncTokenAttempted = $state(false);
	let qrDataUrl = $state<string | null>(null);
	let pollInterval: ReturnType<typeof setInterval> | null = null;

	const needsImport = $derived(
		data.user?.profile?.display_name &&
			/^il_[a-zA-Z0-9_-]+_\w{6}$/.test(data.user.profile.display_name)
	);

	async function fetchSyncToken() {
		syncTokenAttempted = true;
		syncTokenLoading = true;
		try {
			const res = await fetch(resolve('/api/auth/independent-login/sync-token'), {
				credentials: 'include'
			});
			const json = await res.json();
			if (res.ok && json.sync_token) {
				syncToken = json.sync_token;
				const origin = typeof window !== 'undefined' ? window.location.origin : '';
				const deeplink = `syr://sync-profile?instance=${encodeURIComponent(origin)}&sync_token=${encodeURIComponent(json.sync_token)}`;
				qrDataUrl = await QRCode.toDataURL(deeplink, { width: 256, margin: 2 });
			}
		} finally {
			syncTokenLoading = false;
		}
	}

	// Auto-fetch QR when profile needs import; allow manual fetch anytime via Show QR code button
	$effect(() => {
		if (needsImport && syncToken === null && !syncTokenLoading && !syncTokenAttempted) {
			fetchSyncToken();
		}
	});

	// Poll for profile updates when import is pending
	$effect(() => {
		if (!needsImport) return;

		pollInterval = setInterval(async () => {
			await invalidateAll();
		}, 2000);

		return () => {
			if (pollInterval) {
				clearInterval(pollInterval);
				pollInterval = null;
			}
		};
	});

	function backToProfile() {
		goto(resolve('/settings/profile'));
	}
</script>

<svelte:head>
	<title>Sync with Syner | Settings | SYR</title>
</svelte:head>

<div class="mx-auto max-w-md space-y-6">
	<Card>
		<CardHeader>
			<CardTitle class="flex items-center gap-2">
				{#if needsImport}
					<Smartphone class="h-5 w-5" />
					Import your profile from Syner
				{:else}
					<CheckCircle class="h-5 w-5 text-green-600" />
					Sync with Syner
				{/if}
			</CardTitle>
			<CardDescription>
				{#if needsImport}
					Scan the QR code with Syner to import your display name, bio, avatar, and banner.
				{:else}
					Sync or re-import your profile from Syner anytime. Scan the QR code to overwrite with
					persona data.
				{/if}
			</CardDescription>
		</CardHeader>
		<CardContent class="space-y-4">
			{#if syncTokenLoading}
				<p class="text-sm text-muted-foreground">Loading…</p>
			{:else if qrDataUrl}
				<div class="flex flex-col items-center gap-4">
					<img
						src={qrDataUrl}
						alt="Scan with Syner"
						class="rounded-lg border"
						width="256"
						height="256"
					/>
					<p class="text-center text-sm text-muted-foreground">
						Open Syner and scan this code, or
						<a
							href={`syr://sync-profile?instance=${encodeURIComponent(typeof window !== 'undefined' ? window.location.origin : '')}&sync_token=${encodeURIComponent(syncToken ?? '')}`}
							class="font-medium text-primary underline"
						>
							open in Syner
						</a>
					</p>
				</div>
			{:else}
				<Button onclick={fetchSyncToken} disabled={syncTokenLoading}>Show QR code</Button>
			{/if}

			{#if needsImport}
				<p class="text-sm text-muted-foreground">
					Once Syner has synced your profile, this page will update automatically.
				</p>
			{/if}
			<Button variant="outline" onclick={backToProfile} class="w-full">Back to Profile</Button>
		</CardContent>
	</Card>
</div>
