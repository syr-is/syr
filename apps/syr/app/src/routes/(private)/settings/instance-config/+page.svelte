<script lang="ts">
	import * as Card from '@syr-is/ui/card';
	import { Input } from '@syr-is/ui/input';
	import { Button, buttonVariants } from '@syr-is/ui/button';
	import { toast } from 'svelte-sonner';
	import { invalidateAll } from '$app/navigation';
	import type { PageData } from './$types';
	import RemoveDiscoveryRegistryDialog from '$lib/components/fragments/remove-discovery-registry-dialog.svelte';

	let { data }: { data: PageData } = $props();

	let profileSyncAssetPath = $state('');
	let usernameCooldownDays = $state('');
	let pathLoading = $state(false);
	let cooldownLoading = $state(false);

	let newInstanceRegistryUrl = $state('');
	let addingInstanceRegistry = $state(false);
	let removeInstanceDialogOpen = $state(false);
	let instanceRegistryToRemove = $state<{ id: string; registryUrl: string } | null>(null);

	$effect(() => {
		profileSyncAssetPath = data.profileSyncAssetPath;
		usernameCooldownDays = data.usernameCooldownDays;
	});

	async function saveProfileSyncPath() {
		pathLoading = true;
		try {
			const res = await fetch('/api/instance-config/default_profile_sync_asset_upload_path', {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ value: profileSyncAssetPath.trim() || 'me/profile/public' })
			});
			const json = await res.json();
			if (!res.ok) {
				toast.error(json.message ?? 'Failed to update');
				return;
			}
			toast.success('Profile sync asset path updated');
			await invalidateAll();
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Failed to update');
		} finally {
			pathLoading = false;
		}
	}

	async function saveUsernameCooldown() {
		const n = parseInt(usernameCooldownDays, 10);
		if (isNaN(n) || n < 1 || n > 365) {
			toast.error('Enter a number between 1 and 365');
			return;
		}
		cooldownLoading = true;
		try {
			const res = await fetch('/api/instance-config/username_change_cooldown_days', {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ value: String(n) })
			});
			const json = await res.json();
			if (!res.ok) {
				toast.error(json.message ?? 'Failed to update');
				return;
			}
			toast.success('Username cooldown updated');
			await invalidateAll();
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Failed to update');
		} finally {
			cooldownLoading = false;
		}
	}

	async function addInstanceRegistry() {
		if (!newInstanceRegistryUrl.trim()) return;
		addingInstanceRegistry = true;
		try {
			const res = await fetch('/api/instance/discovery-registries', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ registryUrl: newInstanceRegistryUrl.trim() })
			});
			const j = (await res.json().catch(() => ({}))) as {
				message?: string;
				error?: { message?: string };
			};
			if (!res.ok) {
				throw new Error(
					j.error?.message ?? j.message ?? 'Failed to add instance discovery registry'
				);
			}
			newInstanceRegistryUrl = '';
			toast.success('Instance discovery registry added');
			await invalidateAll();
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Failed to add registry');
		} finally {
			addingInstanceRegistry = false;
		}
	}

	function openRemoveInstance(reg: { id: string; registryUrl: string }) {
		instanceRegistryToRemove = reg;
		removeInstanceDialogOpen = true;
	}
</script>

<svelte:head>
	<title>Instance config | Settings | SYR</title>
</svelte:head>

<div class="mx-auto max-w-2xl space-y-6">
	<Card.Root>
		<Card.Header>
			<Card.Title>Default profile sync asset upload path</Card.Title>
			<Card.Description>
				Path relative to each user's uploads folder for Syner profile asset uploads. Use
				slash-separated segments; alphanumeric, hyphen, and underscore only (e.g.
				me/profile/public).
			</Card.Description>
		</Card.Header>
		<Card.Content class="space-y-4">
			<div class="flex gap-2">
				<Input
					id="profile-sync-asset-path"
					aria-label="Profile sync asset path"
					bind:value={profileSyncAssetPath}
					placeholder="me/profile/public"
					class="font-mono"
				/>
				<Button onclick={saveProfileSyncPath} disabled={pathLoading}>
					{pathLoading ? 'Saving…' : 'Save'}
				</Button>
			</div>
		</Card.Content>
	</Card.Root>

	<Card.Root>
		<Card.Header>
			<Card.Title>Username change cooldown (days)</Card.Title>
			<Card.Description>Minimum days between allowed username changes per user.</Card.Description>
		</Card.Header>
		<Card.Content class="space-y-4">
			<div class="flex gap-2">
				<Input
					id="username-cooldown-days"
					aria-label="Username change cooldown days"
					bind:value={usernameCooldownDays}
					type="number"
					min={1}
					max={365}
					placeholder="7"
				/>
				<Button onclick={saveUsernameCooldown} disabled={cooldownLoading}>
					{cooldownLoading ? 'Saving…' : 'Save'}
				</Button>
			</div>
		</Card.Content>
	</Card.Root>

	<Card.Root>
		<Card.Header>
			<Card.Title>Instance discovery registries</Card.Title>
			<Card.Description>
				Registries used to resolve <strong class="font-medium text-foreground">remote</strong>
				<code class="text-xs">did:syr</code> profiles for everyone visiting this instance (including
				logged-out users). Personal discovery lists still apply first for signed-in users. This does
				<strong class="font-medium text-foreground">not</strong> change who may be followed — follow
				gating still uses each user’s own discovery settings.
			</Card.Description>
		</Card.Header>
		<Card.Content class="space-y-4">
			<div class="flex flex-col gap-2 sm:flex-row sm:items-end">
				<div class="flex min-w-0 flex-1 flex-col gap-1">
					<label for="instance-registry-url" class="text-sm font-medium">Registry URL</label>
					<input
						id="instance-registry-url"
						type="url"
						bind:value={newInstanceRegistryUrl}
						placeholder="https://registry.example.com"
						class="w-full rounded-md border px-3 py-2 text-sm"
					/>
				</div>
				<button
					type="button"
					class={buttonVariants({ variant: 'default', size: 'sm' })}
					onclick={addInstanceRegistry}
					disabled={addingInstanceRegistry || !newInstanceRegistryUrl.trim()}
				>
					{addingInstanceRegistry ? 'Adding…' : 'Add'}
				</button>
			</div>
			{#if data.instanceDiscoveryRegistries?.length}
				<ul class="space-y-2">
					{#each data.instanceDiscoveryRegistries as reg (reg.id)}
						<li
							class="flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm"
						>
							<span class="font-mono text-xs break-all">{reg.registryUrl}</span>
							<button
								type="button"
								class={buttonVariants({ variant: 'destructive', size: 'sm' })}
								onclick={() => openRemoveInstance(reg)}
							>
								Remove
							</button>
						</li>
					{/each}
				</ul>
			{:else}
				<p class="text-sm text-muted-foreground">No instance discovery registries yet.</p>
			{/if}
		</Card.Content>
	</Card.Root>
</div>

<RemoveDiscoveryRegistryDialog
	bind:open={removeInstanceDialogOpen}
	registry={instanceRegistryToRemove}
	instanceMode={true}
	onSuccess={() => invalidateAll()}
/>
