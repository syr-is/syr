<script lang="ts">
	import * as Select from '@syr-is/ui/select';
	import * as Pagination from '@syr-is/ui/pagination';
	import * as Card from '@syr-is/ui/card';
	import { Button } from '@syr-is/ui/button';
	import { Skeleton } from '@syr-is/ui/skeleton';
	import { ChevronRight, Home, File } from 'lucide-svelte';
	import ViewModeToggle from '$lib/components/fragments/view-mode-toggle.svelte';
	import FileTable from '$lib/components/fragments/file-table.svelte';
	import FileGrid from '$lib/components/fragments/file-grid.svelte';
	import FileCarousel from '$lib/components/fragments/file-carousel.svelte';
	import MediaCardGrid from '$lib/components/fragments/media-card-grid.svelte';
	import FolderCard from '$lib/components/fragments/folder-card.svelte';
	import {
		type ViewMode,
		type DisplayItem,
		uploadsToDisplayItems,
		getFileItems
	} from '$lib/types/display-item';
	import type { UploadWithCompositeId, Folder } from '@syr-is/types';
	import type { Snippet } from 'svelte';

	let {
		folders = [],
		uploads = [],
		breadcrumbs = [],
		loading = false,
		error = null,
		total = 0,
		viewMode = $bindable<ViewMode>('list'),
		currentPage = $bindable(1),
		limit = $bindable(20),
		sortField = $bindable<'created_at' | 'updated_at' | 'filename' | 'size'>('created_at'),
		sortOrder = $bindable<'asc' | 'desc'>('desc'),
		readonly = false,
		actions,
		onNavigateFolder,
		onDeleteUpload,
		onDeleteFolder,
		onPreview,
		onDownload,
		onCopyLink,
		onRename,
		onMove
	}: {
		folders?: Folder[];
		uploads?: UploadWithCompositeId[];
		breadcrumbs?: Array<{ id: string; name: string }>;
		loading?: boolean;
		error?: string | null;
		total?: number;
		viewMode?: ViewMode;
		currentPage?: number;
		limit?: number;
		sortField?: 'created_at' | 'updated_at' | 'filename' | 'size';
		sortOrder?: 'asc' | 'desc';
		readonly?: boolean;
		actions?: Snippet;
		onNavigateFolder?: (folderId: string | null) => void;
		onDeleteUpload?: (upload: UploadWithCompositeId) => void;
		onDeleteFolder?: (folder: Folder) => void;
		onPreview?: (item: DisplayItem, index: number) => void;
		onDownload?: (upload: UploadWithCompositeId) => void;
		onCopyLink?: (upload: UploadWithCompositeId) => void;
		onRename?: (upload: UploadWithCompositeId) => void;
		onMove?: (upload: UploadWithCompositeId) => void;
	} = $props();

	const displayItems = $derived(uploadsToDisplayItems(folders, uploads));
	const fileDisplayItems = $derived(getFileItems(displayItems));
	const totalPages = $derived(Math.ceil(total / limit));

	function isPublicFolder(folder: Folder): boolean {
		return folder.name.toLowerCase() === 'public';
	}

	function handleFolderClick(folder: Folder) {
		const id = typeof folder.id === 'string' ? folder.id : folder.id.toString();
		onNavigateFolder?.(id);
	}

	function handleFolderDelete(folder: Folder) {
		onDeleteFolder?.(folder);
	}

	function handleTablePreview(item: DisplayItem) {
		if (item.kind !== 'file') return;
		const index = fileDisplayItems.findIndex((di) => di.id === item.id);
		if (index >= 0) onPreview?.(item, index);
	}

	function handleTableDownload(item: DisplayItem) {
		if (item.kind === 'file') onDownload?.(item.data);
	}

	function handleTableCopyLink(item: DisplayItem) {
		if (item.kind === 'file') onCopyLink?.(item.data);
	}

	function handleTableRename(item: DisplayItem) {
		if (item.kind === 'file') onRename?.(item.data);
	}

	function handleTableMove(item: DisplayItem) {
		if (item.kind === 'file') onMove?.(item.data);
	}

	function handleTableDelete(item: DisplayItem) {
		if (item.kind === 'file') onDeleteUpload?.(item.data);
	}

	function handleGridItemClick(index: number) {
		const item = fileDisplayItems[index];
		if (item) onPreview?.(item, index);
	}

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
</script>

<div class="space-y-4">
	<!-- Breadcrumbs -->
	<nav class="flex min-w-0 flex-nowrap items-center gap-1 overflow-x-auto text-sm">
		<Button
			variant="ghost"
			size="sm"
			class="h-8 gap-1 px-2"
			onclick={() => onNavigateFolder?.(null)}
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
				onclick={() => onNavigateFolder?.(crumb.id)}
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
							{#each pages as pg (pg.key)}
								{#if pg.type === 'ellipsis'}
									<Pagination.Item>
										<Pagination.Ellipsis />
									</Pagination.Item>
								{:else}
									<Pagination.Item>
										<Pagination.Link page={pg} isActive={activePage === pg.value}>
											{pg.value}
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
				availableModes={['list', 'gallery', 'masonry', 'carousel', 'cards']}
			/>
			<span class="text-sm text-muted-foreground">
				{total} file{total !== 1 ? 's' : ''} total
			</span>
			{#if actions}
				{@render actions()}
			{/if}
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
					<p class="text-sm text-muted-foreground">This folder is empty</p>
				</div>
			</Card.Content>
		</Card.Root>
	{:else if viewMode === 'list'}
		<FileTable
			items={displayItems}
			onPreview={onPreview ? handleTablePreview : undefined}
			onDownload={onDownload ? handleTableDownload : undefined}
			onCopyLink={onCopyLink ? handleTableCopyLink : undefined}
			onRename={!readonly && onRename ? handleTableRename : undefined}
			onMove={!readonly && onMove ? handleTableMove : undefined}
			onDelete={onDeleteUpload ? handleTableDelete : undefined}
			onFolderClick={handleFolderClick}
			onFolderDelete={!readonly ? handleFolderDelete : undefined}
		/>
	{:else if viewMode === 'carousel'}
		{#if folders.length > 0}
			<div class="mb-4 grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
				{#each folders as folder (folder.id.toString())}
					<FolderCard
						{folder}
						isPublic={isPublicFolder(folder)}
						onclick={() => handleFolderClick(folder)}
						onDelete={!readonly ? handleFolderDelete : undefined}
					/>
				{/each}
			</div>
		{/if}
		<FileCarousel items={fileDisplayItems} onItemClick={handleGridItemClick} />
	{:else if viewMode === 'cards'}
		{#if folders.length > 0}
			<div class="mb-4 grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
				{#each folders as folder (folder.id.toString())}
					<FolderCard
						{folder}
						isPublic={isPublicFolder(folder)}
						onclick={() => handleFolderClick(folder)}
						onDelete={!readonly ? handleFolderDelete : undefined}
					/>
				{/each}
			</div>
		{/if}
		<MediaCardGrid items={fileDisplayItems} onItemClick={handleGridItemClick} />
	{:else}
		<FileGrid
			items={displayItems}
			mode={viewMode === 'gallery' ? 'gallery' : 'masonry'}
			onItemClick={handleGridItemClick}
			onFolderClick={handleFolderClick}
			onFolderDelete={!readonly ? handleFolderDelete : undefined}
		/>
	{/if}
</div>
