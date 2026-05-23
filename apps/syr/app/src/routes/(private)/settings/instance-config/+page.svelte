<script lang="ts">
	import * as Card from '@syr-is/ui/card';
	import { Input } from '@syr-is/ui/input';
	import { Button, buttonVariants } from '@syr-is/ui/button';
	import * as Select from '@syr-is/ui/select';
	import * as Pagination from '@syr-is/ui/pagination';
	import { toast } from 'svelte-sonner';
	import { invalidateAll } from '$app/navigation';
	import { copyToClipboard } from '$lib/utils/clipboard';
	import type { PageData } from './$types';
	import RemoveDiscoveryRegistryDialog from '$lib/components/fragments/remove-discovery-registry-dialog.svelte';
	import DeleteInviteCodeDialog from '$lib/components/fragments/delete-invite-code-dialog.svelte';
	import { Copy, AlertTriangle } from 'lucide-svelte';
	import * as Table from '@syr-is/ui/table';
	import { Progress } from '@syr-is/ui/progress';

	let { data }: { data: PageData } = $props();

	let profileSyncAssetPath = $state('');
	let usernameCooldownDays = $state('');
	let pathLoading = $state(false);
	let cooldownLoading = $state(false);

	let registrationModeDraft = $state('open');
	let registrationModePersisted = $state('open');
	let registrationModeLoading = $state(false);

	let defaultStorageLimitGb = $state('');
	let storageLimitLoading = $state(false);
	let instanceStorageCapacityGb = $state('');
	let capacityLoading = $state(false);
	let instanceMediaStorageGb = $state('');
	let mediaStorageLoading = $state(false);

	// Storage overview state
	type StorageOverview = {
		capacity: number;
		total_used: number;
		total_allocated: number;
		media_reservation: number;
		default_limit: number;
		user_count: number;
	};
	let storageOverview = $state<StorageOverview | null>(null);
	let overviewLoading = $state(false);

	// Per-user storage breakdown (paginated, usage-sorted) via /api/admin/storage/users
	type StorageUserRow = { id: string; username: string; bytes_used: number; bytes_limit: number };
	let storageUsers = $state<StorageUserRow[]>([]);
	let storageUsersTotal = $state(0);
	let storageUsersLoading = $state(false);
	let storageUsersPage = $state(1);
	const storageUsersSize = 10;
	const storageUsersTotalPages = $derived(
		Math.max(1, Math.ceil(storageUsersTotal / storageUsersSize))
	);

	let newCodeMaxUses = $state<number | null>(null);
	let newCodeReservedUsername = $state('');
	let creatingCode = $state(false);
	let deleteCodeDialogOpen = $state(false);
	let codeToDelete = $state<string | null>(null);

	// Invite codes (loaded client-side, paginated via /api/admin/invite-codes)
	type InviteRow = {
		code: string;
		created_by: string;
		max_uses: number | null;
		uses: number;
		created_at: string;
		reserved_username?: string;
	};
	let invites = $state<InviteRow[]>([]);
	let invitesTotal = $state(0);
	let invitesLoading = $state(false);
	let invitePage = $state(1);
	const inviteSize = 10;
	const invitesTotalPages = $derived(Math.max(1, Math.ceil(invitesTotal / inviteSize)));

	let newInstanceRegistryUrl = $state('');
	let addingInstanceRegistry = $state(false);
	let removeInstanceDialogOpen = $state(false);
	let instanceRegistryToRemove = $state<{ id: string; registryUrl: string } | null>(null);

	$effect(() => {
		profileSyncAssetPath = data.profileSyncAssetPath;
		usernameCooldownDays = data.usernameCooldownDays;
		registrationModeDraft = data.registrationMode;
		registrationModePersisted = data.registrationMode;
		defaultStorageLimitGb = data.defaultStorageLimitGb;
		instanceStorageCapacityGb = data.instanceStorageCapacityGb;
		instanceMediaStorageGb = data.instanceMediaStorageGb;
	});

	async function loadStorageOverview() {
		overviewLoading = true;
		try {
			const res = await fetch('/api/admin/storage');
			if (!res.ok) {
				console.error('[instance-config] Storage overview fetch failed:', res.status);
				storageOverview = null;
				return;
			}
			const json = await res.json();
			if (json.status === 'success') {
				storageOverview = json.data;
			} else {
				storageOverview = null;
			}
		} catch (err) {
			console.error('[instance-config] Storage overview error:', err);
			storageOverview = null;
		} finally {
			overviewLoading = false;
		}
	}

	async function loadStorageUsers(targetPage: number = storageUsersPage) {
		storageUsersLoading = true;
		try {
			const res = await fetch(
				`/api/admin/storage/users?page=${targetPage}&size=${storageUsersSize}`
			);
			if (!res.ok) {
				storageUsers = [];
				storageUsersTotal = 0;
				return;
			}
			const json = await res.json();
			if (json.status === 'success') {
				storageUsers = json.data;
				storageUsersTotal = json.pagination?.total ?? storageUsers.length;
			} else {
				storageUsers = [];
				storageUsersTotal = 0;
			}
		} catch (err) {
			console.error('[instance-config] Storage users fetch failed:', err);
			storageUsers = [];
			storageUsersTotal = 0;
		} finally {
			storageUsersLoading = false;
		}
	}

	// Load data on mount
	$effect(() => {
		loadStorageOverview();
	});

	// Load the per-user breakdown on mount and whenever its page changes.
	$effect(() => {
		loadStorageUsers(storageUsersPage);
	});

	async function loadInvites(targetPage: number = invitePage) {
		invitesLoading = true;
		try {
			const res = await fetch(`/api/admin/invite-codes?page=${targetPage}&size=${inviteSize}`);
			if (!res.ok) {
				invites = [];
				invitesTotal = 0;
				return;
			}
			const json = await res.json();
			if (json.status === 'success') {
				invites = json.data;
				invitesTotal = json.pagination?.total ?? invites.length;
			} else {
				invites = [];
				invitesTotal = 0;
			}
		} catch (e) {
			console.error('[instance-config] Failed to load invite codes:', e);
			invites = [];
			invitesTotal = 0;
		} finally {
			invitesLoading = false;
		}
	}

	// (Re)load the invite list when the invite-only section is active or the page changes.
	$effect(() => {
		if (registrationModePersisted === 'invite_only') {
			loadInvites(invitePage);
		}
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

	async function saveDefaultStorageLimit() {
		const n = parseFloat(defaultStorageLimitGb);
		if (isNaN(n) || n <= 0) {
			toast.error('Enter a positive number');
			return;
		}
		storageLimitLoading = true;
		try {
			const res = await fetch('/api/instance-config/default_storage_limit_gb', {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ value: String(n) })
			});
			const json = await res.json();
			if (!res.ok) {
				toast.error(json.message ?? 'Failed to update');
				return;
			}
			toast.success('Default storage limit updated');
			await invalidateAll();
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Failed to update');
		} finally {
			storageLimitLoading = false;
		}
	}

	async function saveInstanceCapacity() {
		const n = parseFloat(instanceStorageCapacityGb);
		if (isNaN(n) || n <= 0) {
			toast.error('Enter a positive number');
			return;
		}
		capacityLoading = true;
		try {
			const res = await fetch('/api/instance-config/instance_storage_capacity_gb', {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ value: String(n) })
			});
			const json = await res.json();
			if (!res.ok) {
				toast.error(json.message ?? 'Failed to update');
				return;
			}
			toast.success('Instance storage capacity updated');
			await invalidateAll();
			await loadStorageOverview();
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Failed to update');
		} finally {
			capacityLoading = false;
		}
	}

	async function saveInstanceMediaStorage() {
		const n = parseFloat(instanceMediaStorageGb);
		if (isNaN(n) || n <= 0) {
			toast.error('Enter a positive number');
			return;
		}
		mediaStorageLoading = true;
		try {
			const res = await fetch('/api/instance-config/instance_media_storage_gb', {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ value: String(n) })
			});
			const json = await res.json();
			if (!res.ok) {
				toast.error(json.message ?? 'Failed to update');
				return;
			}
			toast.success('Instance media storage updated');
			await invalidateAll();
			await loadStorageOverview();
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Failed to update');
		} finally {
			mediaStorageLoading = false;
		}
	}

	function fmtBytes(bytes: number): string {
		if (bytes === 0) return '0 B';
		const k = 1024;
		const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
		const i = Math.floor(Math.log(bytes) / Math.log(k));
		return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
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
				body: JSON.stringify({ value: registrationModeDraft })
			});
			const json = await res.json();
			if (!res.ok) {
				registrationModeDraft = registrationModePersisted;
				toast.error(json.message ?? 'Failed to update');
				return;
			}
			registrationModePersisted = registrationModeDraft;
			toast.success('Registration mode updated');
			await invalidateAll();
		} catch (e) {
			registrationModeDraft = registrationModePersisted;
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
			const reserved = newCodeReservedUsername.trim() || undefined;
			const res = await fetch('/api/invite-codes', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ max_uses: maxUses, reserved_username: reserved })
			});
			const json = await res.json();
			if (!res.ok) {
				toast.error(json.error?.message ?? json.message ?? 'Failed to create invite code');
				return;
			}
			newCodeMaxUses = null;
			newCodeReservedUsername = '';
			toast.success(`Invite code created: ${json.data.code}`);
			invitePage = 1;
			await loadInvites(1);
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Failed to create invite code');
		} finally {
			creatingCode = false;
		}
	}

	async function copyCode(code: string) {
		try {
			await copyToClipboard(code);
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
				<Select.Root type="single" bind:value={registrationModeDraft}>
					<Select.Trigger class="w-full" aria-label="Registration mode">
						{registrationModeDraft === 'open'
							? 'Open — anyone can register'
							: registrationModeDraft === 'invite_only'
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

	{#if registrationModePersisted === 'invite_only'}
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
					<div class="flex min-w-0 flex-1 flex-col gap-1">
						<label for="invite-reserved-username" class="text-sm font-medium"
							>Reserved username (optional)</label
						>
						<Input
							id="invite-reserved-username"
							type="text"
							bind:value={newCodeReservedUsername}
							placeholder="Pre-assign a username"
							maxlength={30}
						/>
					</div>
					<Button onclick={createInviteCode} disabled={creatingCode}>
						{creatingCode ? 'Creating…' : 'Create code'}
					</Button>
				</div>
				{#if invitesLoading && invites.length === 0}
					<p class="text-sm text-muted-foreground">Loading…</p>
				{:else if invites.length}
					<ul class="space-y-2">
						{#each invites as invite (invite.code)}
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
										{#if invite.reserved_username}
											&middot; reserved for <span class="font-medium text-foreground"
												>{invite.reserved_username}</span
											>
										{/if}
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
					{#if invitesTotalPages > 1}
						<Pagination.Root count={invitesTotal} perPage={inviteSize} bind:page={invitePage}>
							{#snippet children({ pages, currentPage })}
								<Pagination.Content>
									{#if currentPage > 1}
										<Pagination.Item>
											<Pagination.PrevButton />
										</Pagination.Item>
									{/if}
									{#each pages as p (p.key)}
										{#if p.type === 'ellipsis'}
											<Pagination.Item>
												<Pagination.Ellipsis />
											</Pagination.Item>
										{:else}
											<Pagination.Item>
												<Pagination.Link page={p} isActive={currentPage === p.value}>
													{p.value}
												</Pagination.Link>
											</Pagination.Item>
										{/if}
									{/each}
									{#if currentPage < invitesTotalPages}
										<Pagination.Item>
											<Pagination.NextButton />
										</Pagination.Item>
									{/if}
								</Pagination.Content>
							{/snippet}
						</Pagination.Root>
					{/if}
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
			<Card.Title>Instance storage capacity (GB)</Card.Title>
			<Card.Description>
				Total storage available on your SeaweedFS volume. Set this to your actual disk/volume
				capacity so the overview below can warn about over-allocation.
			</Card.Description>
		</Card.Header>
		<Card.Content class="space-y-4">
			<div class="flex gap-2">
				<Input
					id="instance-storage-capacity-gb"
					aria-label="Instance storage capacity in GB"
					bind:value={instanceStorageCapacityGb}
					type="number"
					min={1}
					step={1}
					placeholder="Not configured"
				/>
				<Button onclick={saveInstanceCapacity} disabled={capacityLoading}>
					{capacityLoading ? 'Saving…' : 'Save'}
				</Button>
			</div>
		</Card.Content>
	</Card.Root>

	<Card.Root>
		<Card.Header>
			<Card.Title>Default storage limit (GB)</Card.Title>
			<Card.Description>
				Default file storage limit per user. Users without a custom override will use this limit.
			</Card.Description>
		</Card.Header>
		<Card.Content class="space-y-4">
			<div class="flex gap-2">
				<Input
					id="default-storage-limit-gb"
					aria-label="Default storage limit in GB"
					bind:value={defaultStorageLimitGb}
					type="number"
					min={0.1}
					step={0.1}
					placeholder="5"
				/>
				<Button onclick={saveDefaultStorageLimit} disabled={storageLimitLoading}>
					{storageLimitLoading ? 'Saving…' : 'Save'}
				</Button>
			</div>
		</Card.Content>
	</Card.Root>

	<Card.Root>
		<Card.Header>
			<Card.Title>Instance media storage (GB)</Card.Title>
			<Card.Description>
				Storage reserved for shared instance media (emojis, stickers, GIFs). This space is separate
				from individual user quotas and is managed by admins.
			</Card.Description>
		</Card.Header>
		<Card.Content class="space-y-4">
			<div class="flex gap-2">
				<Input
					id="instance-media-storage-gb"
					aria-label="Instance media storage in GB"
					bind:value={instanceMediaStorageGb}
					type="number"
					min={0.1}
					step={0.1}
					placeholder="Not configured"
				/>
				<Button onclick={saveInstanceMediaStorage} disabled={mediaStorageLoading}>
					{mediaStorageLoading ? 'Saving…' : 'Save'}
				</Button>
			</div>
		</Card.Content>
	</Card.Root>

	<Card.Root>
		<Card.Header>
			<Card.Title>Storage overview</Card.Title>
			<Card.Description>
				Instance-wide storage usage and allocation across all users.
			</Card.Description>
		</Card.Header>
		<Card.Content class="space-y-4">
			{#if overviewLoading}
				<p class="text-sm text-muted-foreground">Loading…</p>
			{:else if storageOverview}
				{@const o = storageOverview}
				{@const totalCommitted = o.total_allocated + o.media_reservation}
				{#if o.capacity > 0}
					{@const usedPct = Math.min(100, (o.total_used / o.capacity) * 100)}
					{@const allocPct = Math.min(100, (o.total_allocated / o.capacity) * 100)}
					{@const mediaPct = Math.min(100, (o.media_reservation / o.capacity) * 100)}
					<div class="space-y-2">
						<div class="flex flex-wrap justify-between gap-x-4 text-sm">
							<span>{fmtBytes(o.total_used)} used</span>
							<span>{fmtBytes(o.total_allocated)} user allocated</span>
							{#if o.media_reservation > 0}
								<span>{fmtBytes(o.media_reservation)} media reserved</span>
							{/if}
							<span>{fmtBytes(o.capacity)} capacity</span>
						</div>
						<!-- Stacked bar -->
						<div class="relative h-4 w-full overflow-hidden rounded-full bg-muted">
							{#if allocPct > 0}
								<div
									class="absolute inset-y-0 left-0 rounded-full bg-primary/25"
									style="width: {allocPct}%"
								></div>
							{/if}
							{#if usedPct > 0}
								<div
									class="absolute inset-y-0 left-0 rounded-full bg-primary"
									style="width: {usedPct}%"
								></div>
							{/if}
							{#if mediaPct > 0}
								<div
									class="absolute inset-y-0 rounded-full bg-amber-500/40"
									style="left: {allocPct}%; width: {mediaPct}%"
								></div>
							{/if}
						</div>
						<div class="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
							<span class="flex items-center gap-1">
								<span class="inline-block h-2.5 w-2.5 rounded-full bg-primary"></span>
								Used
							</span>
							<span class="flex items-center gap-1">
								<span class="inline-block h-2.5 w-2.5 rounded-full bg-primary/25"></span>
								User allocated
							</span>
							{#if o.media_reservation > 0}
								<span class="flex items-center gap-1">
									<span class="inline-block h-2.5 w-2.5 rounded-full bg-amber-500/40"></span>
									Media reserved
								</span>
							{/if}
							<span class="flex items-center gap-1">
								<span class="inline-block h-2.5 w-2.5 rounded-full border bg-muted"></span>
								Free
							</span>
						</div>
						{#if totalCommitted > o.capacity}
							<div
								class="flex items-center gap-2 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive"
							>
								<AlertTriangle class="h-4 w-4 shrink-0" />
								Over-committed by {fmtBytes(totalCommitted - o.capacity)} (users + media exceed capacity)
							</div>
						{/if}
					</div>
				{:else}
					<p class="text-sm text-muted-foreground">
						Set the instance storage capacity above to see the allocation overview.
					</p>
					<div class="flex flex-wrap justify-between gap-2 text-sm">
						<span><strong>Used:</strong> {fmtBytes(o.total_used)}</span>
						<span><strong>User allocated:</strong> {fmtBytes(o.total_allocated)}</span>
						{#if o.media_reservation > 0}
							<span><strong>Media reserved:</strong> {fmtBytes(o.media_reservation)}</span>
						{/if}
						<span><strong>Users:</strong> {o.user_count}</span>
					</div>
				{/if}

				{#if storageUsersLoading && storageUsers.length === 0}
					<p class="text-sm text-muted-foreground">Loading user breakdown…</p>
				{:else if storageUsers.length > 0}
					<Table.Root>
						<Table.Header>
							<Table.Row>
								<Table.Head>User</Table.Head>
								<Table.Head>Used</Table.Head>
								<Table.Head>Limit</Table.Head>
								<Table.Head>Usage</Table.Head>
							</Table.Row>
						</Table.Header>
						<Table.Body>
							{#each storageUsers as u (u.id)}
								{@const pct =
									u.bytes_limit > 0 ? Math.min(100, (u.bytes_used / u.bytes_limit) * 100) : 0}
								<Table.Row>
									<Table.Cell class="text-sm font-medium">{u.username}</Table.Cell>
									<Table.Cell class="text-xs">{fmtBytes(u.bytes_used)}</Table.Cell>
									<Table.Cell class="text-xs">{fmtBytes(u.bytes_limit)}</Table.Cell>
									<Table.Cell class="w-32">
										<Progress value={pct} />
									</Table.Cell>
								</Table.Row>
							{/each}
						</Table.Body>
					</Table.Root>
					{#if storageUsersTotalPages > 1}
						<Pagination.Root
							count={storageUsersTotal}
							perPage={storageUsersSize}
							bind:page={storageUsersPage}
						>
							{#snippet children({ pages, currentPage })}
								<Pagination.Content>
									{#if currentPage > 1}
										<Pagination.Item>
											<Pagination.PrevButton />
										</Pagination.Item>
									{/if}
									{#each pages as p (p.key)}
										{#if p.type === 'ellipsis'}
											<Pagination.Item>
												<Pagination.Ellipsis />
											</Pagination.Item>
										{:else}
											<Pagination.Item>
												<Pagination.Link page={p} isActive={currentPage === p.value}>
													{p.value}
												</Pagination.Link>
											</Pagination.Item>
										{/if}
									{/each}
									{#if currentPage < storageUsersTotalPages}
										<Pagination.Item>
											<Pagination.NextButton />
										</Pagination.Item>
									{/if}
								</Pagination.Content>
							{/snippet}
						</Pagination.Root>
					{/if}
				{/if}
			{:else}
				<p class="text-sm text-muted-foreground">Failed to load storage overview.</p>
			{/if}
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
	onSuccess={() => loadInvites(invitePage)}
/>

<RemoveDiscoveryRegistryDialog
	bind:open={removeInstanceDialogOpen}
	registry={instanceRegistryToRemove}
	instanceMode={true}
	onSuccess={() => invalidateAll()}
/>
