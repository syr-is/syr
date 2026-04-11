<script lang="ts">
	import * as Card from '@syr-is/ui/card';
	import * as Table from '@syr-is/ui/table';
	import { Button } from '@syr-is/ui/button';
	import type { UploadWithCompositeId, Folder } from '@syr-is/types';

	import DeleteUploadDialog from '$lib/components/fragments/delete-upload-dialog.svelte';
	import DeleteFolderDialog from '$lib/components/fragments/delete-folder-dialog.svelte';
	import CreateFolderDialog from '$lib/components/fragments/create-folder-dialog.svelte';
	import MediaPreviewModal from '$lib/components/fragments/media-preview-modal.svelte';
	import FileBrowser from '$lib/components/fragments/file-browser.svelte';
	import AddAsEmojiDialog from '$lib/components/fragments/add-as-emoji-dialog.svelte';
	import AddAsGifDialog from '$lib/components/fragments/add-as-gif-dialog.svelte';
	import UploadInstanceMediaDialog from '$lib/components/fragments/upload-instance-media-dialog.svelte';
	import { toast } from 'svelte-sonner';
	import { Plus, FolderPlus, Trash2 } from 'lucide-svelte';

	import type { ViewMode, DisplayItem } from '$lib/types/display-item';
	import { getFileItems, uploadsToDisplayItems } from '$lib/types/display-item';

	let { data } = $props();

	const FOLDER_API = '/api/admin/media/folders';

	let viewMode = $state<ViewMode>('list');

	let uploads = $state<UploadWithCompositeId[]>([]);
	let folders = $state<Folder[]>([]);
	let loading = $state(false);
	let error = $state<string | null>(null);

	let currentFolderId = $state<string | null>(null);
	let breadcrumbs = $state<Array<{ id: string; name: string }>>([]);

	let currentPage = $state(1);
	let limit = $state(20);
	let total = $state(0);

	let sortField = $state<'created_at' | 'updated_at' | 'filename' | 'size'>('created_at');
	let sortOrder = $state<'asc' | 'desc'>('desc');

	// Dialog states
	let deleteUploadDialogOpen = $state(false);
	let uploadToDelete = $state<UploadWithCompositeId | null>(null);
	let deleteFolderDialogOpen = $state(false);
	let folderToDelete = $state<Folder | null>(null);
	let uploadDialogOpen = $state(false);
	let createFolderDialogOpen = $state(false);
	let mediaPreviewOpen = $state(false);
	let mediaPreviewIndex = $state(0);

	const fileDisplayItems = $derived(getFileItems(uploadsToDisplayItems(folders, uploads)));

	async function fetchFolders() {
		if (!data.user) return;
		try {
			let qs = '';
			if (currentFolderId) {
				qs = `?parent_id=${encodeURIComponent(currentFolderId)}`;
			}
			const response = await fetch(`${FOLDER_API}${qs}`);
			if (!response.ok) {
				if (currentFolderId) {
					toast.error('Folder not found. Redirected to root.');
					currentFolderId = null;
					return;
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
				return;
			}
			folders = [];
		}
	}

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
			const response = await fetch(`/api/admin/media?${queryParts.join('&')}`);
			if (!response.ok) {
				const errorData = await response.json();
				throw new Error(errorData.error?.message || 'Failed to fetch instance media');
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
	}

	function handleDeleteUpload(upload: UploadWithCompositeId) {
		uploadToDelete = upload;
		deleteUploadDialogOpen = true;
	}

	function handleDeleteFolder(folder: Folder) {
		folderToDelete = folder;
		deleteFolderDialogOpen = true;
	}

	async function resolveDownloadUrl(
		upload: UploadWithCompositeId
	): Promise<{ url: string; isPublic: boolean } | null> {
		if (!upload.did || !upload.local_id) return null;
		try {
			const res = await fetch(
				`/api/admin/media/${encodeURIComponent(upload.did)}/${encodeURIComponent(upload.local_id)}`
			);
			if (!res.ok) return null;
			const json = await res.json();
			const url = json.data?.downloadUrl;
			if (!url) return null;
			return { url, isPublic: json.data?.isPublic ?? false };
		} catch {
			return null;
		}
	}

	async function handleDownload(upload: UploadWithCompositeId) {
		const result = await resolveDownloadUrl(upload);
		if (result) {
			window.open(result.url, '_blank');
		} else {
			toast.error('Download not available');
		}
	}

	async function handleCopyLink(upload: UploadWithCompositeId) {
		const result = await resolveDownloadUrl(upload);
		if (result) {
			try {
				await navigator.clipboard.writeText(result.url);
				toast.success('Link copied to clipboard');
			} catch {
				toast.error('Failed to copy link');
			}
		} else {
			toast.error('Could not resolve download URL');
		}
	}

	// Emoji/Sticker/GIF designation
	let addEmojiOpen = $state(false);
	let addEmojiIsSticker = $state(false);
	let addEmojiUrl = $state<string | null>(null);
	let addEmojiMime = $state<string | null>(null);
	let addEmojiSize = $state(0);
	let addGifOpen = $state(false);
	let addGifUrl = $state<string | null>(null);
	let addGifMime = $state<string | null>(null);
	let addGifSize = $state(0);

	function handleAddAsEmoji(item: DisplayItem) {
		if (item.kind !== 'file') return;
		addEmojiUrl = item.url;
		addEmojiMime = item.mimeType;
		addEmojiSize = item.size;
		addEmojiIsSticker = false;
		addEmojiOpen = true;
	}

	function handleAddAsSticker(item: DisplayItem) {
		if (item.kind !== 'file') return;
		addEmojiUrl = item.url;
		addEmojiMime = item.mimeType;
		addEmojiSize = item.size;
		addEmojiIsSticker = true;
		addEmojiOpen = true;
	}

	function handleAddAsGif(item: DisplayItem) {
		if (item.kind !== 'file') return;
		addGifUrl = item.url;
		addGifMime = item.mimeType;
		addGifSize = item.size;
		addGifOpen = true;
	}

	function handlePreview(_item: DisplayItem, index: number) {
		mediaPreviewIndex = index;
		mediaPreviewOpen = true;
	}

	// --- Instance emojis & GIFs catalog ---
	type EmojiRow = {
		id: string;
		did: string;
		local_id: string;
		shortcode: string;
		url: string;
		is_sticker: boolean;
	};
	type GifRow = {
		id: string;
		did: string;
		local_id: string;
		url: string;
		thumbnail_url: string | null;
		tags: string[];
		size: number;
	};

	let instanceEmojis = $state<EmojiRow[]>([]);
	let emojisLoading = $state(true);
	let instanceGifs = $state<GifRow[]>([]);
	let gifsLoading = $state(true);

	async function loadInstanceEmojis() {
		emojisLoading = true;
		try {
			const res = await fetch('/api/admin/emojis?limit=200');
			if (res.ok) {
				const json = await res.json();
				if (json.status === 'success') instanceEmojis = json.data ?? [];
			}
		} finally {
			emojisLoading = false;
		}
	}

	async function deleteInstanceEmoji(did: string, localId: string) {
		try {
			const res = await fetch(
				`/api/admin/emojis/${encodeURIComponent(did)}/${encodeURIComponent(localId)}`,
				{ method: 'DELETE' }
			);
			if (!res.ok) {
				toast.error('Failed to delete emoji');
				return;
			}
			toast.success('Emoji deleted');
			loadInstanceEmojis();
		} catch {
			toast.error('Failed to delete emoji');
		}
	}

	async function loadInstanceGifs() {
		gifsLoading = true;
		try {
			const res = await fetch('/api/admin/gifs?limit=100');
			if (res.ok) {
				const json = await res.json();
				if (json.status === 'success') instanceGifs = json.data ?? [];
			}
		} finally {
			gifsLoading = false;
		}
	}

	async function deleteInstanceGif(did: string, localId: string) {
		try {
			const res = await fetch(
				`/api/admin/gifs/${encodeURIComponent(did)}/${encodeURIComponent(localId)}`,
				{ method: 'DELETE' }
			);
			if (!res.ok) {
				toast.error('Failed to delete GIF');
				return;
			}
			toast.success('GIF deleted');
			loadInstanceGifs();
		} catch {
			toast.error('Failed to delete GIF');
		}
	}

	function fmtSize(bytes: number): string {
		if (bytes <= 0) return '—';
		return `${(bytes / 1024).toFixed(1)} KB`;
	}

	// Load catalogs on mount
	$effect(() => {
		loadInstanceEmojis();
		loadInstanceGifs();
	});

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
	<title>Instance Media | Settings | SYR</title>
</svelte:head>

{#if data.user}
	<div class="space-y-6">
		<div class="space-y-1">
			<h1 class="text-2xl font-semibold tracking-tight">Instance Media</h1>
			<p class="text-sm text-muted-foreground">
				Shared media storage for instance-wide emojis, stickers, and GIFs. Files uploaded here are
				public and accessible to all users. Use the file menu to designate uploads as emojis or
				GIFs.
			</p>
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
			onAddAsEmoji={handleAddAsEmoji}
			onAddAsSticker={handleAddAsSticker}
			onAddAsGif={handleAddAsGif}
		>
			{#snippet actions()}
				<Button variant="outline" onclick={() => (createFolderDialogOpen = true)}>
					<FolderPlus class="mr-2 h-4 w-4" />
					New Folder
				</Button>
				<Button onclick={() => (uploadDialogOpen = true)}>
					<Plus class="mr-2 h-4 w-4" />
					Upload
				</Button>
			{/snippet}
		</FileBrowser>

		<DeleteUploadDialog
			upload={uploadToDelete}
			bind:open={deleteUploadDialogOpen}
			onSuccess={refreshData}
			adminMediaMode
		/>
		<DeleteFolderDialog
			folderId={folderToDelete?.id?.toString() ?? null}
			folderName={folderToDelete?.name ?? null}
			apiBase={FOLDER_API}
			bind:open={deleteFolderDialogOpen}
			onSuccess={refreshData}
		/>
		<CreateFolderDialog
			parentId={currentFolderId}
			parentName={breadcrumbs.length > 0 ? breadcrumbs[breadcrumbs.length - 1]?.name : null}
			apiBase={FOLDER_API}
			bind:open={createFolderDialogOpen}
			onSuccess={refreshData}
		/>
		<UploadInstanceMediaDialog
			{currentFolderId}
			bind:open={uploadDialogOpen}
			onSuccess={refreshData}
		/>
		<MediaPreviewModal
			bind:open={mediaPreviewOpen}
			items={fileDisplayItems}
			initialIndex={mediaPreviewIndex}
		/>
		<AddAsEmojiDialog
			bind:open={addEmojiOpen}
			imageUrl={addEmojiUrl}
			mimeType={addEmojiMime}
			fileSize={addEmojiSize}
			isSticker={addEmojiIsSticker}
			scope="instance"
			onSuccess={loadInstanceEmojis}
		/>
		<AddAsGifDialog
			bind:open={addGifOpen}
			imageUrl={addGifUrl}
			mimeType={addGifMime}
			fileSize={addGifSize}
			scope="instance"
			onSuccess={loadInstanceGifs}
		/>

		<Card.Root>
			<Card.Header>
				<Card.Title>Instance Emojis & Stickers</Card.Title>
				<Card.Description>
					Emojis and stickers available to all users on this instance. Upload an image above and
					select "Add as Emoji" or "Add as Sticker" from its menu.
				</Card.Description>
			</Card.Header>
			<Card.Content>
				<Table.Root>
					<Table.Header>
						<Table.Row>
							<Table.Head>Preview</Table.Head>
							<Table.Head>Shortcode</Table.Head>
							<Table.Head>Type</Table.Head>
							<Table.Head class="text-right">Actions</Table.Head>
						</Table.Row>
					</Table.Header>
					<Table.Body>
						{#if emojisLoading}
							<Table.Row>
								<Table.Cell colspan={4} class="py-4 text-center text-muted-foreground"
									>Loading...</Table.Cell
								>
							</Table.Row>
						{:else if instanceEmojis.length === 0}
							<Table.Row>
								<Table.Cell colspan={4} class="py-4 text-center text-muted-foreground"
									>No instance emojis yet.</Table.Cell
								>
							</Table.Row>
						{:else}
							{#each instanceEmojis as emoji (emoji.id)}
								<Table.Row>
									<Table.Cell>
										{#if emoji.url}
											<img src={emoji.url} alt={emoji.shortcode} class="h-8 w-8 object-contain" />
										{:else}
											<span class="text-xs text-muted-foreground">No image</span>
										{/if}
									</Table.Cell>
									<Table.Cell class="font-mono text-sm">:{emoji.shortcode}:</Table.Cell>
									<Table.Cell class="text-xs">{emoji.is_sticker ? 'Sticker' : 'Emoji'}</Table.Cell>
									<Table.Cell class="text-right">
										<Button
											variant="destructive"
											size="sm"
											onclick={() => deleteInstanceEmoji(emoji.did, emoji.local_id)}
										>
											<Trash2 class="h-3.5 w-3.5" />
										</Button>
									</Table.Cell>
								</Table.Row>
							{/each}
						{/if}
					</Table.Body>
				</Table.Root>
			</Card.Content>
		</Card.Root>

		<Card.Root>
			<Card.Header>
				<Card.Title>Instance GIF Library</Card.Title>
				<Card.Description>
					GIFs available to all users on this instance. Upload a GIF above and select "Add as GIF"
					from its menu.
				</Card.Description>
			</Card.Header>
			<Card.Content>
				<Table.Root>
					<Table.Header>
						<Table.Row>
							<Table.Head>Preview</Table.Head>
							<Table.Head>Tags</Table.Head>
							<Table.Head>Size</Table.Head>
							<Table.Head class="text-right">Actions</Table.Head>
						</Table.Row>
					</Table.Header>
					<Table.Body>
						{#if gifsLoading}
							<Table.Row>
								<Table.Cell colspan={4} class="py-4 text-center text-muted-foreground"
									>Loading...</Table.Cell
								>
							</Table.Row>
						{:else if instanceGifs.length === 0}
							<Table.Row>
								<Table.Cell colspan={4} class="py-4 text-center text-muted-foreground"
									>No instance GIFs yet.</Table.Cell
								>
							</Table.Row>
						{:else}
							{#each instanceGifs as gif (gif.id)}
								<Table.Row>
									<Table.Cell>
										{#if gif.url || gif.thumbnail_url}
											<img
												src={gif.thumbnail_url ?? gif.url}
												alt="GIF"
												class="h-12 w-12 rounded object-cover"
											/>
										{:else}
											<span class="text-xs text-muted-foreground">No preview</span>
										{/if}
									</Table.Cell>
									<Table.Cell class="text-xs">{gif.tags.join(', ') || '—'}</Table.Cell>
									<Table.Cell class="text-xs">{fmtSize(gif.size)}</Table.Cell>
									<Table.Cell class="text-right">
										<Button
											variant="destructive"
											size="sm"
											onclick={() => deleteInstanceGif(gif.did, gif.local_id)}
										>
											<Trash2 class="h-3.5 w-3.5" />
										</Button>
									</Table.Cell>
								</Table.Row>
							{/each}
						{/if}
					</Table.Body>
				</Table.Root>
			</Card.Content>
		</Card.Root>
	</div>
{:else}
	<div class="flex h-full items-center justify-center p-4 sm:p-6">
		<Card.Root class="max-w-md">
			<Card.Header>
				<Card.Title>Admin access required</Card.Title>
				<Card.Description>Only administrators can manage instance media.</Card.Description>
			</Card.Header>
		</Card.Root>
	</div>
{/if}
