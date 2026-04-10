<script lang="ts">
	import * as Dialog from '@syr-is/ui/dialog';
	import { Button } from '@syr-is/ui/button';
	import { Input } from '@syr-is/ui/input';
	import { Label } from '@syr-is/ui/label';
	import { SvelteURLSearchParams } from 'svelte/reactivity';

	let {
		open = $bindable(false),
		did,
		providerOrigin
	}: {
		open?: boolean;
		/** DID of the user to follow */
		did: string;
		/** Origin of the provider hosting this profile (used as ?provider= param) */
		providerOrigin?: string | null;
	} = $props();

	let instanceUrl = $state('');
	let errorMsg = $state('');

	$effect(() => {
		if (open) {
			instanceUrl = '';
			errorMsg = '';
		}
	});

	function handleGo() {
		errorMsg = '';
		if (!instanceUrl.trim()) {
			errorMsg = 'Please enter your Syr instance URL';
			return;
		}

		let url: URL;
		try {
			const raw = instanceUrl.trim();
			const hasScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(raw);
			url = new URL(hasScheme ? raw : `https://${raw}`);
		} catch {
			errorMsg = 'Invalid URL';
			return;
		}

		if (url.protocol !== 'http:' && url.protocol !== 'https:') {
			errorMsg = 'Only http and https URLs are supported';
			return;
		}

		const params = new SvelteURLSearchParams();
		if (providerOrigin) {
			params.set('provider', providerOrigin);
		}
		const qs = params.toString();
		const profilePath = `/u/${encodeURIComponent(did)}${qs ? `?${qs}` : ''}`;
		const newWin = window.open(`${url.origin}${profilePath}`, '_blank');
		if (newWin) {
			newWin.opener = null;
			open = false;
		} else {
			errorMsg = 'Popup was blocked by your browser. Allow popups and try again.';
		}
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter') handleGo();
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="max-w-sm">
		<Dialog.Header>
			<Dialog.Title>Follow on your instance</Dialog.Title>
			<Dialog.Description>
				Enter your Syr instance URL to view this profile from your own instance, where you can
				follow and interact.
			</Dialog.Description>
		</Dialog.Header>
		<div class="space-y-3 py-2">
			<div class="space-y-1.5">
				<Label for="remote-follow-instance">Your Syr instance</Label>
				<Input
					id="remote-follow-instance"
					type="text"
					placeholder="syr.example.com"
					bind:value={instanceUrl}
					onkeydown={handleKeydown}
				/>
			</div>
			{#if errorMsg}
				<p class="text-sm text-destructive">{errorMsg}</p>
			{/if}
		</div>
		<Dialog.Footer>
			<Button variant="outline" onclick={() => (open = false)}>Cancel</Button>
			<Button onclick={handleGo}>Go to Profile</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
