<script lang="ts">
	import * as Card from '@syr-is/ui/card';
	import { Button } from '@syr-is/ui/button';
	import { Avatar, AvatarFallback, AvatarImage } from '@syr-is/ui/avatar';
	import SignatureVerification from '$lib/components/fragments/signature-verification.svelte';
	import { userSessionStore } from '$lib/stores/user-session.svelte';
	import { toast } from 'svelte-sonner';

	let { data } = $props();

	const p = $derived(data.publicProfile);
	const viewer = $derived(userSessionStore.user);
	const canFollow = $derived(!!viewer?.did && !!p.did && p.did !== viewer.did);

	let followBusy = $state(false);

	async function toggleFollow() {
		if (!p.did || !viewer) return;
		followBusy = true;
		try {
			const res = await fetch('/api/follows', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ followed_did: p.did })
			});
			const j = await res.json();
			if (!res.ok) {
				toast.error(j.error?.message ?? j.message ?? 'Follow failed');
				return;
			}
			if (j.data === null) {
				toast.info('No change');
				return;
			}
			toast.success('Now following');
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Follow failed');
		} finally {
			followBusy = false;
		}
	}
</script>

<div class="mx-auto max-w-2xl space-y-6 p-4">
	<Card.Root>
		<Card.Header class="flex flex-row items-start gap-4">
			<Avatar class="h-16 w-16">
				<AvatarImage src={p.avatar_url} alt="" />
				<AvatarFallback>{p.display_name?.slice(0, 2) ?? '?'}</AvatarFallback>
			</Avatar>
			<div class="min-w-0 flex-1 space-y-1">
				<Card.Title class="truncate">{p.display_name}</Card.Title>
				<Card.Description class="font-mono text-xs">@{p.username}</Card.Description>
				{#if p.did}
					<SignatureVerification
						did={p.did}
						signedPayloadJson={p.signed_payload_json}
						signatureMultibase={p.content_signature}
						signingPublicKeyMultibase={p.signing_device_public_key}
					/>
				{/if}
			</div>
			{#if canFollow}
				<Button size="sm" onclick={toggleFollow} disabled={followBusy}>Follow</Button>
			{/if}
		</Card.Header>
		{#if p.bio}
			<Card.Content>
				<p class="text-sm whitespace-pre-wrap">{p.bio}</p>
			</Card.Content>
		{/if}
	</Card.Root>
</div>
