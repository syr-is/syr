<script lang="ts">
	import * as Card from '@syr-is/ui/card';
	import { Button } from '@syr-is/ui/button';
	import { getUploadApiUrl, type UploadWithCompositeId, type Folder } from '@syr-is/types';
	import { replaceState } from '$app/navigation';
	import { page } from '$app/stores';

	import DeleteUploadDialog from '$lib/components/fragments/delete-upload-dialog.svelte';
	import UploadFilesDialog from '$lib/components/fragments/upload-files-dialog.svelte';
	import CreateFolderDialog from '$lib/components/fragments/create-folder-dialog.svelte';
	import DeleteFolderDialog from '$lib/components/fragments/delete-folder-dialog.svelte';
	import MoveUploadDialog from '$lib/components/fragments/move-upload-dialog.svelte';
	import RenameUploadDialog from '$lib/components/fragments/rename-upload-dialog.svelte';
	import ShareUploadDialog from '$lib/components/fragments/share-upload-dialog.svelte';
	import MediaPreviewModal from '$lib/components/fragments/media-preview-modal.svelte';
	import FileBrowser from '$lib/components/fragments/file-browser.svelte';
	import { toast } from 'svelte-sonner';
	import { Plus, FolderPlus } from 'lucide-svelte';

	import type { ViewMode, DisplayItem } from '$lib/types/display-item';
	import { getFileItems, uploadsToDisplayItems } from '$lib/types/display-item';

	let { data } = $props();

	// View mode state
	let viewMode = $state<ViewMode>('list');

	// Uploads state
	let uploads = $state<UploadWithCompositeId[]>([]);
	let folders = $state<Folder[]>([]);
	let loading = $state(false);
	let error = $state<string | null>(null);

	// Current folder state
	// eslint-disable-next-line svelte/prefer-writable-derived -- need writable for folder navigation
	let currentFolderId = $state<string | null>(null);
	let breadcrumbs = $state<Array<{ id: string; name: string }>>([]);
	$effect(() => {
		currentFolderId = data.initialFolderId ?? null;
	});

	$effect(() => {
		if (data.invalidPath) {
			toast.error('Folder not found or access denied. Redirected to root.');
			// eslint-disable-next-line svelte/no-navigation-without-resolve
			replaceState($page.url.pathname, {});
		}
	});

	// Pagination state
	let currentPage = $state(1);
	let limit = $state(20);
	let total = $state(0);

	// Sorting state
	let sortField = $state<'created_at' | 'updated_at' | 'filename' | 'size'>('created_at');
	let sortOrder = $state<'asc' | 'desc'>('desc');

	// Dialog states
	let deleteUploadDialogOpen = $state(false);
	let uploadToDelete = $state<UploadWithCompositeId | null>(null);
	let deleteFolderDialogOpen = $state(false);
	let folderToDelete = $state<Folder | null>(null);
	let uploadDialogOpen = $state(false);
	let createFolderDialogOpen = $state(false);
	let moveDialogOpen = $state(false);
	let uploadToMove = $state<UploadWithCompositeId | null>(null);
	let renameDialogOpen = $state(false);
	let uploadToRename = $state<UploadWithCompositeId | null>(null);
	let shareDialogOpen = $state(false);
	let uploadToShare = $state<UploadWithCompositeId | null>(null);
	let mediaPreviewOpen = $state(false);
	let mediaPreviewIndex = $state(0);

	const fileDisplayItems = $derived(getFileItems(uploadsToDisplayItems(folders, uploads)));

	const isInPublicFolder = $derived(breadcrumbs.some((b) => b.name.toLowerCase() === 'public'));

	// Fetch folders
	async function fetchFolders() {
		if (!data.user) return;
		try {
			let queryString = '';
			if (currentFolderId) {
				queryString = `?parent_id=${encodeURIComponent(currentFolderId)}`;
			}
			const response = await fetch(`/api/folders${queryString}`);
			if (!response.ok) {
				if (response.status === 404 || response.status === 403 || response.status === 400) {
					if (currentFolderId) {
						toast.error('Folder not found or access denied. Redirected to root.');
						currentFolderId = null;
						updateUrlPath(null);
						return;
					}
				}
				const errorData = await response.json();
				throw new Error(errorData.error?.message || 'Failed to fetch folders');
			}
			const result = await response.json();
			folders = result.data?.folders || [];
			breadcrumbs = result.data?.breadcrumbs || [];
		} catch (err) {
			console.error('Failed to fetch folders:', err);
			if (currentFolderId) {
				toast.error('Failed to load folder. Redirected to root.');
				currentFolderId = null;
				updateUrlPath(null);
				return;
			}
			folders = [];
		}
	}

	// Fetch uploads
	async function fetchUploads() {
		if (!data.user) return;
		loading = true;
		error = null;
		try {
			const offset = (currentPage - 1) * limit;
			const queryParts = [
				`limit=${limit}`,
				`offset=${offset}`,
				`sort_field=${encodeURIComponent(sortField)}`,
				`sort_order=${encodeURIComponent(sortOrder)}`
			];
			if (currentFolderId === null) {
				queryParts.push('folder_id=');
			} else {
				queryParts.push(`folder_id=${encodeURIComponent(currentFolderId)}`);
			}
			const response = await fetch(`/api/uploads?${queryParts.join('&')}`);
			if (!response.ok) {
				const errorData = await response.json();
				throw new Error(errorData.error?.message || 'Failed to fetch uploads');
			}
			const result = await response.json();
			uploads = result.data || [];
			total = result.pagination?.total || 0;
		} catch (err) {
			error = err instanceof Error ? err.message : 'An unexpected error occurred';
			uploads = [];
		} finally {
			loading = false;
		}
	}

	function refreshData() {
		fetchFolders();
		fetchUploads();
	}

	function navigateToFolder(folderId: string | null) {
		currentFolderId = folderId;
		currentPage = 1;
		updateUrlPath(folderId);
	}

	function updateUrlPath(folderId: string | null) {
		const url = new URL($page.url);
		if (folderId) {
			url.searchParams.set('path', folderId);
		} else {
			url.searchParams.delete('path');
		}
		// eslint-disable-next-line svelte/no-navigation-without-resolve
		replaceState(`${url.pathname}${url.search}`, {});
	}

	// Action handlers
	function handleDeleteUpload(upload: UploadWithCompositeId) {
		uploadToDelete = upload;
		deleteUploadDialogOpen = true;
	}

	function handleDeleteFolder(folder: Folder) {
		folderToDelete = folder;
		deleteFolderDialogOpen = true;
	}

	async function handleDownload(upload: UploadWithCompositeId) {
		if (!upload.did || !upload.local_id) {
			toast.error('Download not available for this file');
			return;
		}
		try {
			const response = await fetch(getUploadApiUrl(upload));
			if (!response.ok) throw new Error('Failed to get download URL');
			const result = await response.json();
			const downloadUrl = result.data?.downloadUrl;
			if (downloadUrl) {
				window.open(downloadUrl, '_blank');
			} else {
				toast.error('Download URL not available');
			}
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Failed to download file');
		}
	}

	async function handleCopyLink(upload: UploadWithCompositeId) {
		if (!upload.did || !upload.local_id) {
			toast.error('Link not available for this file');
			return;
		}
		try {
			const response = await fetch(getUploadApiUrl(upload));
			if (!response.ok) throw new Error('Failed to get upload info');
			const result = await response.json();
			const isPublic = result.data?.isPublic ?? upload.is_public;
			const downloadUrl = result.data?.downloadUrl;
			if (isPublic && downloadUrl) {
				await navigator.clipboard.writeText(downloadUrl);
				toast.success('Link copied to clipboard');
				return;
			}
			uploadToShare = upload;
			shareDialogOpen = true;
		} catch {
			if (upload.is_public && upload.url) {
				try {
					await navigator.clipboard.writeText(upload.url);
					toast.success('Link copied to clipboard');
				} catch {
					toast.error('Failed to copy link');
				}
			} else {
				uploadToShare = upload;
				shareDialogOpen = true;
			}
		}
	}

	function handleRename(upload: UploadWithCompositeId) {
		uploadToRename = upload;
		renameDialogOpen = true;
	}

	function handleMove(upload: UploadWithCompositeId) {
		uploadToMove = upload;
		moveDialogOpen = true;
	}

	function handlePreview(_item: DisplayItem, index: number) {
		mediaPreviewIndex = index;
		mediaPreviewOpen = true;
	}

	// Track previous sort values for reset-on-change
	let prevSortField = $state<string | undefined>(undefined);
	let prevSortOrder = $state<string | undefined>(undefined);

	$effect(() => {
		if (prevSortField === undefined) prevSortField = sortField;
		if (prevSortOrder === undefined) prevSortOrder = sortOrder;
	});

	$effect(() => {
		if (!data.user) return;
		const currentSortField = sortField;
		const currentSortOrder = sortOrder;
		const currentPageValue = currentPage;
		const currentFolder = currentFolderId;

		if (prevSortField !== undefined && prevSortOrder !== undefined) {
			if (prevSortField !== currentSortField || prevSortOrder !== currentSortOrder) {
				currentPage = 1;
			}
		}
		prevSortField = currentSortField;
		prevSortOrder = currentSortOrder;

		void currentPageValue;
		void currentSortField;
		void currentSortOrder;
		void currentFolder;

		fetchFolders();
		fetchUploads();
	});
