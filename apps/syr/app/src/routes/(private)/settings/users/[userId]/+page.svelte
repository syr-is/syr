<script lang="ts">
	import * as Card from '@syr-is/ui/card';
	import * as Table from '@syr-is/ui/table';
	import { Button } from '@syr-is/ui/button';
	import { Input } from '@syr-is/ui/input';
	import { Progress } from '@syr-is/ui/progress';
	import { toast } from 'svelte-sonner';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { List, FolderOpen, ExternalLink, AlertTriangle } from 'lucide-svelte';
	import FileBrowser from '$lib/components/fragments/file-browser.svelte';
	import AdminDeleteUserDialog from '$lib/components/fragments/admin-delete-user-dialog.svelte';
	import AdminDeletePostDialog from '$lib/components/fragments/admin-delete-post-dialog.svelte';
	import AdminDeleteUploadDialog from '$lib/components/fragments/admin-delete-upload-dialog.svelte';
	import type { PageData } from './$types';
	import type { Folder, UploadWithCompositeId } from '@syr-is/types';

	const { data }: { data: PageData } = $props();
	const userId = $derived(data.userId);

	// --- User info ---
	type UserInfo = {
		id: string;
		username: string;
		did: string | null;
		role: string;
		created_at: string;
		updated_at: string;
		display_name: string;
		bio: string | null;
	};
	let userInfo = $state<UserInfo | null>(null);
	let _userLoading = $state(true);
	let requestId = $state(0);

	async function loadUser() {
		const myId = ++requestId;
		_userLoading = true;
		userInfo = null;
		try {
			const res = await fetch(`/api/admin/users/${encodeURIComponent(userId)}`);
			if (myId !== requestId) return;
			if (!res.ok) {
				userInfo = null;
				return;
			}
			const json = await res.json();
			if (myId !== requestId) return;
			userInfo = json.status === 'success' ? json.data : null;
		} catch (e) {
			if (myId !== requestId) return;
			console.error('[admin] Failed to load user:', e);
			userInfo = null;
		} finally {
			if (myId === requestId) _userLoading = false;
		}
	}

	// --- Storage ---
	type StorageInfo = {
		bytes_used: number;
		bytes_limit: number;
		percentage_used: number;
		bytes_remaining: number;
		uploads_enabled: boolean;
	};
	let storage = $state<StorageInfo | null>(null);
	let storageLoading = $state(true);
	let customLimitGb = $state('');
	let limitSaving = $state(false);
	let toggleSaving = $state(false);

	// Instance storage overview for context
	type InstanceOverview = {
		capacity: number;
		total_used: number;
		total_allocated: number;
	};
	let instanceOverview = $state<InstanceOverview | null>(null);

	async function loadInstanceOverview() {
		try {
			const res = await fetch('/api/admin/storage');
			const json = await res.json();
			if (json.status === 'success') instanceOverview = json.data;
		} catch {
			instanceOverview = null;
		}
	}

	async function loadStorage() {
		storageLoading = true;
		try {
			const res = await fetch(`/api/admin/users/${encodeURIComponent(userId)}/storage`);
			const json = await res.json();
			if (json.status === 'success') {
				storage = json.data;
			} else {
				storage = null;
			}
		} catch (e) {
			console.error('[admin] Failed to load storage:', e);
			storage = null;
		} finally {
			storageLoading = false;
		}
	}

	async function setStorageLimit() {
		const gb = parseFloat(customLimitGb);
		if (isNaN(gb) || gb <= 0) {
			toast.error('Enter a valid number of GB');
			return;
		}
		limitSaving = true;
		try {
			const res = await fetch(`/api/admin/users/${encodeURIComponent(userId)}/storage`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ bytes_limit: Math.round(gb * 1024 * 1024 * 1024) })
			});
			const json = await res.json();
			if (!res.ok) {
				toast.error(json.message ?? 'Failed to set limit');
				return;
			}
			storage = json.data;
			customLimitGb = '';
			toast.success('Storage limit updated');
			loadInstanceOverview();
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Failed to set limit');
		} finally {
			limitSaving = false;
		}
	}

	async function resetStorageLimit() {
		limitSaving = true;
		try {
			const res = await fetch(`/api/admin/users/${encodeURIComponent(userId)}/storage`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ reset: true })
			});
			const json = await res.json();
			if (!res.ok) {
				toast.error(json.message ?? 'Failed to reset');
				return;
			}
			storage = json.data;
			toast.success('Storage limit reset to default');
			loadInstanceOverview();
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Failed to reset');
		} finally {
			limitSaving = false;
		}
	}

	async function toggleUploads() {
		if (!storage) return;
		toggleSaving = true;
		try {
			const res = await fetch(`/api/admin/users/${encodeURIComponent(userId)}/storage`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ uploads_enabled: !storage.uploads_enabled })
			});
			const json = await res.json();
			if (!res.ok) {
				toast.error(json.message ?? 'Failed to toggle uploads');
				return;
			}
			storage = json.data;
			toast.success(storage?.uploads_enabled ? 'Uploads enabled' : 'Uploads disabled');
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Failed to toggle');
		} finally {
			toggleSaving = false;
		}
	}

	// --- Posts ---
	type PostRow = {
		id: string;
		did: string | null;
		local_id: string | null;
		type: string;
		title: string | null;
		visibility: string;
		status: string;
		created_at: string;
	};
	let posts = $state<PostRow[]>([]);
	let postsTotal = $state(0);
	let postsPage = $state(1);
	let postsLoading = $state(true);

	async function loadPosts() {
		postsLoading = true;
		try {
			const res = await fetch(
				`/api/admin/users/${encodeURIComponent(userId)}/posts?page=${postsPage}&size=10`
			);
			if (!res.ok) {
				posts = [];
				postsTotal = 0;
				return;
			}
			const json = await res.json();
			if (json.status === 'success') {
				posts = json.data;
				postsTotal = json.pagination?.total ?? 0;
				// Clamp page if total shrank
				const lastPage = Math.max(1, Math.ceil(postsTotal / 10));
				if (postsPage > lastPage) {
					postsPage = lastPage;
					return loadPosts();
				}
			} else {
				posts = [];
				postsTotal = 0;
			}
		} catch {
			posts = [];
			postsTotal = 0;
		} finally {
			postsLoading = false;
		}
	}

	// --- Uploads (list view) ---
	type UploadRow = {
		id: string;
		did: string | null;
		local_id: string | null;
		filename: string;
		mime_type: string;
		size: number;
		status: string;
		is_public: boolean;
		key: string | null;
		folder_id: string | null;
		url: string | null;
		created_at: string;
	};
	let uploads = $state<UploadRow[]>([]);
	let uploadsTotal = $state(0);
	let uploadsPage = $state(1);
	let uploadsLoading = $state(true);

	async function loadUploads() {
		uploadsLoading = true;
		try {
			const res = await fetch(
				`/api/admin/users/${encodeURIComponent(userId)}/uploads?page=${uploadsPage}&size=10`
			);
			if (!res.ok) {
				uploads = [];
				uploadsTotal = 0;
				return;
			}
			const json = await res.json();
			if (json.status === 'success') {
				uploads = json.data;
				uploadsTotal = json.pagination?.total ?? 0;
				const lastPage = Math.max(1, Math.ceil(uploadsTotal / 10));
				if (uploadsPage > lastPage) {
					uploadsPage = lastPage;
					return loadUploads();
				}
			} else {
				uploads = [];
				uploadsTotal = 0;
			}
		} catch {
			uploads = [];
			uploadsTotal = 0;
		} finally {
			uploadsLoading = false;
		}
	}

	// --- Uploads (browser view) ---
	let uploadViewMode = $state<'list' | 'browser'>('list');
	let browserFolderId = $state<string | null>(null);
	let browserFolders = $state<Folder[]>([]);
	let browserUploads = $state<UploadWithCompositeId[]>([]);
	let browserBreadcrumbs = $state<Array<{ id: string; name: string }>>([]);
	let browserLoading = $state(false);
	let browserPage = $state(1);
	let browserLimit = $state(20);
	let browserTotal = $state(0);
	let browserSortField = $state<'created_at' | 'updated_at' | 'filename' | 'size'>('created_at');
	let browserSortOrder = $state<'asc' | 'desc'>('desc');
	import type { ViewMode } from '$lib/types/display-item';
	let browserViewMode = $state<ViewMode>('list');

	async function loadBrowserFolders() {
		try {
			let qs = '';
			if (browserFolderId) qs = `?parent_id=${encodeURIComponent(browserFolderId)}`;
			const res = await fetch(`/api/admin/users/${encodeURIComponent(userId)}/folders${qs}`);
			const json = await res.json();
			if (json.status === 'success') {
				browserFolders = json.data.folders ?? [];
				browserBreadcrumbs = json.data.breadcrumbs ?? [];
			}
		} catch {
			browserFolders = [];
		}
	}

	async function loadBrowserUploads() {
		browserLoading = true;
		try {
			let qs = `page=${browserPage}&size=${browserLimit}&sort_field=${browserSortField}&sort_order=${browserSortOrder}`;
			if (browserFolderId === null) {
				qs += '&folder_id=';
			} else {
				qs += `&folder_id=${encodeURIComponent(browserFolderId)}`;
			}
			const res = await fetch(`/api/admin/users/${encodeURIComponent(userId)}/uploads?${qs}`);
			if (!res.ok) {
				browserUploads = [];
				browserTotal = 0;
				return;
			}
			const json = await res.json();
			if (json.status === 'success') {
				browserUploads = json.data;
				browserTotal = json.pagination?.total ?? 0;
			} else {
				browserUploads = [];
				browserTotal = 0;
			}
		} catch {
			browserUploads = [];
			browserTotal = 0;
		} finally {
			browserLoading = false;
		}
	}

	function navigateFolder(folderId: string | null) {
		browserFolderId = folderId;
		browserPage = 1;
	}

	function handleBrowserDelete(upload: UploadWithCompositeId) {
		if (!upload.did || !upload.local_id) {
			toast.error('Cannot delete: missing file identifiers');
			return;
		}
		deleteUploadTarget = {
			did: upload.did,
			localId: upload.local_id,
			filename: upload.filename
		};
		deleteUploadOpen = true;
	}

	function switchUploadView(mode: 'list' | 'browser') {
		uploadViewMode = mode;
		if (mode === 'browser') {
			browserFolderId = null;
			browserPage = 1;
			// $effect watching these will trigger the loads
		}
	}

	// Watch browser sort/page/limit changes
	let prevBrowserSort = $state<string | undefined>(undefined);
	let prevBrowserOrder = $state<string | undefined>(undefined);
	let prevBrowserLimit = $state<number | undefined>(undefined);
	$effect(() => {
		if (uploadViewMode !== 'browser') return;
		const sf = browserSortField;
		const so = browserSortOrder;
		const bl = browserLimit;
		const pg = browserPage;
		const fid = browserFolderId;
		void pg;
		void fid;
		if (
			prevBrowserSort !== undefined &&
			prevBrowserOrder !== undefined &&
			prevBrowserLimit !== undefined
		) {
			if (prevBrowserSort !== sf || prevBrowserOrder !== so || prevBrowserLimit !== bl) {
				browserPage = 1;
			}
		}
		prevBrowserSort = sf;
		prevBrowserOrder = so;
		prevBrowserLimit = bl;
		loadBrowserFolders();
		loadBrowserUploads();
	});

	// --- Dialogs ---
	let deleteUserOpen = $state(false);
	let deletePostOpen = $state(false);
	let deletePostTarget = $state<{ did: string; localId: string; title: string | null }>({
		did: '',
		localId: '',
		title: null
	});
	let deleteUploadOpen = $state(false);
	let deleteUploadTarget = $state<{ did: string; localId: string; filename: string | null }>({
		did: '',
		localId: '',
		filename: null
	});

	function openDeletePost(post: PostRow) {
		if (!post.did || !post.local_id) {
			toast.error('Cannot delete: missing post identifiers');
			return;
		}
		deletePostTarget = { did: post.did, localId: post.local_id, title: post.title };
		deletePostOpen = true;
	}

	function openDeleteUpload(upload: UploadRow) {
		if (!upload.did || !upload.local_id) {
			toast.error('Cannot delete: missing file identifiers');
			return;
		}
		deleteUploadTarget = {
			did: upload.did,
			localId: upload.local_id,
			filename: upload.filename
		};
		deleteUploadOpen = true;
	}

	// --- Init ---
	$effect(() => {
		if (userId) {
			// Clear all data and close dialogs when switching users
			storage = null;
			instanceOverview = null;
			posts = [];
			postsTotal = 0;
			uploads = [];
			uploadsTotal = 0;
			browserFolders = [];
			browserUploads = [];
			browserBreadcrumbs = [];
			browserTotal = 0;
			deleteUserOpen = false;
			deletePostOpen = false;
			deleteUploadOpen = false;

			// Reset pagination
			postsPage = 1;
			uploadsPage = 1;
			browserFolderId = null;
			browserPage = 1;
			uploadViewMode = 'list';

			loadUser();
			loadStorage();
			loadInstanceOverview();
			loadPosts();
			loadUploads();
		}
	});

	function formatBytes(bytes: number): string {
		if (bytes === 0) return '0 B';
		const k = 1024;
		const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
		const i = Math.floor(Math.log(bytes) / Math.log(k));
		return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
	}

	function formatDate(iso: string): string {
		return new Date(iso).toLocaleDateString(undefined, {
			year: 'numeric',
			month: 'short',
			day: 'numeric'
		});
	}

	function extractLocation(key: string | null): string {
		if (!key) return '/';
		// key format: uploads/{did}/[folder_path/]{ulid}
		const parts = key.split('/');
		// Remove "uploads", DID, and the ULID (last segment)
		if (parts.length <= 3) return '/';
		return '/' + parts.slice(2, -1).join('/');
	}

	const postsTotalPages = $derived(Math.max(1, Math.ceil(postsTotal / 10)));
	const uploadsTotalPages = $derived(Math.max(1, Math.ceil(uploadsTotal / 10)));
