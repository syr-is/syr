<script lang="ts">
	import * as Card from '$lib/components/ui/card';
	import * as Select from '$lib/components/ui/select';
	import * as Pagination from '$lib/components/ui/pagination';
	import * as Table from '$lib/components/ui/table';
	import * as Dialog from '$lib/components/ui/dialog';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
	import * as Accordion from '$lib/components/ui/accordion';
	import { Button } from '$lib/components/ui/button';
	import { Skeleton } from '$lib/components/ui/skeleton';
	import { Badge } from '$lib/components/ui/badge';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import type { Upload } from '@syr-is/types';
	import type { RecordId } from 'surrealdb';

	// Folder type definition (matches @syr-is/types/folders.ts)
	interface Folder {
		id: RecordId<string>;
		created_at: Date;
		updated_at: Date;
		name: string;
		owner_id: RecordId<string>;
		parent_id?: RecordId<string> | null;
	}
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
		Loader2,
		FolderIcon,
		FolderPlus,
		ChevronRight,
		Home,
		MoreVertical,
		Move,
		Globe,
		Lock,
		Clock,
		Copy,
		Check,
		Circle,
		CircleCheck,
		Pencil,
		TriangleAlert
	} from 'lucide-svelte';

	let { data } = $props();

	// Uploads state
	let uploads = $state<Upload[]>([]);
	let folders = $state<Folder[]>([]);
	let loading = $state(false);
	let error = $state<string | null>(null);

	// Current folder state
	let currentFolderId = $state<string | null>(null);
	let breadcrumbs = $state<Array<{ id: string; name: string }>>([]);

	// Pagination state
	let currentPage = $state(1);
	let limit = $state(20);
	let total = $state(0);

	// Sorting state
	let sortField = $state<'created_at' | 'updated_at' | 'filename' | 'size'>('created_at');
	let sortOrder = $state<'asc' | 'desc'>('desc');

	// Delete confirmation state
	let deleteDialogOpen = $state(false);
	let uploadToDelete = $state<Upload | null>(null);
	let folderToDelete = $state<Folder | null>(null);
	let deleting = $state(false);

	// Preview state
	let previewDialogOpen = $state(false);
	let previewUpload = $state<Upload | null>(null);
	let previewUrl = $state<string | null>(null);
	let previewIsPublic = $state(false); // Dynamic public status from API
	let previewLoading = $state(false);

	// Upload dialog state
	let uploadDialogOpen = $state(false);
	let uploading = $state(false);
	let uploadProgress = $state<string>('');
	let fileInputRef = $state<HTMLInputElement | null>(null);

	// New folder dialog state
	let newFolderDialogOpen = $state(false);
	let newFolderName = $state('');
	let creatingFolder = $state(false);

	// Move file dialog state
	let moveDialogOpen = $state(false);
	let uploadToMove = $state<Upload | null>(null);
	let moveTargetFolderId = $state<string>(''); // Empty string means root
	let allFolders = $state<Folder[]>([]); // Flat list of all folders
	let loadingFolders = $state(false);
	let moving = $state(false);

	// Rename file dialog state
	let renameDialogOpen = $state(false);
	let uploadToRename = $state<Upload | null>(null);
	let newFilename = $state('');
	let renaming = $state(false);

	// Build folder tree from flat list
	interface FolderNode extends Folder {
		children: FolderNode[];
	}

	function buildFolderTree(folders: Folder[]): FolderNode[] {
		const folderMap: Record<string, FolderNode> = {};
		const rootFolders: FolderNode[] = [];

		// Create nodes for all folders
		for (const folder of folders) {
			folderMap[folder.id.toString()] = { ...folder, children: [] };
		}

		// Build the tree
		for (const folder of folders) {
			const node = folderMap[folder.id.toString()];
			if (folder.parent_id) {
				const parent = folderMap[folder.parent_id.toString()];
				if (parent) {
					parent.children.push(node);
				} else {
					// Parent not found, treat as root
					rootFolders.push(node);
				}
			} else {
				rootFolders.push(node);
			}
		}

		// Sort children alphabetically
		const sortChildren = (nodes: FolderNode[]) => {
			nodes.sort((a, b) => a.name.localeCompare(b.name));
			for (const node of nodes) {
				sortChildren(node.children);
			}
		};
		sortChildren(rootFolders);

		return rootFolders;
	}

	// Get the folder tree
	const folderTree = $derived(buildFolderTree(allFolders));

	// Get selected folder name for display
	function getSelectedFolderPath(): string {
		if (!moveTargetFolderId) return 'Root';
		const folder = allFolders.find((f) => f.id.toString() === moveTargetFolderId);
		if (!folder) return 'Select folder';

		// Build path
		const path: string[] = [folder.name];
		let current = folder;
		while (current.parent_id) {
			const parent = allFolders.find((f) => f.id.toString() === current.parent_id?.toString());
			if (parent) {
				path.unshift(parent.name);
				current = parent;
			} else {
				break;
			}
		}
		return path.join(' / ');
	}

	// Share dialog state
	let shareDialogOpen = $state(false);
	let uploadToShare = $state<Upload | null>(null);
	let shareExpiryValue = $state('3600'); // Default 1 hour, stored as string for Select component
	let generatingShareLink = $state(false);
	let generatedShareUrl = $state<string | null>(null);
	let shareExpiresAt = $state<string | null>(null);

	// Expiry options in seconds (values as strings for Select component)
	const expiryOptions = [
		{ value: '3600', label: '1 hour' },
		{ value: '21600', label: '6 hours' },
		{ value: '86400', label: '24 hours' },
		{ value: '259200', label: '3 days' },
		{ value: '604800', label: '7 days' }
	];

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
				throw new Error(errorData.error?.message || 'Failed to fetch folders');
			}

			const result = await response.json();
			folders = result.data?.folders || [];
			breadcrumbs = result.data?.breadcrumbs || [];
		} catch (err) {
			console.error('Failed to fetch folders:', err);
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

	// Navigate to folder
	function navigateToFolder(folderId: string | null) {
		currentFolderId = folderId;
		currentPage = 1;
	}

	// Create new folder
	async function handleCreateFolder() {
		if (!newFolderName.trim()) {
			toast.error('Please enter a folder name');
			return;
		}

		creatingFolder = true;
		try {
			const response = await fetch('/api/folders', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					name: newFolderName.trim(),
					parent_id: currentFolderId
				})
			});

			if (!response.ok) {
				const errorData = await response.json();
				throw new Error(errorData.error?.message || 'Failed to create folder');
			}

			toast.success('Folder created successfully');
			newFolderDialogOpen = false;
			newFolderName = '';
			await fetchFolders();
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Failed to create folder');
		} finally {
			creatingFolder = false;
		}
	}

	// Delete upload
	async function handleDeleteUpload() {
		if (!uploadToDelete) return;

		deleting = true;
		try {
			const uploadId =
				typeof uploadToDelete.id === 'string' ? uploadToDelete.id : uploadToDelete.id.toString();
			const response = await fetch(`/api/uploads/${uploadId}`, {
				method: 'DELETE'
			});

			if (!response.ok) {
				const errorData = await response.json();
				throw new Error(errorData.error?.message || 'Failed to delete upload');
			}

			toast.success('Upload deleted successfully');
			deleteDialogOpen = false;
			uploadToDelete = null;
			await fetchUploads();
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Failed to delete upload');
		} finally {
			deleting = false;
		}
	}

	// Delete folder
	async function handleDeleteFolder() {
		if (!folderToDelete) return;

		deleting = true;
		try {
			const folderId =
				typeof folderToDelete.id === 'string' ? folderToDelete.id : folderToDelete.id.toString();
			const response = await fetch(`/api/folders/${folderId}?delete_contents=true`, {
				method: 'DELETE'
			});

			if (!response.ok) {
				const errorData = await response.json();
				throw new Error(errorData.error?.message || 'Failed to delete folder');
			}

			toast.success('Folder deleted successfully');
			deleteDialogOpen = false;
			folderToDelete = null;
			await fetchFolders();
			await fetchUploads();
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Failed to delete folder');
		} finally {
			deleting = false;
		}
	}

	// Open delete confirmation
	function openDeleteUploadDialog(upload: Upload) {
		uploadToDelete = upload;
		folderToDelete = null;
		deleteDialogOpen = true;
	}

	function openDeleteFolderDialog(folder: Folder) {
		folderToDelete = folder;
		uploadToDelete = null;
		deleteDialogOpen = true;
	}

	// Open preview
	async function openPreview(upload: Upload) {
		previewUpload = upload;
		previewDialogOpen = true;
		previewLoading = true;
		previewUrl = null;
		previewIsPublic = upload.is_public; // Default to stored value

		try {
			const uploadId = typeof upload.id === 'string' ? upload.id : upload.id.toString();
			const response = await fetch(`/api/uploads/${uploadId}`);
			if (response.ok) {
				const result = await response.json();
				previewUrl = result.data?.downloadUrl || null;
				previewIsPublic = result.data?.isPublic ?? upload.is_public; // Use dynamic value from API
			}
		} catch {
			// Silently fail, preview just won't work
		} finally {
			previewLoading = false;
		}
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
			// Fetch current public status from API (handles nested public folders correctly)
			const uploadId = typeof upload.id === 'string' ? upload.id : upload.id.toString();
			const response = await fetch(`/api/uploads/${uploadId}`);
			if (!response.ok) {
				throw new Error('Failed to get upload info');
			}

			const result = await response.json();
			const isPublic = result.data?.isPublic ?? upload.is_public;
			const downloadUrl = result.data?.downloadUrl;

			// For public files, copy the direct URL
			if (isPublic && downloadUrl) {
				await navigator.clipboard.writeText(downloadUrl);
				toast.success('Link copied to clipboard');
				return;
			}

			// For private files, open share dialog to generate presigned URL with custom expiry
			openShareDialog(upload);
		} catch {
			// Fallback to stored value if API fails
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

	// Copy preview link directly (preview already has the correct URL)
	async function copyPreviewLink() {
		if (!previewUrl) {
			toast.error('URL not available');
			return;
		}

		// For public files in preview, copy directly since previewUrl is already correct
		if (previewIsPublic) {
			try {
				await navigator.clipboard.writeText(previewUrl);
				toast.success('Link copied to clipboard');
			} catch {
				toast.error('Failed to copy link');
			}
			return;
		}

		// For private files, open share dialog for custom expiry
		if (previewUpload) {
			openShareDialog(previewUpload);
		}
	}

	// Open share dialog for private files
	function openShareDialog(upload: Upload) {
		uploadToShare = upload;
		shareExpiryValue = '3600'; // Reset to default
		generatedShareUrl = null;
		shareExpiresAt = null;
		shareDialogOpen = true;
	}

	// Generate share link with specified expiry
	async function generateShareLink() {
		if (!uploadToShare) return;

		generatingShareLink = true;
		try {
			const uploadId =
				typeof uploadToShare.id === 'string' ? uploadToShare.id : uploadToShare.id.toString();
			const expiresIn = parseInt(shareExpiryValue, 10);
			const response = await fetch(`/api/uploads/${uploadId}/share`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ expiresIn })
			});

			if (!response.ok) {
				const errorData = await response.json();
				throw new Error(errorData.error?.message || 'Failed to generate share link');
			}

			const result = await response.json();
			generatedShareUrl = result.data.url;
			shareExpiresAt = result.data.expiresAt;
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Failed to generate share link');
		} finally {
			generatingShareLink = false;
		}
	}

	// Copy generated share URL to clipboard
	let shareLinkCopied = $state(false);
	async function copyShareUrl() {
		if (!generatedShareUrl) return;
		try {
			await navigator.clipboard.writeText(generatedShareUrl);
			shareLinkCopied = true;
			toast.success('Share link copied to clipboard');
			setTimeout(() => {
				shareLinkCopied = false;
			}, 2000);
		} catch {
			toast.error('Failed to copy link');
		}
	}

	// Format expiry time for display
	function formatExpiryTime(isoString: string): string {
		const date = new Date(isoString);
		return date.toLocaleString('en-US', {
			month: 'short',
			day: 'numeric',
			hour: '2-digit',
			minute: '2-digit'
		});
	}

	// Handle file selection and upload
	async function handleFileSelect(event: Event) {
		const input = event.target as HTMLInputElement;
		const files = input.files;
		if (!files || files.length === 0) return;

		uploading = true;
		uploadProgress = 'Preparing upload...';

		try {
			for (let i = 0; i < files.length; i++) {
				const file = files[i];
				uploadProgress = `Uploading ${file.name} (${i + 1}/${files.length})...`;

				// Calculate SHA256 hash
				const arrayBuffer = await file.arrayBuffer();
				const hashBuffer = await crypto.subtle.digest('SHA-256', arrayBuffer);
				const hashArray = Array.from(new Uint8Array(hashBuffer));
				const sha256 = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');

				// Get signed URL
				const response = await fetch('/api/uploads', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						filename: file.name,
						mime_type: file.type || 'application/octet-stream',
						size: file.size,
						sha256,
						folder_id: currentFolderId
					})
				});

				if (!response.ok) {
					throw new Error(`Failed to get upload URL for ${file.name}`);
				}

				const result = await response.json();
				const { signedUrl, uploadId } = result.data;

				// Upload to S3
				uploadProgress = `Uploading ${file.name} to storage...`;
				const uploadResponse = await fetch(signedUrl, {
					method: 'PUT',
					headers: { 'Content-Type': file.type || 'application/octet-stream' },
					body: file
				});

				if (!uploadResponse.ok) {
					throw new Error(`Failed to upload ${file.name}`);
				}

				// Complete upload
				uploadProgress = `Finalizing ${file.name}...`;
				const completeResponse = await fetch('/api/uploads', {
					method: 'PATCH',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ id: uploadId, status: 'completed' })
				});

				if (!completeResponse.ok) {
					throw new Error(`Failed to complete upload for ${file.name}`);
				}
			}

			toast.success(`Successfully uploaded ${files.length} file${files.length > 1 ? 's' : ''}`);
			uploadDialogOpen = false;
			await fetchUploads();
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Upload failed');
		} finally {
			uploading = false;
			uploadProgress = '';
			// Reset the file input
			if (input) input.value = '';
		}
	}

	// Recursively fetch all folders for move dialog
	async function fetchAllFoldersRecursive(parentId: string | null = null): Promise<Folder[]> {
		const queryString = parentId ? `?parent_id=${encodeURIComponent(parentId)}` : '';
		const response = await fetch(`/api/folders${queryString}`);
		if (!response.ok) return [];

		const result = await response.json();
		const folders: Folder[] = result.data?.folders || [];

		// Recursively fetch children for each folder
		const allFolders: Folder[] = [...folders];
		for (const folder of folders) {
			const children = await fetchAllFoldersRecursive(folder.id.toString());
			allFolders.push(...children);
		}

		return allFolders;
	}

	// Fetch all folders for move dialog
	async function fetchAllFolders() {
		loadingFolders = true;
		try {
			allFolders = await fetchAllFoldersRecursive();
		} catch {
			allFolders = [];
		} finally {
			loadingFolders = false;
		}
	}

	// Open move dialog
	async function openMoveDialog(upload: Upload) {
		uploadToMove = upload;
		moveTargetFolderId = '';
		moveDialogOpen = true;
		await fetchAllFolders();
	}

	// Handle move
	async function handleMove() {
		if (!uploadToMove) return;

		moving = true;
		try {
			const uploadId =
				typeof uploadToMove.id === 'string' ? uploadToMove.id : uploadToMove.id.toString();
			const response = await fetch(`/api/uploads/${uploadId}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					folder_id: moveTargetFolderId || null // Convert empty string to null for API
				})
			});

			if (!response.ok) {
				const errorData = await response.json();
				throw new Error(errorData.error?.message || 'Failed to move file');
			}

			toast.success('File moved successfully');
			moveDialogOpen = false;
			uploadToMove = null;
			await fetchUploads();
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Failed to move file');
		} finally {
			moving = false;
		}
	}

	// Open rename dialog
	function openRenameDialog(upload: Upload) {
		uploadToRename = upload;
		newFilename = upload.filename;
		renameDialogOpen = true;
	}

	// Handle rename
	async function handleRename() {
		if (!uploadToRename || !newFilename.trim()) return;

		renaming = true;
		try {
			const uploadId =
				typeof uploadToRename.id === 'string' ? uploadToRename.id : uploadToRename.id.toString();
			const response = await fetch(`/api/uploads/${uploadId}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					filename: newFilename.trim()
				})
			});

			if (!response.ok) {
				const errorData = await response.json();
				throw new Error(errorData.error?.message || 'Failed to rename file');
			}

			toast.success('File renamed successfully');
			renameDialogOpen = false;
			uploadToRename = null;
			newFilename = '';
			await fetchUploads();
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Failed to rename file');
		} finally {
			renaming = false;
		}
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

	// Get preview type for rendering the appropriate element
	function getPreviewType(mimeType: string): 'image' | 'video' | 'audio' | 'pdf' | null {
		if (mimeType.startsWith('image/')) return 'image';
		if (mimeType.startsWith('video/')) return 'video';
		if (mimeType.startsWith('audio/')) return 'audio';
		if (mimeType === 'application/pdf') return 'pdf';
		return null;
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

	// Check if folder is a public folder (any folder named "public" at any level)
	function isPublicFolder(folder: Folder): boolean {
		return folder.name.toLowerCase() === 'public';
	}
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
				<ChevronRight class="text-muted-foreground h-4 w-4" />
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
				<span class="text-muted-foreground text-sm">
					{total} file{total !== 1 ? 's' : ''} total
				</span>
				<Button
					variant="outline"
					onclick={() => {
						newFolderDialogOpen = true;
					}}
				>
					<FolderPlus class="mr-2 h-4 w-4" />
					New Folder
				</Button>
				<Button
					onclick={() => {
						uploadDialogOpen = true;
					}}
				>
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
						class="hover:bg-accent cursor-pointer transition-colors"
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
							<div class="bg-muted flex h-10 w-10 shrink-0 items-center justify-center rounded-lg">
								{#if isPublicFolder(folder)}
									<Globe class="text-primary h-5 w-5" />
								{:else}
									<FolderIcon class="text-muted-foreground h-5 w-5" />
								{/if}
							</div>
							<div class="min-w-0 flex-1">
								<p class="truncate font-medium">{folder.name}</p>
								{#if isPublicFolder(folder)}
									<p class="text-muted-foreground text-xs">Public folder</p>
								{/if}
							</div>
							<DropdownMenu.Root>
								<DropdownMenu.Trigger
									class="hover:bg-background rounded-md p-1"
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
					<p class="text-destructive text-center">{error}</p>
				</Card.Content>
			</Card.Root>
		{:else if uploads.length === 0 && folders.length === 0}
			<Card.Root>
				<Card.Content class="py-12">
					<div class="space-y-2 text-center">
						<File class="text-muted-foreground mx-auto h-12 w-12" />
						<h3 class="text-lg font-semibold">No files or folders</h3>
						<p class="text-muted-foreground text-sm">
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
										<div class="bg-muted flex h-10 w-10 items-center justify-center rounded-lg">
											<FileIcon class="text-muted-foreground h-5 w-5" />
										</div>
									</Table.Cell>
									<Table.Cell>
										<div class="flex flex-col">
											<span class="max-w-[300px] truncate font-medium">{upload.filename}</span>
											<span class="text-muted-foreground text-xs">{upload.mime_type}</span>
										</div>
									</Table.Cell>
									<Table.Cell>
										<span class="text-muted-foreground text-sm">{formatFileSize(upload.size)}</span>
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
										<span class="text-muted-foreground text-sm"
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

	<!-- Delete Confirmation Dialog -->
	<Dialog.Root bind:open={deleteDialogOpen}>
		<Dialog.Content>
			<Dialog.Header>
				<Dialog.Title>
					{#if uploadToDelete}
						Delete Upload
					{:else}
						Delete Folder
					{/if}
				</Dialog.Title>
				<Dialog.Description>
					{#if uploadToDelete}
						Are you sure you want to delete "{uploadToDelete.filename}"? This action cannot be
						undone.
					{:else if folderToDelete}
						Are you sure you want to delete the folder "{folderToDelete.name}" and all its contents?
						This action cannot be undone.
					{/if}
				</Dialog.Description>
			</Dialog.Header>
			<Dialog.Footer>
				<Button
					variant="outline"
					onclick={() => {
						deleteDialogOpen = false;
						uploadToDelete = null;
						folderToDelete = null;
					}}
				>
					Cancel
				</Button>
				<Button
					variant="destructive"
					onclick={uploadToDelete ? handleDeleteUpload : handleDeleteFolder}
					disabled={deleting}
				>
					{deleting ? 'Deleting...' : 'Delete'}
				</Button>
			</Dialog.Footer>
		</Dialog.Content>
	</Dialog.Root>

	<!-- Preview Dialog -->
	<Dialog.Root bind:open={previewDialogOpen}>
		<Dialog.Content class="max-w-3xl">
			<Dialog.Header>
				<Dialog.Title class="max-w-[500px] truncate">{previewUpload?.filename}</Dialog.Title>
				<Dialog.Description>
					{previewUpload?.mime_type} • {previewUpload ? formatFileSize(previewUpload.size) : ''}
				</Dialog.Description>
			</Dialog.Header>
			<div class="flex items-center justify-center overflow-hidden py-4">
				{#if previewLoading}
					<Skeleton class="h-64 w-full" />
				{:else if previewUrl && previewUpload}
					{@const previewType = getPreviewType(previewUpload.mime_type)}
					{#if previewType === 'image'}
						<img
							src={previewUrl}
							alt={previewUpload.filename}
							class="max-h-[60vh] w-auto max-w-full rounded-lg object-contain"
						/>
					{:else if previewType === 'video'}
						<video
							src={previewUrl}
							controls
							class="max-h-[60vh] w-auto max-w-full rounded-lg"
							preload="metadata"
						>
							<track kind="captions" />
							Your browser does not support video playback.
						</video>
					{:else if previewType === 'audio'}
						<div class="flex w-full flex-col items-center gap-4 py-8">
							<FileAudio class="text-muted-foreground h-16 w-16" />
							<audio src={previewUrl} controls class="w-full max-w-md" preload="metadata">
								Your browser does not support audio playback.
							</audio>
						</div>
					{:else if previewType === 'pdf'}
						<iframe
							src={previewUrl}
							title={previewUpload.filename}
							class="h-[60vh] w-full rounded-lg border"
						>
							Your browser does not support PDF preview.
						</iframe>
					{:else}
						<p class="text-muted-foreground">Preview not available for this file type</p>
					{/if}
				{:else}
					<p class="text-muted-foreground">Preview not available</p>
				{/if}
			</div>
			{#if previewUpload?.url}
				<Dialog.Footer>
					<Button variant="outline" onclick={copyPreviewLink}>
						<Link class="mr-2 h-4 w-4" />
						{previewIsPublic ? 'Copy Link' : 'Share...'}
					</Button>
					<Button onclick={() => previewUpload && downloadFile(previewUpload)}>
						<Download class="mr-2 h-4 w-4" />
						Download
					</Button>
				</Dialog.Footer>
			{/if}
		</Dialog.Content>
	</Dialog.Root>

	<!-- Upload Dialog -->
	<Dialog.Root bind:open={uploadDialogOpen}>
		<Dialog.Content>
			<Dialog.Header>
				<Dialog.Title>Upload Files</Dialog.Title>
				<Dialog.Description>
					Select files to upload to
					{#if currentFolderId}
						the current folder.
					{:else}
						your root directory.
					{/if}
					{#if breadcrumbs.some((b) => b.name.toLowerCase() === 'public')}
						<br /><span class="text-primary font-medium"
							>Files in public folders are accessible without authentication.</span
						>
					{/if}
				</Dialog.Description>
			</Dialog.Header>
			<div class="py-4">
				{#if uploading}
					<div class="flex flex-col items-center justify-center gap-4 py-8">
						<Loader2 class="text-primary h-8 w-8 animate-spin" />
						<p class="text-muted-foreground text-sm">{uploadProgress}</p>
					</div>
				{:else}
					<div class="flex flex-col gap-4">
						<Input
							bind:ref={fileInputRef}
							type="file"
							multiple
							onchange={handleFileSelect}
							class="cursor-pointer"
						/>
						<p class="text-muted-foreground text-xs">
							You can select multiple files to upload at once.
						</p>
					</div>
				{/if}
			</div>
			<Dialog.Footer>
				<Button
					variant="outline"
					onclick={() => {
						uploadDialogOpen = false;
					}}
					disabled={uploading}
				>
					Cancel
				</Button>
			</Dialog.Footer>
		</Dialog.Content>
	</Dialog.Root>

	<!-- New Folder Dialog -->
	<Dialog.Root bind:open={newFolderDialogOpen}>
		<Dialog.Content>
			<Dialog.Header>
				<Dialog.Title>Create New Folder</Dialog.Title>
				<Dialog.Description>
					Create a new folder in
					{#if currentFolderId}
						the current directory.
					{:else}
						your root directory.
					{/if}
				</Dialog.Description>
			</Dialog.Header>
			<div class="py-4">
				<div class="flex flex-col gap-2">
					<Label for="folder-name">Folder Name</Label>
					<Input
						id="folder-name"
						bind:value={newFolderName}
						placeholder="Enter folder name..."
						onkeydown={(e) => {
							if (e.key === 'Enter') {
								handleCreateFolder();
							}
						}}
					/>
				</div>
			</div>
			<Dialog.Footer>
				<Button
					variant="outline"
					onclick={() => {
						newFolderDialogOpen = false;
						newFolderName = '';
					}}
				>
					Cancel
				</Button>
				<Button onclick={handleCreateFolder} disabled={creatingFolder || !newFolderName.trim()}>
					{creatingFolder ? 'Creating...' : 'Create Folder'}
				</Button>
			</Dialog.Footer>
		</Dialog.Content>
	</Dialog.Root>

	<!-- Move File Dialog -->
	<Dialog.Root bind:open={moveDialogOpen}>
		<Dialog.Content class="max-w-md">
			<Dialog.Header>
				<Dialog.Title>Move File</Dialog.Title>
				<Dialog.Description>
					Move "{uploadToMove?.filename}" to a different folder.
				</Dialog.Description>
			</Dialog.Header>
			<div class="py-4">
				<div class="flex flex-col gap-2">
					<Label>Destination Folder</Label>
					<div class="text-muted-foreground mb-2 text-sm">
						Selected: <span class="text-foreground font-medium">{getSelectedFolderPath()}</span>
					</div>
					<div class="border-input max-h-64 overflow-y-auto rounded-md border p-2">
						{#if loadingFolders}
							<div class="flex items-center justify-center py-4">
								<Loader2 class="text-muted-foreground h-5 w-5 animate-spin" />
							</div>
						{:else}
							<!-- Root option -->
							<button
								type="button"
								class="hover:bg-accent flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors"
								onclick={() => (moveTargetFolderId = '')}
							>
								{#if moveTargetFolderId === ''}
									<CircleCheck class="text-primary h-4 w-4" />
								{:else}
									<Circle class="text-muted-foreground h-4 w-4" />
								{/if}
								<Home class="h-4 w-4" />
								<span>Root</span>
							</button>

							<!-- Folder tree using accordions -->
							{#if folderTree.length > 0}
								{#snippet renderFolderNode(node: FolderNode, depth: number)}
									{#if node.children.length > 0}
										<Accordion.Root type="multiple" class="w-full">
											<Accordion.Item value={node.id.toString()} class="border-b-0">
												<div class="flex items-center" style="padding-left: {depth * 16}px">
													<button
														type="button"
														class="hover:bg-accent flex flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors"
														onclick={() => (moveTargetFolderId = node.id.toString())}
													>
														{#if moveTargetFolderId === node.id.toString()}
															<CircleCheck class="text-primary h-4 w-4 shrink-0" />
														{:else}
															<Circle class="text-muted-foreground h-4 w-4 shrink-0" />
														{/if}
														{#if node.name.toLowerCase() === 'public'}
															<Globe class="text-primary h-4 w-4 shrink-0" />
														{:else}
															<FolderIcon class="text-muted-foreground h-4 w-4 shrink-0" />
														{/if}
														<span class="truncate">{node.name}</span>
													</button>
													<Accordion.Trigger
														class="px-2 py-1.5 hover:no-underline [&>svg]:h-4 [&>svg]:w-4"
													/>
												</div>
												<Accordion.Content class="pb-0">
													{#each node.children as child (child.id.toString())}
														{@render renderFolderNode(child, depth + 1)}
													{/each}
												</Accordion.Content>
											</Accordion.Item>
										</Accordion.Root>
									{:else}
										<!-- Leaf folder (no children) -->
										<div style="padding-left: {depth * 16}px">
											<button
												type="button"
												class="hover:bg-accent flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors"
												onclick={() => (moveTargetFolderId = node.id.toString())}
											>
												{#if moveTargetFolderId === node.id.toString()}
													<CircleCheck class="text-primary h-4 w-4 shrink-0" />
												{:else}
													<Circle class="text-muted-foreground h-4 w-4 shrink-0" />
												{/if}
												{#if node.name.toLowerCase() === 'public'}
													<Globe class="text-primary h-4 w-4 shrink-0" />
												{:else}
													<FolderIcon class="text-muted-foreground h-4 w-4 shrink-0" />
												{/if}
												<span class="truncate">{node.name}</span>
											</button>
										</div>
									{/if}
								{/snippet}
								{#each folderTree as node (node.id.toString())}
									{@render renderFolderNode(node, 0)}
								{/each}
							{/if}
						{/if}
					</div>
				</div>
				<div class="bg-destructive/10 text-destructive mt-4 flex items-start gap-2 rounded-md p-3 text-sm">
					<TriangleAlert class="mt-0.5 h-4 w-4 shrink-0" />
					<span>Moving this file will break any existing share links and external references to it.</span>
				</div>
			</div>
			<Dialog.Footer>
				<Button
					variant="outline"
					onclick={() => {
						moveDialogOpen = false;
						uploadToMove = null;
						moveTargetFolderId = '';
					}}
				>
					Cancel
				</Button>
				<Button onclick={handleMove} disabled={moving}>
					{moving ? 'Moving...' : 'Move File'}
				</Button>
			</Dialog.Footer>
		</Dialog.Content>
	</Dialog.Root>

	<!-- Rename File Dialog -->
	<Dialog.Root bind:open={renameDialogOpen}>
		<Dialog.Content>
			<Dialog.Header>
				<Dialog.Title>Rename File</Dialog.Title>
				<Dialog.Description>
					Enter a new name for "{uploadToRename?.filename}"
				</Dialog.Description>
			</Dialog.Header>
			<div class="py-4">
				<div class="flex flex-col gap-2">
					<Label for="new-filename">New Filename</Label>
					<Input
						id="new-filename"
						bind:value={newFilename}
						placeholder="Enter new filename..."
						onkeydown={(e) => {
							if (e.key === 'Enter' && newFilename.trim()) {
								handleRename();
							}
						}}
					/>
				</div>
			</div>
			<Dialog.Footer>
				<Button
					variant="outline"
					onclick={() => {
						renameDialogOpen = false;
						uploadToRename = null;
						newFilename = '';
					}}
				>
					Cancel
				</Button>
				<Button onclick={handleRename} disabled={renaming || !newFilename.trim()}>
					{renaming ? 'Renaming...' : 'Rename'}
				</Button>
			</Dialog.Footer>
		</Dialog.Content>
	</Dialog.Root>

	<!-- Share Link Dialog -->
	<Dialog.Root bind:open={shareDialogOpen}>
		<Dialog.Content>
			<Dialog.Header>
				<Dialog.Title>Share File</Dialog.Title>
				<Dialog.Description>
					Generate a temporary link for "{uploadToShare?.filename}"
				</Dialog.Description>
			</Dialog.Header>
			<div class="space-y-4 py-4">
				{#if !generatedShareUrl}
					<div class="flex flex-col gap-2">
						<Label for="expiry-select">Link validity</Label>
						<Select.Root type="single" bind:value={shareExpiryValue} name="expiry-select">
							<Select.Trigger>
								<Clock class="mr-2 h-4 w-4" />
								{expiryOptions.find((o) => o.value === shareExpiryValue)?.label ||
									'Select duration'}
							</Select.Trigger>
							<Select.Content>
								{#each expiryOptions as option (option.value)}
									<Select.Item value={option.value}>{option.label}</Select.Item>
								{/each}
							</Select.Content>
						</Select.Root>
						<p class="text-muted-foreground text-xs">
							This link will expire after the selected duration. Anyone with this link can view the
							file.
						</p>
					</div>
				{:else}
					<div class="space-y-3">
						<div class="flex flex-col gap-2">
							<Label>Share link</Label>
							<div class="flex gap-2">
								<Input value={generatedShareUrl} readonly class="font-mono text-xs" />
								<Button variant="outline" size="icon" onclick={copyShareUrl} title="Copy link">
									{#if shareLinkCopied}
										<Check class="h-4 w-4 text-green-500" />
									{:else}
										<Copy class="h-4 w-4" />
									{/if}
								</Button>
							</div>
						</div>
						{#if shareExpiresAt}
							<p class="text-muted-foreground flex items-center gap-1 text-sm">
								<Clock class="h-4 w-4" />
								Expires: {formatExpiryTime(shareExpiresAt)}
							</p>
						{/if}
					</div>
				{/if}
			</div>
			<Dialog.Footer>
				<Button
					variant="outline"
					onclick={() => {
						shareDialogOpen = false;
						uploadToShare = null;
						generatedShareUrl = null;
						shareExpiresAt = null;
					}}
				>
					{generatedShareUrl ? 'Close' : 'Cancel'}
				</Button>
				{#if !generatedShareUrl}
					<Button onclick={generateShareLink} disabled={generatingShareLink}>
						{#if generatingShareLink}
							<Loader2 class="mr-2 h-4 w-4 animate-spin" />
							Generating...
						{:else}
							<Link class="mr-2 h-4 w-4" />
							Generate Link
						{/if}
					</Button>
				{:else}
					<Button
						onclick={() => {
							generatedShareUrl = null;
							shareExpiresAt = null;
						}}
					>
						Generate New Link
					</Button>
				{/if}
			</Dialog.Footer>
		</Dialog.Content>
	</Dialog.Root>
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
