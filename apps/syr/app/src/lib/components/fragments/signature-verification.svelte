<script lang="ts">
	import { onMount } from 'svelte';
	import {
		initCryptoWasm,
		verify,
		canonicalize,
		decodeMultibase,
		decodePublicKey
	} from '@syr-is/crypto';
	import { parseDid } from '@syr-is/did';
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

	type VerifyState = 'idle' | 'none' | 'bad' | 'mismatch' | 'ok_root' | 'ok_device';

	let status = $state<VerifyState>('idle');

	function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
		if (a.length !== b.length) return false;
		for (let i = 0; i < a.length; i++) {
			if (a[i] !== b[i]) return false;
		}
		return true;
	}

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
				const payloadDid = payload.did;
				if (typeof payloadDid !== 'string' || payloadDid !== did) {
					status = 'mismatch';
					return;
				}
				const msg = canonicalize(payload);
				const sig = decodeMultibase(signatureMultibase);
				const pk = decodePublicKey(signingPublicKeyMultibase);
				const ok = await verify(msg, sig, pk);
				if (!ok) {
					status = 'bad';
					return;
				}
				let rootPk: Uint8Array;
				try {
					rootPk = parseDid(did).publicKey;
				} catch {
					status = 'bad';
					return;
				}
				status = bytesEqual(pk, rootPk) ? 'ok_root' : 'ok_device';
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
	{:else if status === 'mismatch'}
		<Badge variant="destructive">Payload DID mismatch</Badge>
	{:else if status === 'ok_root'}
		<Badge variant="default" class="bg-emerald-600 hover:bg-emerald-600">
			Signature valid (root)
		</Badge>
	{:else if status === 'ok_device'}
		<Badge
			variant="outline"
			title="Ed25519 verifies; delegation chain is not re-checked in the browser"
		>
			Device signature valid
		</Badge>
	{:else}
		<Badge variant="destructive">Signature invalid</Badge>
	{/if}
</div>
