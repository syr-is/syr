<script lang="ts">
	import { onMount } from 'svelte';
	import {
		initCryptoWasm,
		verify,
		canonicalize,
		decodeMultibase,
		decodePublicKey
	} from '@syr-is/crypto';
	import { Badge } from '@syr-is/ui/badge';

	let {
		did,
		signedPayloadJson,
		signatureMultibase,
		signingPublicKeyMultibase
	}: {
		did: string;
		signedPayloadJson?: string | null;
		signatureMultibase?: string | null;
		signingPublicKeyMultibase?: string | null;
	} = $props();

	let status = $state<'idle' | 'ok' | 'bad' | 'none'>('idle');

	onMount(() => {
		(async () => {
			if (!signedPayloadJson || !signatureMultibase || !signingPublicKeyMultibase) {
				status = 'none';
				return;
			}
			try {
				await initCryptoWasm();
				const payload = JSON.parse(signedPayloadJson) as Record<string, unknown>;
				if (typeof payload !== 'object' || payload === null) {
					status = 'bad';
					return;
				}
				const msg = canonicalize(payload);
				const sig = decodeMultibase(signatureMultibase);
				const pk = decodePublicKey(signingPublicKeyMultibase);
				const ok = await verify(msg, sig, pk);
				status = ok ? 'ok' : 'bad';
			} catch {
				status = 'bad';
			}
		})();
	});
</script>

<div class="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
	<span class="font-mono" title={did}>DID: {did.slice(0, 18)}…</span>
	{#if status === 'none'}
		<Badge variant="secondary">Not signed</Badge>
	{:else if status === 'idle'}
		<Badge variant="outline">Checking…</Badge>
	{:else if status === 'ok'}
		<Badge variant="default" class="bg-emerald-600 hover:bg-emerald-600">Signature valid</Badge>
	{:else}
		<Badge variant="destructive">Signature invalid</Badge>
	{/if}
</div>
