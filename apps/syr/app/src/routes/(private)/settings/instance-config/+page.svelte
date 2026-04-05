<script lang="ts">
	import * as Card from '@syr-is/ui/card';
	import { Input } from '@syr-is/ui/input';
	import { Button, buttonVariants } from '@syr-is/ui/button';
	import * as Select from '@syr-is/ui/select';
	import { toast } from 'svelte-sonner';
	import { invalidateAll } from '$app/navigation';
	import type { PageData } from './$types';
	import RemoveDiscoveryRegistryDialog from '$lib/components/fragments/remove-discovery-registry-dialog.svelte';
	import DeleteInviteCodeDialog from '$lib/components/fragments/delete-invite-code-dialog.svelte';
	import { Copy } from 'lucide-svelte';

	let { data }: { data: PageData } = $props();

	let profileSyncAssetPath = $state('');
	let usernameCooldownDays = $state('');
	let pathLoading = $state(false);
	let cooldownLoading = $state(false);

	let registrationMode = $state('open');
	let registrationModeLoading = $state(false);

	let newCodeMaxUses = $state<number | null>(null);
	let creatingCode = $state(false);
	let deleteCodeDialogOpen = $state(false);
	let codeToDelete = $state<string | null>(null);

	let newInstanceRegistryUrl = $state('');
	let addingInstanceRegistry = $state(false);
	let removeInstanceDialogOpen = $state(false);
	let instanceRegistryToRemove = $state<{ id: string; registryUrl: string } | null>(null);

	$effect(() => {
		profileSyncAssetPath = data.profileSyncAssetPath;
		usernameCooldownDays = data.usernameCooldownDays;
		registrationMode = data.registrationMode;
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

	async function saveRegistrationMode() {
		registrationModeLoading = true;
		try {
			const res = await fetch('/api/instance-config/registration_mode', {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ value: registrationMode })
			});
			const json = await res.json();
			if (!res.ok) {
				toast.error(json.message ?? 'Failed to update');
				return;
			}
			toast.success('Registration mode updated');
			await invalidateAll();
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Failed to update');
		} finally {
			registrationModeLoading = false;
		}
	}

	async function createInviteCode() {
		creatingCode = true;
		try {
			const maxUses = newCodeMaxUses != null && newCodeMaxUses >= 1 ? newCodeMaxUses : null;
			if (newCodeMaxUses != null && (isNaN(newCodeMaxUses) || newCodeMaxUses < 1)) {
				toast.error('Max uses must be a positive number');
				return;
			}
			const res = await fetch('/api/invite-codes', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ max_uses: maxUses })
			});
			const json = await res.json();
			if (!res.ok) {
				toast.error(json.message ?? 'Failed to create invite code');
				return;
			}
			newCodeMaxUses = null;
			toast.success(`Invite code created: ${json.data.code}`);
			await invalidateAll();
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Failed to create invite code');
		} finally {
			creatingCode = false;
		}
	}

	async function copyCode(code: string) {
		try {
			await navigator.clipboard.writeText(code);
			toast.success('Copied to clipboard');
		} catch {
			toast.error('Failed to copy');
		}
	}

	function openDeleteCode(code: string) {
		codeToDelete = code;
		deleteCodeDialogOpen = true;
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
			<Card.Title>Registration mode</Card.Title>
			<Card.Description>Control who can create accounts on this instance.</Card.Description>
		</Card.Header>
		<Card.Content class="space-y-4">
			<div class="flex gap-2">
				<Select.Root type="single" bind:value={registrationMode}>
					<Select.Trigger class="w-full" aria-label="Registration mode">
						{registrationMode === 'open'
							? 'Open — anyone can register'
							: registrationMode === 'invite_only'
								? 'Invite only — requires an invite code'
								: 'Closed — no new registrations'}
					</Select.Trigger>
					<Select.Content>
						<Select.Item value="open">Open — anyone can register</Select.Item>
						<Select.Item value="invite_only">Invite only — requires an invite code</Select.Item>
						<Select.Item value="closed">Closed — no new registrations</Select.Item>
					</Select.Content>
				</Select.Root>
				<Button onclick={saveRegistrationMode} disabled={registrationModeLoading}>
					{registrationModeLoading ? 'Saving…' : 'Save'}
				</Button>
			</div>
		</Card.Content>
	</Card.Root>

	{#if registrationMode === 'invite_only'}
		<Card.Root>
			<Card.Header>
				<Card.Title>Invite codes</Card.Title>
				<Card.Description>
					Create and manage invite codes for new user registration. Each code can optionally be
					limited to a maximum number of uses.
				</Card.Description>
			</Card.Header>
			<Card.Content class="space-y-4">
				<div class="flex flex-col gap-2 sm:flex-row sm:items-end">
					<div class="flex min-w-0 flex-1 flex-col gap-1">
						<label for="invite-max-uses" class="text-sm font-medium">Max uses (optional)</label>
						<Input
							id="invite-max-uses"
							type="number"
							min={1}
							bind:value={newCodeMaxUses}
							placeholder="Unlimited"
						/>
					</div>
					<Button onclick={createInviteCode} disabled={creatingCode}>
						{creatingCode ? 'Creating…' : 'Create code'}
					</Button>
				</div>
				{#if data.inviteCodes?.length}
					<ul class="space-y-2">
						{#each data.inviteCodes as invite (invite.code)}
							<li
								class="flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm"
							>
								<div class="flex flex-col gap-0.5">
									<div class="flex items-center gap-2">
										<code class="font-mono text-xs">{invite.code}</code>
										<button
											type="button"
											class="text-muted-foreground hover:text-foreground"
											onclick={() => copyCode(invite.code)}
											aria-label="Copy invite code"
										>
											<Copy class="h-3.5 w-3.5" />
										</button>
									</div>
									<span class="text-xs text-muted-foreground">
										{invite.uses}{invite.max_uses !== null ? `/${invite.max_uses}` : ''} uses &middot;
										by {invite.created_by}
									</span>
								</div>
								<button
									type="button"
									class={buttonVariants({ variant: 'destructive', size: 'sm' })}
									onclick={() => openDeleteCode(invite.code)}
								>
									Delete
								</button>
							</li>
						{/each}
					</ul>
				{:else}
					<p class="text-sm text-muted-foreground">No invite codes yet.</p>
				{/if}
			</Card.Content>
		</Card.Root>
	{/if}

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

<DeleteInviteCodeDialog
	bind:open={deleteCodeDialogOpen}
	code={codeToDelete}
	onSuccess={() => invalidateAll()}
/>

<RemoveDiscoveryRegistryDialog
	bind:open={removeInstanceDialogOpen}
	registry={instanceRegistryToRemove}
	instanceMode={true}
	onSuccess={() => invalidateAll()}
/>
