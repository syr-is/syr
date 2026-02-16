<script lang="ts">
	import * as Card from '$lib/components/ui/card';
	import * as Select from '$lib/components/ui/select';
	import * as Pagination from '$lib/components/ui/pagination';
	import { Button } from '$lib/components/ui/button';
	import { Skeleton } from '$lib/components/ui/skeleton';
	import type { Upload, Folder } from '@syr-is/types';
	import { replaceState } from '$app/navigation';
	import { page } from '$app/stores';

	// Dialog components
	import DeleteUploadDialog from '$lib/components/fragments/delete-upload-dialog.svelte';
	import UploadFilesDialog from '$lib/components/fragments/upload-files-dialog.svelte';
	import CreateFolderDialog from '$lib/components/fragments/create-folder-dialog.svelte';
	import DeleteFolderDialog from '$lib/components/fragments/delete-folder-dialog.svelte';
	import MoveUploadDialog from '$lib/components/fragments/move-upload-dialog.svelte';
	import RenameUploadDialog from '$lib/components/fragments/rename-upload-dialog.svelte';
	import ShareUploadDialog from '$lib/components/fragments/share-upload-dialog.svelte';
	import MediaPreviewModal from '$lib/components/fragments/media-preview-modal.svelte';
	import { toast } from 'svelte-sonner';
	import { Plus, FolderPlus, ChevronRight, Home, File } from 'lucide-svelte';

	// Shared view components
	import ViewModeToggle from '$lib/components/fragments/view-mode-toggle.svelte';
	import FileTable from '$lib/components/fragments/file-table.svelte';
	import FileGrid from '$lib/components/fragments/file-grid.svelte';
	import FileCarousel from '$lib/components/fragments/file-carousel.svelte';
	import FolderCard from '$lib/components/fragments/folder-card.svelte';
	import {
		type ViewMode,
		type DisplayItem,
		uploadsToDisplayItems,
		getFileItems
	} from '$lib/types/display-item';

	let { data } = $props();

	// View mode state
	let viewMode = $state<ViewMode>('list');

	// Uploads state
	let uploads = $state<Upload[]>([]);
	let folders = $state<Folder[]>([]);
	let loading = $state(false);
	let error = $state<string | null>(null);

	// Current folder state - initialize from server data
	let currentFolderId = $state<string | null>(data.initialFolderId ?? null);
	let breadcrumbs = $state<Array<{ id: string; name: string }>>([]);

	// Show toast if path was invalid
	$effect(() => {
		if (data.invalidPath) {
			toast.error('Folder not found or access denied. Redirected to root.');
			// Clear the invalid path from URL (same page, just clearing query param)
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
	let uploadToDelete = $state<Upload | null>(null);

	let deleteFolderDialogOpen = $state(false);
	let folderToDelete = $state<Folder | null>(null);

	let uploadDialogOpen = $state(false);

	let createFolderDialogOpen = $state(false);

	let moveDialogOpen = $state(false);
	let uploadToMove = $state<Upload | null>(null);

	let renameDialogOpen = $state(false);
	let uploadToRename = $state<Upload | null>(null);

	let shareDialogOpen = $state(false);
	let uploadToShare = $state<Upload | null>(null);

	// Media preview modal for visual browsing (gallery/masonry modes)
	let mediaPreviewOpen = $state(false);
	let mediaPreviewIndex = $state(0);

	// Computed DisplayItems for shared components
	const displayItems = $derived(uploadsToDisplayItems(folders, uploads));
	const fileDisplayItems = $derived(getFileItems(displayItems));

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
				const errorData = await response.json();
				// If folder not found or access denied, reset to root
				if (response.status === 404 || response.status === 403 || response.status === 400) {
					if (currentFolderId) {
						toast.error('Folder not found or access denied. Redirected to root.');
						currentFolderId = null;
						updateUrlPath(null);
						return;
					}
				}
				throw new Error(errorData.error?.message || 'Failed to fetch folders');
			}

			const result = await response.json();
			folders = result.data?.folders || [];
			breadcrumbs = result.data?.breadcrumbs || [];
		} catch (err) {
			console.error('Failed to fetch folders:', err);
			// If there was an error and we're in a folder, try resetting to root
			if (currentFolderId) {
				toast.error('Failed to load folder. Redirected to root.');
				currentFolderId = null;
				updateUrlPath(null);
				return;
			}
			folders = [];
		}
	}

	// Fetch uploads function
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

			// Add folder filter - empty string means root level only
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

	// Refresh data after successful operations
	function refreshData() {
		fetchFolders();
		fetchUploads();
	}

	// Navigate to folder and update URL
	function navigateToFolder(folderId: string | null) {
		currentFolderId = folderId;
		currentPage = 1;
		updateUrlPath(folderId);
	}

	// Update URL with current folder path (same page, just updating query param)
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

	// Open delete dialogs
	function openDeleteUploadDialog(upload: Upload) {
		uploadToDelete = upload;
		deleteUploadDialogOpen = true;
	}

	function openDeleteFolderDialog(folder: Folder) {
		folderToDelete = folder;
		deleteFolderDialogOpen = true;
	}

	// Download file
	async function downloadFile(upload: Upload) {
		try {
			const uploadId = typeof upload.id === 'string' ? upload.id : upload.id.toString();
			const response = await fetch(`/api/uploads/${uploadId}`);
			if (!response.ok) {
				throw new Error('Failed to get download URL');
			}

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

	// Copy link to clipboard - fetches current public status before deciding
	async function copyLink(upload: Upload) {
		if (!upload.url) {
			toast.error('URL not available');
			return;
		}

		try {
			const uploadId = typeof upload.id === 'string' ? upload.id : upload.id.toString();
			const response = await fetch(`/api/uploads/${uploadId}`);
			if (!response.ok) {
				throw new Error('Failed to get upload info');
			}

			const result = await response.json();
			const isPublic = result.data?.isPublic ?? upload.is_public;
			const downloadUrl = result.data?.downloadUrl;

			if (isPublic && downloadUrl) {
				await navigator.clipboard.writeText(downloadUrl);
				toast.success('Link copied to clipboard');
				return;
			}

			// For private files, open share dialog
			openShareDialog(upload);
		} catch {
			if (upload.is_public) {
				try {
					await navigator.clipboard.writeText(upload.url);
					toast.success('Link copied to clipboard');
				} catch {
					toast.error('Failed to copy link');
				}
			} else {
				openShareDialog(upload);
			}
		}
	}

	// Open dialogs
	function openMoveDialog(upload: Upload) {
		uploadToMove = upload;
		moveDialogOpen = true;
	}

	function openRenameDialog(upload: Upload) {
		uploadToRename = upload;
		renameDialogOpen = true;
	}

	function openShareDialog(upload: Upload) {
		uploadToShare = upload;
		shareDialogOpen = true;
	}

	// Callbacks that adapt DisplayItem events to Upload-specific logic
	function handleTablePreview(item: DisplayItem) {
		if (item.kind !== 'file') return;
		const index = fileDisplayItems.findIndex((di) => di.id === item.id);
		if (index >= 0) {
			mediaPreviewIndex = index;
			mediaPreviewOpen = true;
		}
	}

	function handleTableDownload(item: DisplayItem) {
		if (item.kind === 'file') downloadFile(item.data);
	}

	function handleTableCopyLink(item: DisplayItem) {
		if (item.kind === 'file') copyLink(item.data);
	}

	function handleTableRename(item: DisplayItem) {
		if (item.kind === 'file') openRenameDialog(item.data);
	}

	function handleTableMove(item: DisplayItem) {
		if (item.kind === 'file') openMoveDialog(item.data);
	}

	function handleTableDelete(item: DisplayItem) {
		if (item.kind === 'file') openDeleteUploadDialog(item.data);
	}

	function handleGridFolderClick(folder: Folder) {
		navigateToFolder(typeof folder.id === 'string' ? folder.id : folder.id.toString());
	}

	function handleGridFolderDelete(folder: Folder) {
		openDeleteFolderDialog(folder);
	}

	function handleGridItemClick(index: number) {
		mediaPreviewIndex = index;
		mediaPreviewOpen = true;
	}

	// Track previous sort values
	let prevSortField = $state<string | undefined>(undefined);
	let prevSortOrder = $state<string | undefined>(undefined);

	$effect(() => {
		if (prevSortField === undefined) {
			prevSortField = sortField;
		}
		if (prevSortOrder === undefined) {
			prevSortOrder = sortOrder;
		}
	});

	// Watch for changes and refetch
	$effect(() => {
		if (!data.user) return;

		const currentSortField = sortField;
		const currentSortOrder = sortOrder;
		const currentPageValue = currentPage;
		const currentFolder = currentFolderId;

		// Reset to first page when sorting changes
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

	// Calculate total pages
	const totalPages = $derived(Math.ceil(total / limit));

	// Sort field labels
	function getSortFieldLabel(field: string): string {
		if (field === 'created_at') return 'Created';
		if (field === 'updated_at') return 'Updated';
		if (field === 'filename') return 'Filename';
		if (field === 'size') return 'Size';
		return field;
	}

	function getSortOrderLabel(order: string): string {
		return order === 'asc' ? 'Ascending' : 'Descending';
	}

	// Check if folder is a public folder
	function isPublicFolder(folder: Folder): boolean {
		return folder.name.toLowerCase() === 'public';
	}

	// Check if currently in a public folder hierarchy
	const isInPublicFolder = $derived(breadcrumbs.some((b) => b.name.toLowerCase() === 'public'));
</script>

<svelte:head>
	<title>Uploads | SYR</title>
</svelte:head>

{#if data.user}
	<div class="space-y-6 p-4 sm:p-6 lg:p-8">
		<!-- Page Header -->
		<div class="flex items-start justify-between gap-4">
			<div class="space-y-1">
				<h1 class="text-3xl font-bold tracking-tight">Uploads</h1>
				<p class="text-muted-foreground">Manage your uploaded files and folders</p>
			</div>
		</div>

		<!-- Breadcrumb Navigation -->
		<nav class="flex min-w-0 flex-nowrap items-center gap-1 overflow-x-auto text-sm">
			<Button
				variant="ghost"
				size="sm"
				class="h-8 gap-1 px-2"
				onclick={() => navigateToFolder(null)}
			>
				<Home class="h-4 w-4" />
				<span>Root</span>
			</Button>
			{#each breadcrumbs as crumb (crumb.id)}
				<ChevronRight class="h-4 w-4 text-muted-foreground" />
				<Button
					variant="ghost"
					size="sm"
					class="h-8 px-2"
					onclick={() => navigateToFolder(crumb.id)}
				>
					{crumb.name}
				</Button>
			{/each}
		</nav>

		<!-- Controls Row -->
		<div class="flex flex-wrap items-center justify-between gap-4">
			<div class="flex flex-wrap items-center gap-2">
				<Select.Root type="single" bind:value={sortField}>
					<Select.Trigger class="w-[140px]">
						{getSortFieldLabel(sortField)}
					</Select.Trigger>
					<Select.Content>
						<Select.Item value="created_at">Created</Select.Item>
						<Select.Item value="updated_at">Updated</Select.Item>
						<Select.Item value="filename">Filename</Select.Item>
						<Select.Item value="size">Size</Select.Item>
					</Select.Content>
				</Select.Root>

				<Select.Root type="single" bind:value={sortOrder}>
					<Select.Trigger class="w-[140px]">
						{getSortOrderLabel(sortOrder)}
					</Select.Trigger>
					<Select.Content>
						<Select.Item value="desc">Descending</Select.Item>
						<Select.Item value="asc">Ascending</Select.Item>
					</Select.Content>
				</Select.Root>

				{#if totalPages > 1}
					<Pagination.Root bind:page={currentPage} count={total} perPage={limit} siblingCount={1}>
						{#snippet children({ pages, currentPage: activePage })}
							<Pagination.Content>
								<Pagination.Item>
									<Pagination.PrevButton />
								</Pagination.Item>
								{#each pages as page (page.key)}
									{#if page.type === 'ellipsis'}
										<Pagination.Item>
											<Pagination.Ellipsis />
										</Pagination.Item>
									{:else}
										<Pagination.Item>
											<Pagination.Link {page} isActive={activePage === page.value}>
												{page.value}
											</Pagination.Link>
										</Pagination.Item>
									{/if}
								{/each}
								<Pagination.Item>
									<Pagination.NextButton />
								</Pagination.Item>
							</Pagination.Content>
						{/snippet}
					</Pagination.Root>
				{/if}
			</div>
			<div class="flex flex-wrap items-center gap-2">
				<ViewModeToggle
					bind:mode={viewMode}
					availableModes={['list', 'gallery', 'masonry', 'carousel']}
				/>
				<span class="text-sm text-muted-foreground">
					{total} file{total !== 1 ? 's' : ''} total
				</span>
				<Button variant="outline" onclick={() => (createFolderDialogOpen = true)}>
					<FolderPlus class="mr-2 h-4 w-4" />
					New Folder
				</Button>
				<Button onclick={() => (uploadDialogOpen = true)}>
					<Plus class="mr-2 h-4 w-4" />
					Upload File
				</Button>
			</div>
		</div>

		<!-- Content Area -->
		{#if loading}
			<Card.Root>
				<Card.Content class="py-12">
					<div class="flex flex-col items-center gap-2">
						<Skeleton class="h-8 w-48" />
						<Skeleton class="h-4 w-32" />
					</div>
				</Card.Content>
			</Card.Root>
		{:else if error}
			<Card.Root>
				<Card.Content class="py-6">
					<p class="text-center text-destructive">{error}</p>
				</Card.Content>
			</Card.Root>
		{:else if uploads.length === 0 && folders.length === 0}
			<Card.Root>
				<Card.Content class="py-12">
					<div class="space-y-2 text-center">
						<File class="mx-auto h-12 w-12 text-muted-foreground" />
						<h3 class="text-lg font-semibold">No files or folders</h3>
						<p class="text-sm text-muted-foreground">
							{currentFolderId ? 'This folder is empty' : 'Your uploaded files will appear here'}
						</p>
					</div>
				</Card.Content>
			</Card.Root>
		{:else if viewMode === 'list'}
			<!-- List/Table view -->
			<FileTable
				items={displayItems}
				onPreview={handleTablePreview}
				onDownload={handleTableDownload}
				onCopyLink={handleTableCopyLink}
				onRename={handleTableRename}
				onMove={handleTableMove}
				onDelete={handleTableDelete}
				onFolderClick={handleGridFolderClick}
				onFolderDelete={handleGridFolderDelete}
			/>
		{:else if viewMode === 'carousel'}
			<!-- Carousel view: folders shown above as cards, then carousel for files -->
			{#if folders.length > 0}
				<div class="mb-4 grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
					{#each folders as folder (folder.id.toString())}
						<FolderCard
							{folder}
							isPublic={isPublicFolder(folder)}
							onclick={() => handleGridFolderClick(folder)}
							onDelete={handleGridFolderDelete}
						/>
					{/each}
				</div>
			{/if}
			<FileCarousel items={fileDisplayItems} onItemClick={handleGridItemClick} />
		{:else}
			<!-- Gallery or Masonry view -->
			<FileGrid
				items={displayItems}
				mode={viewMode === 'gallery' ? 'gallery' : 'masonry'}
				onItemClick={handleGridItemClick}
				onFolderClick={handleGridFolderClick}
				onFolderDelete={handleGridFolderDelete}
			/>
		{/if}
	</div>

	<!-- Dialog Components -->
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

	<!-- Media preview modal for visual browsing -->
	<MediaPreviewModal
		bind:open={mediaPreviewOpen}
		items={fileDisplayItems}
		initialIndex={mediaPreviewIndex}
		onOpenShareDialog={openShareDialog}
	/>
{:else}
	<!-- Not Logged In View -->
	<div class="flex h-full items-center justify-center p-4 sm:p-6">
		<Card.Root class="max-w-md">
			<Card.Header>
				<Card.Title>Sign in required</Card.Title>
				<Card.Description>You need to be logged in to manage your uploads.</Card.Description>
			</Card.Header>
		</Card.Root>
	</div>
{/if}
