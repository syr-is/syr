<script lang="ts">
	import * as Card from '@syr-is/ui/card';
	import * as Dialog from '@syr-is/ui/dialog';
	import { Button } from '@syr-is/ui/button';
	import { Badge } from '@syr-is/ui/badge';
	import { toast } from 'svelte-sonner';
	import { invalidateAll } from '$app/navigation';
	import { Shield, ShieldOff, ExternalLink, Loader2, KeyRound, Clock, Ban } from 'lucide-svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	let revoking = $state<string | null>(null);
	let confirmOpen = $state(false);
	let confirmTarget = $state<{ platform_origin: string; platform_name: string } | null>(null);

	type DelegationStatus = 'active' | 'revoked' | 'expired';

	function getStatus(d: { revoked_at?: string; expires_at?: string }): DelegationStatus {
		if (d.revoked_at) return 'revoked';
		if (d.expires_at && new Date(d.expires_at) < new Date()) return 'expired';
		return 'active';
	}

	function formatDate(iso: string): string {
		return new Date(iso).toLocaleDateString(undefined, {
			year: 'numeric',
			month: 'short',
			day: 'numeric'
		});
	}

	function openRevoke(d: { platform_origin: string; platform_name: string }) {
		confirmTarget = d;
		confirmOpen = true;
	}

	async function doRevoke() {
		if (!confirmTarget) return;
		const origin = confirmTarget.platform_origin;
		revoking = origin;
		confirmOpen = false;
		try {
			const res = await fetch('/api/platform/revoke', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ platform_origin: origin })
			});
			if (!res.ok) {
				const err = await res.json().catch(() => ({}));
				throw new Error(err.error_description ?? err.message ?? 'Revocation failed');
			}
			toast.success(`Revoked delegation for ${confirmTarget.platform_name}`);
			await invalidateAll();
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Failed to revoke');
		} finally {
			revoking = null;
			confirmTarget = null;
		}
	}

	const activeDelegations = $derived(data.delegations.filter((d) => getStatus(d) === 'active'));
	const inactiveDelegations = $derived(data.delegations.filter((d) => getStatus(d) !== 'active'));
</script>

<svelte:head>
	<title>Platform Delegations | Settings | SYR</title>
</svelte:head>

<div class="mx-auto max-w-2xl space-y-6">
	<Card.Root>
		<Card.Header>
			<Card.Title class="flex items-center gap-2">
				<KeyRound class="h-5 w-5" />
				Platform Delegations
			</Card.Title>
			<Card.Description>
				Applications authorized to sign content on your behalf using delegated keys. Each delegation
				creates a separate Ed25519 keypair signed by your root identity.
			</Card.Description>
		</Card.Header>
		<Card.Content class="space-y-4">
			{#if data.delegations.length === 0}
				<div class="rounded-lg border border-dashed py-8 text-center">
					<Shield class="mx-auto h-8 w-8 text-muted-foreground/40" />
					<p class="mt-2 text-sm font-medium text-muted-foreground">No platform delegations</p>
					<p class="mt-1 text-xs text-muted-foreground">
						Third-party applications can request delegation through the platform API.
					</p>
				</div>
			{:else}
				{#if activeDelegations.length > 0}
					<div class="space-y-2">
						<h3 class="text-sm font-medium text-muted-foreground">
							Active ({activeDelegations.length})
						</h3>
						{#each activeDelegations as d (d.delegate_public_key)}
							<div
								class="flex items-start justify-between gap-3 rounded-lg border p-4 transition-colors hover:bg-muted/30"
							>
								<div class="min-w-0 flex-1 space-y-1.5">
									<div class="flex items-center gap-2">
										<span class="font-medium">{d.platform_name}</span>
										<Badge variant="default" class="bg-green-500/90 text-white">Active</Badge>
									</div>
									<a
										href={d.platform_origin}
										target="_blank"
										rel="noopener noreferrer"
										class="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground hover:underline"
									>
										{d.platform_origin}
										<ExternalLink class="h-3 w-3" />
									</a>
									<div class="flex flex-wrap gap-3 text-[11px] text-muted-foreground">
										<span>Created {formatDate(d.created_at)}</span>
										{#if d.expires_at}
											<span class="flex items-center gap-0.5">
												<Clock class="h-3 w-3" />
												Expires {formatDate(d.expires_at)}
											</span>
										{/if}
									</div>
									<p
										class="truncate font-mono text-[10px] text-muted-foreground/60"
										title={d.delegate_public_key}
									>
										Key: {d.delegate_public_key.slice(0, 20)}...
									</p>
								</div>
								<Button
									variant="destructive"
									size="sm"
									disabled={revoking === d.platform_origin}
									onclick={() => openRevoke(d)}
								>
									{#if revoking === d.platform_origin}
										<Loader2 class="h-3.5 w-3.5 animate-spin" />
									{:else}
										<ShieldOff class="mr-1 h-3.5 w-3.5" />
										Revoke
									{/if}
								</Button>
							</div>
						{/each}
					</div>
				{/if}

				{#if inactiveDelegations.length > 0}
					<div class="space-y-2">
						<h3 class="text-sm font-medium text-muted-foreground">
							Inactive ({inactiveDelegations.length})
						</h3>
						{#each inactiveDelegations as d (d.delegate_public_key)}
							{@const status = getStatus(d)}
							<div class="flex items-start justify-between gap-3 rounded-lg border p-4 opacity-60">
								<div class="min-w-0 flex-1 space-y-1.5">
									<div class="flex items-center gap-2">
										<span class="font-medium">{d.platform_name}</span>
										{#if status === 'revoked'}
											<Badge variant="destructive">
												<Ban class="mr-0.5 h-3 w-3" />
												Revoked
											</Badge>
										{:else}
											<Badge variant="secondary">
												<Clock class="mr-0.5 h-3 w-3" />
												Expired
											</Badge>
										{/if}
									</div>
									<span class="text-xs text-muted-foreground">{d.platform_origin}</span>
									<div class="flex flex-wrap gap-3 text-[11px] text-muted-foreground">
										<span>Created {formatDate(d.created_at)}</span>
										{#if d.revoked_at}
											<span>Revoked {formatDate(d.revoked_at)}</span>
										{:else if d.expires_at}
											<span>Expired {formatDate(d.expires_at)}</span>
										{/if}
									</div>
									<p
										class="truncate font-mono text-[10px] text-muted-foreground/60"
										title={d.delegate_public_key}
									>
										Key: {d.delegate_public_key.slice(0, 20)}...
									</p>
								</div>
							</div>
						{/each}
					</div>
				{/if}
			{/if}
		</Card.Content>
	</Card.Root>
</div>

<Dialog.Root bind:open={confirmOpen}>
	<Dialog.Content class="max-w-sm">
		<Dialog.Header>
			<Dialog.Title class="flex items-center gap-2 text-destructive">
				<ShieldOff class="h-5 w-5" />
				Revoke Delegation
			</Dialog.Title>
			<Dialog.Description>
				{#if confirmTarget}
					Are you sure you want to revoke the delegation for
					<strong>{confirmTarget.platform_name}</strong>? The application will immediately lose the
					ability to sign content on your behalf.
				{/if}
			</Dialog.Description>
		</Dialog.Header>
		<Dialog.Footer>
			<Button variant="outline" onclick={() => (confirmOpen = false)}>Cancel</Button>
			<Button variant="destructive" onclick={doRevoke}>Revoke</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