</script>

<svelte:head>
	<title>Uploads | SYR</title>
</svelte:head>

{#if data.user}
	<div class="space-y-6 p-4 sm:p-6 lg:p-8">
		<div class="flex items-start justify-between gap-4">
			<div class="space-y-1">
				<h1 class="text-3xl font-bold tracking-tight">Uploads</h1>
				<p class="text-muted-foreground">Manage your uploaded files and folders</p>
			</div>
		</div>

		<FileBrowser
			{folders}
			{uploads}
			{breadcrumbs}
			{loading}
			{error}
			{total}
			bind:viewMode
			bind:currentPage
			bind:limit
			bind:sortField
			bind:sortOrder
			onNavigateFolder={navigateToFolder}
			onDeleteUpload={handleDeleteUpload}
			onDeleteFolder={handleDeleteFolder}
			onPreview={handlePreview}
			onDownload={handleDownload}
			onCopyLink={handleCopyLink}
			onRename={handleRename}
			onMove={handleMove}
		>
			{#snippet actions()}
				<Button variant="outline" onclick={() => (createFolderDialogOpen = true)}>
					<FolderPlus class="mr-2 h-4 w-4" />
					New Folder
				</Button>
				<Button onclick={() => (uploadDialogOpen = true)}>
					<Plus class="mr-2 h-4 w-4" />
					Upload File
				</Button>
			{/snippet}
		</FileBrowser>
	</div>

	<DeleteUploadDialog
		upload={uploadToDelete}
		bind:open={deleteUploadDialogOpen}
		onSuccess={refreshData}
	/>
	<DeleteFolderDialog
		folderId={folderToDelete?.id?.toString() ?? null}
		folderName={folderToDelete?.name ?? null}
		bind:open={deleteFolderDialogOpen}
		onSuccess={refreshData}
	/>
	<UploadFilesDialog
		{currentFolderId}
		{isInPublicFolder}
		bind:open={uploadDialogOpen}
		onSuccess={refreshData}
	/>
	<CreateFolderDialog
		parentId={currentFolderId}
		parentName={breadcrumbs.length > 0 ? breadcrumbs[breadcrumbs.length - 1]?.name : null}
		bind:open={createFolderDialogOpen}
		onSuccess={refreshData}
	/>
	<MoveUploadDialog upload={uploadToMove} bind:open={moveDialogOpen} onSuccess={refreshData} />
	<RenameUploadDialog
		upload={uploadToRename}
		bind:open={renameDialogOpen}
		onSuccess={refreshData}
	/>
	<ShareUploadDialog upload={uploadToShare} bind:open={shareDialogOpen} />
	<MediaPreviewModal
		bind:open={mediaPreviewOpen}
		items={fileDisplayItems}
		initialIndex={mediaPreviewIndex}
		onOpenShareDialog={(upload) => {
			uploadToShare = upload;
			shareDialogOpen = true;
		}}
	/>
{:else}
	<div class="flex h-full items-center justify-center p-4 sm:p-6">
		<Card.Root class="max-w-md">
			<Card.Header>
				<Card.Title>Sign in required</Card.Title>
				<Card.Description>You need to be logged in to manage your uploads.</Card.Description>
			</Card.Header>
		</Card.Root>
	</div>
{/if}
