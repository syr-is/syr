<script lang="ts">
	import * as Card from '$lib/components/ui/card';
	import * as Select from '$lib/components/ui/select';
	import * as Pagination from '$lib/components/ui/pagination';
	import * as Table from '$lib/components/ui/table';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
	import { Button } from '$lib/components/ui/button';
	import { Skeleton } from '$lib/components/ui/skeleton';
	import { Badge } from '$lib/components/ui/badge';
	import type { Upload, Folder } from '@syr-is/types';
	import { replaceState } from '$app/navigation';
	import { page } from '$app/stores';

	// Dialog components
	import DeleteUploadDialog from '$lib/components/fragments/delete-upload-dialog.svelte';
	import PreviewUploadDialog from '$lib/components/fragments/preview-upload-dialog.svelte';
	import UploadFilesDialog from '$lib/components/fragments/upload-files-dialog.svelte';
	import CreateFolderDialog from '$lib/components/fragments/create-folder-dialog.svelte';
	import DeleteFolderDialog from '$lib/components/fragments/delete-folder-dialog.svelte';
	import MoveUploadDialog from '$lib/components/fragments/move-upload-dialog.svelte';
	import RenameUploadDialog from '$lib/components/fragments/rename-upload-dialog.svelte';
	import ShareUploadDialog from '$lib/components/fragments/share-upload-dialog.svelte';
	import { toast } from 'svelte-sonner';
	import {
		Download,
		Trash2,
		FileImage,
		FileText,
		FileVideo,
		FileAudio,
		File,
		Eye,
		Link,
		Plus,
		FolderIcon,
		FolderPlus,
		ChevronRight,
		Home,
		MoreVertical,
		Move,
		Globe,
		Lock,
		Pencil
	} from 'lucide-svelte';

	let { data } = $props();

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

	let previewDialogOpen = $state(false);
	let previewUpload = $state<Upload | null>(null);

	let uploadDialogOpen = $state(false);

	let createFolderDialogOpen = $state(false);

	let moveDialogOpen = $state(false);
	let uploadToMove = $state<Upload | null>(null);

	let renameDialogOpen = $state(false);
	let uploadToRename = $state<Upload | null>(null);

	let shareDialogOpen = $state(false);
	let uploadToShare = $state<Upload | null>(null);

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

	// Open preview dialog
	function openPreview(upload: Upload) {
		previewUpload = upload;
		previewDialogOpen = true;
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

	// Get file icon based on mime type
	function getFileIcon(mimeType: string) {
		if (mimeType.startsWith('image/')) return FileImage;
		if (mimeType.startsWith('video/')) return FileVideo;
		if (mimeType.startsWith('audio/')) return FileAudio;
		if (mimeType.startsWith('text/') || mimeType.includes('document') || mimeType.includes('pdf'))
			return FileText;
		return File;
	}

	// Format file size
	function formatFileSize(bytes: number): string {
		if (bytes === 0) return '0 Bytes';
		const k = 1024;
		const sizes = ['Bytes', 'KB', 'MB', 'GB'];
		const i = Math.floor(Math.log(bytes) / Math.log(k));
		return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
	}

	// Format date
	function formatDate(date: Date | string): string {
		const d = typeof date === 'string' ? new Date(date) : date;
		return d.toLocaleDateString('en-US', {
			year: 'numeric',
			month: 'short',
			day: 'numeric',
			hour: '2-digit',
			minute: '2-digit'
		});
	}

	// Get status badge variant
	function getStatusVariant(status: string): 'default' | 'secondary' | 'destructive' | 'outline' {
		switch (status) {
			case 'completed':
				return 'default';
			case 'pending':
				return 'secondary';
			case 'uploading':
				return 'outline';
			case 'failed':
				return 'destructive';
			case 'cancelled':
				return 'destructive';
			default:
				return 'secondary';
		}
	}

	// Can preview (images, videos, audio, and PDFs)
	function canPreview(mimeType: string): boolean {
		return (
			mimeType.startsWith('image/') ||
			mimeType.startsWith('video/') ||
			mimeType.startsWith('audio/') ||
			mimeType === 'application/pdf'
		);
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
	<div class="space-y-6 p-8">
		<!-- Page Header -->
		<div class="space-y-1">
			<h1 class="text-3xl font-bold tracking-tight">Uploads</h1>
			<p class="text-muted-foreground">Manage your uploaded files and folders</p>
		</div>

		<!-- Breadcrumb Navigation -->
		<nav class="flex items-center gap-1 text-sm">
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
		<div class="flex items-center justify-between gap-4">
			<div class="flex items-center gap-2">
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
			<div class="flex items-center gap-2">
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

		<!-- Folders Grid -->
		{#if folders.length > 0}
			<div class="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
				{#each folders as folder (folder.id.toString())}
					<Card.Root
						class="cursor-pointer transition-colors hover:bg-accent"
						role="button"
						tabindex={0}
						onclick={() => navigateToFolder(folder.id.toString())}
						onkeydown={(e) => {
							if (e.key === 'Enter' || e.key === ' ') {
								e.preventDefault();
								navigateToFolder(folder.id.toString());
							}
						}}
					>
						<Card.Content class="flex items-center gap-3 p-4">
							<div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted">
								{#if isPublicFolder(folder)}
									<Globe class="h-5 w-5 text-primary" />
								{:else}
									<FolderIcon class="h-5 w-5 text-muted-foreground" />
								{/if}
							</div>
							<div class="min-w-0 flex-1">
								<p class="truncate font-medium">{folder.name}</p>
								{#if isPublicFolder(folder)}
									<p class="text-xs text-muted-foreground">Public folder</p>
								{/if}
							</div>
							<DropdownMenu.Root>
								<DropdownMenu.Trigger
									class="rounded-md p-1 hover:bg-background"
									onclick={(e) => e.stopPropagation()}
								>
									<MoreVertical class="h-4 w-4" />
								</DropdownMenu.Trigger>
								<DropdownMenu.Content>
									<DropdownMenu.Item
										class="text-destructive"
										onclick={(e) => {
											e.stopPropagation();
											openDeleteFolderDialog(folder);
										}}
									>
										<Trash2 class="mr-2 h-4 w-4" />
										Delete
									</DropdownMenu.Item>
								</DropdownMenu.Content>
							</DropdownMenu.Root>
						</Card.Content>
					</Card.Root>
				{/each}
			</div>
		{/if}

		<!-- Uploads Table -->
		{#if loading}
			<Card.Root>
				<Card.Content class="p-0">
					<Table.Root>
						<Table.Header>
							<Table.Row>
								<Table.Head class="w-12"></Table.Head>
								<Table.Head>Filename</Table.Head>
								<Table.Head>Size</Table.Head>
								<Table.Head>Status</Table.Head>
								<Table.Head>Created</Table.Head>
								<Table.Head class="w-24">Actions</Table.Head>
							</Table.Row>
						</Table.Header>
						<Table.Body>
							{#each Array(5) as _, i (i)}
								<Table.Row>
									<Table.Cell><Skeleton class="h-8 w-8" /></Table.Cell>
									<Table.Cell><Skeleton class="h-4 w-48" /></Table.Cell>
									<Table.Cell><Skeleton class="h-4 w-16" /></Table.Cell>
									<Table.Cell><Skeleton class="h-5 w-20" /></Table.Cell>
									<Table.Cell><Skeleton class="h-4 w-32" /></Table.Cell>
									<Table.Cell><Skeleton class="h-8 w-20" /></Table.Cell>
								</Table.Row>
							{/each}
						</Table.Body>
					</Table.Root>
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
		{:else if uploads.length > 0}
			<Card.Root>
				<Card.Content class="p-0">
					<Table.Root>
						<Table.Header>
							<Table.Row>
								<Table.Head class="w-12"></Table.Head>
								<Table.Head>Filename</Table.Head>
								<Table.Head>Size</Table.Head>
								<Table.Head>Status</Table.Head>
								<Table.Head>Access</Table.Head>
								<Table.Head>Created</Table.Head>
								<Table.Head class="w-40">Actions</Table.Head>
							</Table.Row>
						</Table.Header>
						<Table.Body>
							{#each uploads as upload (upload.id.toString())}
								{@const FileIcon = getFileIcon(upload.mime_type)}
								<Table.Row>
									<Table.Cell>
										<div class="flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
											<FileIcon class="h-5 w-5 text-muted-foreground" />
										</div>
									</Table.Cell>
									<Table.Cell>
										<div class="flex flex-col">
											<span class="max-w-[300px] truncate font-medium">{upload.filename}</span>
											<span class="text-xs text-muted-foreground">{upload.mime_type}</span>
										</div>
									</Table.Cell>
									<Table.Cell>
										<span class="text-sm text-muted-foreground">{formatFileSize(upload.size)}</span>
									</Table.Cell>
									<Table.Cell>
										<Badge variant={getStatusVariant(upload.status)}>
											{upload.status}
										</Badge>
									</Table.Cell>
									<Table.Cell>
										{#if upload.is_public}
											<Badge variant="outline" class="gap-1">
												<Globe class="h-3 w-3" />
												Public
											</Badge>
										{:else}
											<Badge variant="secondary" class="gap-1">
												<Lock class="h-3 w-3" />
												Private
											</Badge>
										{/if}
									</Table.Cell>
									<Table.Cell>
										<span class="text-sm text-muted-foreground"
											>{formatDate(upload.created_at)}</span
										>
									</Table.Cell>
									<Table.Cell>
										<div class="flex items-center gap-1">
											{#if canPreview(upload.mime_type) && upload.status === 'completed'}
												<Button
													variant="ghost"
													size="sm"
													onclick={() => openPreview(upload)}
													title="Preview"
												>
													<Eye class="h-4 w-4" />
												</Button>
											{/if}
											{#if upload.status === 'completed' && upload.url}
												<Button
													variant="ghost"
													size="sm"
													onclick={() => copyLink(upload)}
													title={upload.is_public ? 'Copy Link' : 'Share'}
												>
													<Link class="h-4 w-4" />
												</Button>
											{/if}
											{#if upload.status === 'completed'}
												<Button
													variant="ghost"
													size="sm"
													onclick={() => downloadFile(upload)}
													title="Download"
												>
													<Download class="h-4 w-4" />
												</Button>
											{/if}
											<DropdownMenu.Root>
												<DropdownMenu.Trigger>
													<Button variant="ghost" size="sm" title="More options">
														<MoreVertical class="h-4 w-4" />
													</Button>
												</DropdownMenu.Trigger>
												<DropdownMenu.Content>
													<DropdownMenu.Item onclick={() => openRenameDialog(upload)}>
														<Pencil class="mr-2 h-4 w-4" />
														Rename
													</DropdownMenu.Item>
													<DropdownMenu.Item onclick={() => openMoveDialog(upload)}>
														<Move class="mr-2 h-4 w-4" />
														Move to folder
													</DropdownMenu.Item>
													<DropdownMenu.Separator />
													<DropdownMenu.Item
														class="text-destructive"
														onclick={() => openDeleteUploadDialog(upload)}
													>
														<Trash2 class="mr-2 h-4 w-4" />
														Delete
													</DropdownMenu.Item>
												</DropdownMenu.Content>
											</DropdownMenu.Root>
										</div>
									</Table.Cell>
								</Table.Row>
							{/each}
						</Table.Body>
					</Table.Root>
				</Card.Content>
			</Card.Root>
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

	<PreviewUploadDialog
		upload={previewUpload}
		bind:open={previewDialogOpen}
		onOpenShareDialog={openShareDialog}
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
{:else}
	<!-- Not Logged In View -->
	<div class="flex h-full items-center justify-center p-8">
		<Card.Root class="max-w-md">
			<Card.Header>
				<Card.Title>Sign in required</Card.Title>
				<Card.Description>You need to be logged in to manage your uploads.</Card.Description>
			</Card.Header>
		</Card.Root>
	</div>
{/if}
