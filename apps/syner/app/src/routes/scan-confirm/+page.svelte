<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@syr-is/ui/card';
	import { Button } from '@syr-is/ui/button';
	import { ArrowLeft, ArrowRight, Shield } from '@lucide/svelte';

	let challengeId = $derived(page.url.searchParams.get('challenge'));
	let instanceUrl = $derived(page.url.searchParams.get('instance'));
	let callbackBase = $derived(page.url.searchParams.get('callback'));

	function proceed() {
		if (!challengeId || !instanceUrl || !callbackBase) return;
		const q = new URLSearchParams({
			challenge: challengeId,
			instance: instanceUrl,
			callback: callbackBase
		});
		goto(`/independent-login?${q.toString()}`);
	}

	function goBack() {
		goto('/');
	}
</script>

<div class="flex flex-col gap-6 p-4 md:p-6">
	<div class="flex items-center gap-2">
		<Button variant="ghost" size="icon" href="/" aria-label="Back">
			<ArrowLeft class="h-5 w-5" />
		</Button>
		<h1 class="text-2xl font-bold">Confirm sign-in</h1>
	</div>

	{#if !challengeId || !instanceUrl || !callbackBase}
		<Card>
			<CardContent class="pt-6">
				<p class="text-muted-foreground text-sm">
					Invalid or missing parameters. Scan the QR code again.
				</p>
				<Button variant="outline" class="mt-4" href="/">Back to Personas</Button>
			</CardContent>
		</Card>
	{:else}
		<Card>
			<CardHeader>
				<CardTitle class="flex items-center gap-2">
					<Shield class="h-5 w-5" />
					Sign in request
				</CardTitle>
				<CardDescription>
					Review the details below before proceeding. You will choose a persona and sign to prove
					your identity.
				</CardDescription>
			</CardHeader>
			<CardContent class="space-y-4">
				<div class="space-y-1">
					<p class="text-muted-foreground text-sm font-medium">Requesting service</p>
					<p class="font-mono text-sm break-all">{instanceUrl}</p>
				</div>
				<div class="space-y-1">
					<p class="text-muted-foreground text-sm font-medium">Challenge ID</p>
					<p class="truncate font-mono text-sm">{challengeId}</p>
				</div>

				<div class="flex flex-col gap-2 pt-4 sm:flex-row">
					<Button class="flex-1" onclick={proceed}>
						Proceed to sign in
						<ArrowRight class="ml-2 h-4 w-4" />
					</Button>
					<Button variant="outline" class="flex-1" onclick={goBack}>
						<ArrowLeft class="mr-2 h-4 w-4" />
						Cancel
					</Button>
				</div>
			</CardContent>
		</Card>
	{/if}
</div>
