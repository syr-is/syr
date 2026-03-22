<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import * as Card from '@syr-is/ui/card';
	import { buttonVariants } from '@syr-is/ui/button';
	import { toast } from 'svelte-sonner';
	import type { PageData } from './$types';
	import RemoveDiscoveryRegistryDialog from '$lib/components/fragments/remove-discovery-registry-dialog.svelte';

	let { data }: { data: PageData } = $props();

	let newRegistryUrl = $state('');
	let addingRegistry = $state(false);
	let copying = $state(false);
	let removeDialogOpen = $state(false);
	let registryToRemove = $state<{ id: string; registryUrl: string } | null>(null);

	async function addRegistry() {
		if (!newRegistryUrl.trim()) return;
		addingRegistry = true;
		try {
			const res = await fetch('/api/user/discovery-registries', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ registryUrl: newRegistryUrl.trim() })
			});
			if (!res.ok) {
				const err = await res.json().catch(() => ({}));
				throw new Error(err?.message ?? 'Failed to add discovery registry');
			}
			newRegistryUrl = '';
			toast.success('Discovery registry added');
			await invalidateAll();
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Failed to add discovery registry');
		} finally {
			addingRegistry = false;
		}
	}

	function openRemove(reg: { id: string; registryUrl: string }) {
		registryToRemove = reg;
		removeDialogOpen = true;
	}

	async function copyPublicationToDiscovery() {
		const urls = data.publicationRegistryUrls ?? [];
		if (urls.length === 0) {
			toast.message('No publication registries to copy');
			return;
		}
		const existing = new Set((data.discoveryRegistries ?? []).map((r) => r.registryUrl.trim()));
		const toAdd = urls.filter((u) => !existing.has(u.trim()));
		if (toAdd.length === 0) {
			toast.message('All publication registries are already in your discovery list');
			return;
		}
		copying = true;
		try {
			let added = 0;
			for (const registryUrl of toAdd) {
				const res = await fetch('/api/user/discovery-registries', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ registryUrl })
				});
				if (res.ok) added += 1;
			}
			if (added > 0) {
				toast.success(`Added ${added} registry URL${added === 1 ? '' : 's'} to discovery`);
				await invalidateAll();
			} else {
				toast.error('Could not copy registries');
			}
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Copy failed');
		} finally {
			copying = false;
		}
	}
</script>

<div class="mx-auto max-w-2xl space-y-6">
	<div>
		<h1 class="text-2xl font-semibold">Discovery registries</h1>
		<p class="mt-1 text-sm text-muted-foreground">
			Registries used for <strong class="font-medium text-foreground">directory search</strong> and
			<strong class="font-medium text-foreground">follow discovery</strong> (whether a DID is
			listed). This is independent of
			<a href="/settings/identity" class="text-primary underline">publication registries</a>, where
			your own DID is registered and synced.
		</p>
	</div>

	<Card.Root>
		<Card.Header>
			<Card.Title>Your discovery list</Card.Title>
			<Card.Description>
				Add the base URLs of registries you trust to query for listings and resolution.
			</Card.Description>
		</Card.Header>
		<Card.Content class="space-y-4">
			<div class="flex flex-wrap gap-2">
				<button
					type="button"
					class={buttonVariants({ variant: 'outline', size: 'sm' })}
					onclick={copyPublicationToDiscovery}
					disabled={copying || (data.publicationRegistryUrls?.length ?? 0) === 0}
				>
					{copying ? 'Copying…' : 'Copy publication registries here'}
				</button>
			</div>

			<div class="flex gap-2">
				<input
					type="url"
					bind:value={newRegistryUrl}
					placeholder="https://registry.example.com"
					class="flex-1 rounded-md border px-3 py-2 text-sm"
				/>
				<button
					class={buttonVariants({ variant: 'default', size: 'sm' })}
					onclick={addRegistry}
					disabled={addingRegistry || !newRegistryUrl.trim()}
				>
					{addingRegistry ? 'Adding…' : 'Add'}
				</button>
			</div>

			{#if data.discoveryRegistries?.length}
				<ul class="space-y-2">
					{#each data.discoveryRegistries as reg (reg.id)}
						<li
							class="flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm"
						>
							<span class="font-mono text-xs break-all">{reg.registryUrl}</span>
							<button
								class={buttonVariants({ variant: 'destructive', size: 'sm' })}
								onclick={() => openRemove(reg)}
							>
								Remove
							</button>
						</li>
					{/each}
				</ul>
			{:else}
				<p class="text-sm text-muted-foreground">No discovery registries yet.</p>
			{/if}
		</Card.Content>
	</Card.Root>
</div>

<RemoveDiscoveryRegistryDialog
	bind:open={removeDialogOpen}
	registry={registryToRemove}
	onSuccess={() => invalidateAll()}
/>
