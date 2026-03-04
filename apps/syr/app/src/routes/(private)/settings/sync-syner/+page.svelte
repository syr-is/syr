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

	let qrDataUrl = $state<string | null>(null);
	let pollInterval: ReturnType<typeof setInterval> | null = null;
	let isPolling = false;

	const needsImport = $derived(
		data.user?.profile?.display_name &&
			/^il_[a-zA-Z0-9_-]+_\w{6}$/.test(data.user.profile.display_name)
	);

	const hasDid = $derived(!!data.user?.did);

	async function buildQr() {
		if (!data.user?.did) return;
		const origin = typeof window !== 'undefined' ? window.location.origin : '';
		const deeplink = `syr://sync-profile?instance=${encodeURIComponent(origin)}&did=${encodeURIComponent(data.user.did)}`;
		qrDataUrl = await QRCode.toDataURL(deeplink, { width: 256, margin: 2 });
	}

	// Auto-show QR when profile needs import; user can also click Show QR code
	$effect(() => {
		if (needsImport && hasDid && !qrDataUrl) {
			buildQr();
		}
	});

	// Poll for profile updates when QR is displayed (user may sync from phone; sidebar updates automatically)
	$effect(() => {
		if (!qrDataUrl) return;

		pollInterval = setInterval(async () => {
			if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
			if (isPolling) return;
			isPolling = true;
			try {
				await invalidateAll();
			} catch (err) {
				console.error('Poll invalidate failed:', err);
			} finally {
				isPolling = false;
			}
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
			{#if !hasDid}
				<p class="text-sm text-muted-foreground">
					Add an identity first. Go to Profile and sign in with Syner or import an identity.
				</p>
				<Button variant="outline" href={resolve('/settings/profile')}>Go to Profile</Button>
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
							href={`syr://sync-profile?instance=${encodeURIComponent(typeof window !== 'undefined' ? window.location.origin : '')}&did=${encodeURIComponent(data.user?.did ?? '')}`}
							class="font-medium text-primary underline"
						>
							open in Syner
						</a>
					</p>
				</div>
			{:else}
				<Button onclick={buildQr}>Show QR code</Button>
			{/if}

			{#if qrDataUrl}
				<p class="text-sm text-muted-foreground">
					Once Syner has synced your profile, this page will update automatically.
				</p>
			{/if}
			<Button variant="outline" onclick={backToProfile} class="w-full">Back to Profile</Button>
		</CardContent>
	</Card>
</div>