</script>

<svelte:head>
	<title>{userInfo?.username ?? 'User'} | Users | Settings | SYR</title>
</svelte:head>

<div class="mx-auto max-w-4xl space-y-6">
	<a href={resolve('/settings/users')} class="text-sm text-muted-foreground hover:text-foreground">
		&larr; Back to users
	</a>

	<!-- User Info -->
	<Card.Root>
		<Card.Header>
			<Card.Title>{userInfo?.display_name ?? 'Loading…'}</Card.Title>
			{#if userInfo}
				<Card.Description>@{userInfo.username}</Card.Description>
			{/if}
		</Card.Header>
		{#if userInfo}
			<Card.Content class="space-y-2 text-sm">
				<div><strong>DID:</strong> <code class="text-xs">{userInfo.did ?? '—'}</code></div>
				<div><strong>Role:</strong> {userInfo.role}</div>
				<div><strong>Created:</strong> {formatDate(userInfo.created_at)}</div>
				{#if userInfo.bio}
					<div><strong>Bio:</strong> {userInfo.bio}</div>
				{/if}
			</Card.Content>
			<Card.Footer>
				<Button variant="destructive" onclick={() => (deleteUserOpen = true)}>
					Delete account
				</Button>
			</Card.Footer>
		{/if}
	</Card.Root>

	<!-- Storage -->
	<Card.Root>
		<Card.Header>
			<Card.Title>Storage</Card.Title>
		</Card.Header>
		<Card.Content class="space-y-4">
			{#if storage}
				<div class="space-y-1">
					<div class="flex justify-between text-sm">
						<span>{formatBytes(storage.bytes_used)} used</span>
						<span>{formatBytes(storage.bytes_limit)} limit</span>
					</div>
					<Progress value={storage.percentage_used} />
					<p class="text-xs text-muted-foreground">
						{formatBytes(storage.bytes_remaining)} remaining
					</p>
				</div>
				{#if instanceOverview && instanceOverview.capacity > 0}
					{@const cap = instanceOverview.capacity}
					{@const thisUserPct = Math.min(100, (storage.bytes_limit / cap) * 100)}
					{@const otherAllocated = instanceOverview.total_allocated - storage.bytes_limit}
					{@const otherPct = Math.min(100, (otherAllocated / cap) * 100)}
					{@const rawAllocated = otherAllocated + storage.bytes_limit}
					<div class="space-y-1 border-t pt-3">
						<p class="text-xs font-medium text-muted-foreground">Instance capacity</p>
						<div class="relative h-3 w-full overflow-hidden rounded-full bg-muted">
							<div
								class="absolute inset-y-0 left-0 rounded-full bg-primary"
								style="width: {thisUserPct}%"
							></div>
							<div
								class="absolute inset-y-0 rounded-full bg-muted-foreground/20"
								style="left: {thisUserPct}%; width: {otherPct}%"
							></div>
						</div>
						<div class="flex items-center gap-3 text-xs text-muted-foreground">
							<span class="flex items-center gap-1">
								<span class="inline-block h-2 w-2 rounded-full bg-primary"></span>
								This user: {formatBytes(storage.bytes_limit)}
							</span>
							<span class="flex items-center gap-1">
								<span class="inline-block h-2 w-2 rounded-full bg-muted-foreground/20"></span>
								Others: {formatBytes(otherAllocated)}
							</span>
							<span>Total: {formatBytes(cap)}</span>
						</div>
						{#if rawAllocated > cap}
							<div class="flex items-center gap-1 text-xs text-destructive">
								<AlertTriangle class="h-3 w-3" />
								Over-allocated
							</div>
						{/if}
					</div>
				{/if}

				<div class="flex flex-wrap gap-2">
					<Input
						type="number"
						min={0.1}
						step={0.1}
						placeholder="GB"
						class="max-w-[8rem]"
						bind:value={customLimitGb}
					/>
					<Button onclick={setStorageLimit} disabled={limitSaving}>Set limit (GB)</Button>
					<Button variant="outline" onclick={resetStorageLimit} disabled={limitSaving}>
						Reset to default
					</Button>
				</div>
				<div class="flex items-center gap-3 border-t pt-3">
					<span class="text-sm font-medium">File uploads</span>
					<Button
						variant={storage.uploads_enabled ? 'default' : 'destructive'}
						size="sm"
						onclick={toggleUploads}
						disabled={toggleSaving}
					>
						{storage.uploads_enabled ? 'Enabled' : 'Disabled'}
					</Button>
					{#if !storage.uploads_enabled}
						<span class="text-xs text-muted-foreground">User cannot upload files</span>
					{/if}
				</div>
			{:else if storageLoading}
				<p class="text-sm text-muted-foreground">Loading…</p>
			{/if}
		</Card.Content>
	</Card.Root>

	<!-- Posts -->
	<Card.Root>
		<Card.Header>
			<Card.Title>Posts ({postsTotal})</Card.Title>
		</Card.Header>
		<Card.Content>
			<Table.Root>
				<Table.Header>
					<Table.Row>
						<Table.Head>Title / Type</Table.Head>
						<Table.Head>Visibility</Table.Head>
						<Table.Head>Status</Table.Head>
						<Table.Head>Created</Table.Head>
						<Table.Head class="text-right">Actions</Table.Head>
					</Table.Row>
				</Table.Header>
				<Table.Body>
					{#if postsLoading}
						<Table.Row>
							<Table.Cell colspan={5} class="py-4 text-center text-muted-foreground">
								Loading…
							</Table.Cell>
						</Table.Row>
					{:else if posts.length === 0}
						<Table.Row>
							<Table.Cell colspan={5} class="py-4 text-center text-muted-foreground">
								No posts.
							</Table.Cell>
						</Table.Row>
					{:else}
						{#each posts as post (post.id)}
							<Table.Row>
								<Table.Cell>{post.title || post.type}</Table.Cell>
								<Table.Cell class="text-xs">{post.visibility}</Table.Cell>
								<Table.Cell class="text-xs">{post.status}</Table.Cell>
								<Table.Cell class="text-xs text-muted-foreground">
									{formatDate(post.created_at)}
								</Table.Cell>
								<Table.Cell class="text-right">
									<div class="flex items-center justify-end gap-1">
										{#if post.did && post.local_id}
											<a
												href={resolve(`/posts/${post.did}/${post.local_id}`)}
												target="_blank"
												rel="noopener"
												class="inline-flex h-8 items-center rounded-md border border-input bg-background px-2.5 text-xs font-medium shadow-xs hover:bg-accent hover:text-accent-foreground"
											>
												<ExternalLink class="mr-1 h-3 w-3" />
												View
											</a>
										{/if}
										<Button variant="destructive" size="sm" onclick={() => openDeletePost(post)}>
											Delete
										</Button>
									</div>
								</Table.Cell>
							</Table.Row>
						{/each}
					{/if}
				</Table.Body>
			</Table.Root>
			{#if postsTotalPages > 1}
				<div class="mt-2 flex items-center justify-end gap-2">
					<Button
						variant="outline"
						size="sm"
						disabled={postsPage <= 1}
						onclick={() => {
							postsPage--;
							loadPosts();
						}}>Prev</Button
					>
					<span class="text-xs text-muted-foreground">{postsPage} / {postsTotalPages}</span>
					<Button
						variant="outline"
						size="sm"
						disabled={postsPage >= postsTotalPages}
						onclick={() => {
							postsPage++;
							loadPosts();
						}}>Next</Button
					>
				</div>
			{/if}
		</Card.Content>
	</Card.Root>

	<!-- Uploads -->
	<Card.Root>
		<Card.Header>
			<div class="flex items-center justify-between">
				<Card.Title>Uploads ({uploadsTotal})</Card.Title>
				<div class="flex gap-1">
					<Button
						variant={uploadViewMode === 'list' ? 'default' : 'outline'}
						size="sm"
						onclick={() => switchUploadView('list')}
					>
						<List class="mr-1 h-3.5 w-3.5" />
						List
					</Button>
					<Button
						variant={uploadViewMode === 'browser' ? 'default' : 'outline'}
						size="sm"
						onclick={() => switchUploadView('browser')}
					>
						<FolderOpen class="mr-1 h-3.5 w-3.5" />
						Browser
					</Button>
				</div>
			</div>
		</Card.Header>
		<Card.Content>
			{#if uploadViewMode === 'list'}
				<!-- Flat list view with location column -->
				<Table.Root>
					<Table.Header>
						<Table.Row>
							<Table.Head>Filename</Table.Head>
							<Table.Head>Location</Table.Head>
							<Table.Head>Size</Table.Head>
							<Table.Head>Status</Table.Head>
							<Table.Head>Public</Table.Head>
							<Table.Head>Created</Table.Head>
							<Table.Head class="text-right">Actions</Table.Head>
						</Table.Row>
					</Table.Header>
					<Table.Body>
						{#if uploadsLoading}
							<Table.Row>
								<Table.Cell colspan={7} class="py-4 text-center text-muted-foreground"
									>Loading…</Table.Cell
								>
							</Table.Row>
						{:else if uploads.length === 0}
							<Table.Row>
								<Table.Cell colspan={7} class="py-4 text-center text-muted-foreground"
									>No uploads.</Table.Cell
								>
							</Table.Row>
						{:else}
							{#each uploads as upload (upload.id)}
								<Table.Row>
									<Table.Cell class="max-w-[200px] truncate text-sm">{upload.filename}</Table.Cell>
									<Table.Cell class="max-w-[150px] truncate font-mono text-xs text-muted-foreground"
										>{extractLocation(upload.key)}</Table.Cell
									>
									<Table.Cell class="text-xs">{formatBytes(upload.size)}</Table.Cell>
									<Table.Cell class="text-xs">{upload.status}</Table.Cell>
									<Table.Cell class="text-xs">{upload.is_public ? 'Yes' : 'No'}</Table.Cell>
									<Table.Cell class="text-xs text-muted-foreground"
										>{formatDate(upload.created_at)}</Table.Cell
									>
									<Table.Cell class="text-right">
										<div class="flex items-center justify-end gap-1">
											{#if upload.url && upload.status === 'completed'}
												<a
													href={upload.url}
													target="_blank"
													rel="noopener"
													class="inline-flex h-8 items-center rounded-md border border-input bg-background px-2.5 text-xs font-medium shadow-xs hover:bg-accent hover:text-accent-foreground"
												>
													<ExternalLink class="mr-1 h-3 w-3" />
													View
												</a>
											{/if}
											<Button
												variant="destructive"
												size="sm"
												onclick={() => openDeleteUpload(upload)}>Delete</Button
											>
										</div>
									</Table.Cell>
								</Table.Row>
							{/each}
						{/if}
					</Table.Body>
				</Table.Root>
				{#if uploadsTotalPages > 1}
					<div class="mt-2 flex items-center justify-end gap-2">
						<Button
							variant="outline"
							size="sm"
							disabled={uploadsPage <= 1}
							onclick={() => {
								uploadsPage--;
								loadUploads();
							}}>Prev</Button
						>
						<span class="text-xs text-muted-foreground">{uploadsPage} / {uploadsTotalPages}</span>
						<Button
							variant="outline"
							size="sm"
							disabled={uploadsPage >= uploadsTotalPages}
							onclick={() => {
								uploadsPage++;
								loadUploads();
							}}>Next</Button
						>
					</div>
				{/if}
			{:else}
				<FileBrowser
					folders={browserFolders}
					uploads={browserUploads}
					breadcrumbs={browserBreadcrumbs}
					loading={browserLoading}
					total={browserTotal}
					bind:viewMode={browserViewMode}
					bind:currentPage={browserPage}
					bind:limit={browserLimit}
					bind:sortField={browserSortField}
					bind:sortOrder={browserSortOrder}
					readonly
					onNavigateFolder={navigateFolder}
					onDeleteUpload={handleBrowserDelete}
				/>
			{/if}
		</Card.Content>
	</Card.Root>
</div>

<AdminDeleteUserDialog
	bind:open={deleteUserOpen}
	{userId}
	username={userInfo?.username}
	onSuccess={() => goto(resolve('/settings/users'))}
/>

<AdminDeletePostDialog
	bind:open={deletePostOpen}
	{userId}
	postDid={deletePostTarget.did}
	postLocalId={deletePostTarget.localId}
	postTitle={deletePostTarget.title}
	onSuccess={() => loadPosts()}
/>

<AdminDeleteUploadDialog
	bind:open={deleteUploadOpen}
	{userId}
	uploadDid={deleteUploadTarget.did}
	uploadLocalId={deleteUploadTarget.localId}
	filename={deleteUploadTarget.filename}
	onSuccess={() => {
		loadUploads();
		loadStorage();
		if (uploadViewMode === 'browser') {
			loadBrowserFolders();
			loadBrowserUploads();
		}
	}}
/>
