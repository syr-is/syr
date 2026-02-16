<script lang="ts">
	import { onMount } from 'svelte';
	import { invalidateAll } from '$app/navigation';
	import * as Card from '$lib/components/ui/card';
	import { buttonVariants } from '$lib/components/ui/button';
	import { toast } from 'svelte-sonner';
	import {
		addDeviceKey,
		hasRootKeyLocally,
		getCurrentDevicePublicKeyMultibase
	} from '$lib/services/identity.client';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
	let exportLoading = $state(false);
	let addDeviceLoading = $state(false);
	let revokingKey = $state<string | null>(null);
	let hasRootKey = $state<boolean | null>(null);
	let currentDevicePubKey = $state<string | null>(null);

	onMount(() => {
		hasRootKeyLocally().then((v) => (hasRootKey = v));
		getCurrentDevicePublicKeyMultibase().then((v) => (currentDevicePubKey = v));
	});

	async function exportIdentity() {
		if (!data.hasIdentity) return;
		exportLoading = true;
		try {
			const res = await fetch('/api/identity/export');
			if (!res.ok) {
				const err = await res.json();
				throw new Error(err?.message ?? 'Export failed');
			}
			const bundle = await res.json();
			const blob = new Blob([JSON.stringify(bundle.data, null, 2)], {
				type: 'application/json'
			});
			const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
			const url = URL.createObjectURL(blob);
			const a = document.createElement('a');
			a.href = url;
			a.download = `identity-export-${timestamp}.json`;
			a.click();
			URL.revokeObjectURL(url);
			toast.success('Identity exported successfully');
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Export failed');
		} finally {
			exportLoading = false;
		}
	}

	async function handleAddDevice() {
		addDeviceLoading = true;
		try {
			await addDeviceKey();
			toast.success('This device has been added');
			await invalidateAll();
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Add device failed');
		} finally {
			addDeviceLoading = false;
		}
	}

	async function revokeKey(publicKey: string) {
		if (!confirm('Revoke this device key? This device will no longer be able to sign mutations.')) {
			return;
		}
		revokingKey = publicKey;
		try {
			const res = await fetch('/api/identity/delegate/revoke', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ devicePublicKey: publicKey })
			});
			if (!res.ok) {
				const err = await res.json();
				throw new Error(err?.message ?? 'Revoke failed');
			}
			toast.success('Device key revoked');
			await invalidateAll();
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Revoke failed');
		} finally {
			revokingKey = null;
		}
	}

	function truncateKey(pubKey: string): string {
		if (pubKey.length <= 16) return pubKey;
		return pubKey.slice(0, 8) + '…' + pubKey.slice(-8);
	}
</script>

<div class="space-y-6">
	<Card.Root>
		<Card.Header>
			<Card.Title>Identity</Card.Title>
			<Card.Description>
				Manage your cryptographic identity, export for backup, add devices, and revoke delegated
				keys.
			</Card.Description>
		</Card.Header>
		<Card.Content class="space-y-4">
			{#if data.hasIdentity}
				<div class="space-y-2">
					<p class="text-sm font-medium">Your DID</p>
					<p class="font-mono text-sm break-all text-muted-foreground">{data.did}</p>
				</div>

				<div class="flex flex-wrap gap-2">
					<button
						class={buttonVariants({ variant: 'default' })}
						onclick={exportIdentity}
						disabled={exportLoading}
					>
						{#if exportLoading}
							Exporting...
						{:else}
							Export identity
						{/if}
					</button>
					{#if hasRootKey === true}
						<button
							class={buttonVariants({ variant: 'outline' })}
							onclick={handleAddDevice}
							disabled={addDeviceLoading}
						>
							{#if addDeviceLoading}
								Adding...
							{:else}
								Add this device
							{/if}
						</button>
					{/if}
				</div>

				{#if data.delegatedKeys?.length}
					<div class="space-y-2">
						<p class="text-sm font-medium">Delegated device keys</p>
						<ul class="space-y-2">
							{#each data.delegatedKeys as key (key.publicKey)}
								<li
									class="flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm"
								>
									<div class="flex flex-col gap-0.5">
										<span class="font-mono" title={key.publicKey}>{truncateKey(key.publicKey)}</span
										>
										<span class="text-muted-foreground">
											{key.revokedAt ? 'Revoked' : 'Active'}
											{#if currentDevicePubKey === key.publicKey}
												· This device
											{/if}
										</span>
									</div>
									{#if !key.revokedAt && currentDevicePubKey !== key.publicKey}
										<button
											class={buttonVariants({ variant: 'destructive', size: 'sm' })}
											onclick={() => revokeKey(key.publicKey)}
											disabled={revokingKey === key.publicKey}
										>
											{revokingKey === key.publicKey ? 'Revoking...' : 'Revoke'}
										</button>
									{/if}
								</li>
							{/each}
						</ul>
					</div>
				{/if}
			{:else}
				<p class="text-muted-foreground">
					You do not have an identity yet. Identity is created automatically when you first sign in
					after registration.
				</p>
			{/if}
		</Card.Content>
	</Card.Root>
</div>
