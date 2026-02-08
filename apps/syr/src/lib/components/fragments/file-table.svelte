<script lang="ts">
	import * as Table from '$lib/components/ui/table';
	import * as Card from '$lib/components/ui/card';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
	import { Button } from '$lib/components/ui/button';
	import { Badge } from '$lib/components/ui/badge';
	import {
		FileImage,
		FileText,
		FileVideo,
		FileAudio,
		File,
		Eye,
		Link,
		Download,
		FolderIcon,
		Globe,
		Lock,
		MoreVertical,
		Move,
		Pencil,
		Trash2
	} from 'lucide-svelte';
	import { type DisplayItem, getItemMediaType, getItemFilename } from '$lib/types/display-item';
	import { getMediaType, type MediaType } from '$lib/utils/media';

	let {
		items,
		onPreview,
		onDownload,
		onCopyLink,
		onRename,
		onMove,
		onDelete,
		onFolderClick,
		onFolderDelete
	}: {
		items: DisplayItem[];
		onPreview?: (item: DisplayItem) => void;
		onDownload?: (item: DisplayItem) => void;
		onCopyLink?: (item: DisplayItem) => void;
		onRename?: (item: DisplayItem) => void;
		onMove?: (item: DisplayItem) => void;
		onDelete?: (item: DisplayItem) => void;
		onFolderClick?: (item: DisplayItem) => void;
		onFolderDelete?: (item: DisplayItem) => void;
	} = $props();

	// Check if any items are full file objects (to show extra columns)
	const hasFileMetadata = $derived(items.some((i) => i.kind === 'file'));

	function getFileIconByMediaType(mediaType: MediaType) {
		if (mediaType === 'image') return FileImage;
		if (mediaType === 'video') return FileVideo;
		if (mediaType === 'audio') return FileAudio;
		return File;
	}

	function getFileIcon(mimeType: string) {
		if (mimeType.startsWith('image/')) return FileImage;
		if (mimeType.startsWith('video/')) return FileVideo;
		if (mimeType.startsWith('audio/')) return FileAudio;
		if (mimeType.startsWith('text/') || mimeType.includes('document') || mimeType.includes('pdf'))
			return FileText;
		return File;
	}

	function formatFileSize(bytes: number): string {
		if (bytes === 0) return '0 Bytes';
		const k = 1024;
		const sizes = ['Bytes', 'KB', 'MB', 'GB'];
		const i = Math.floor(Math.log(bytes) / Math.log(k));
		return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
	}

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

	function canPreview(mimeType: string): boolean {
		const mt = getMediaType('', mimeType);
		return mt === 'image' || mt === 'video' || mt === 'audio' || mimeType === 'application/pdf';
	}
</script>

<Card.Root>
	<Card.Content class="p-0">
		<Table.Root>
			<Table.Header>
				<Table.Row>
					<Table.Head class="w-12"></Table.Head>
					<Table.Head>Filename</Table.Head>
					{#if hasFileMetadata}
						<Table.Head>Size</Table.Head>
						<Table.Head>Status</Table.Head>
						<Table.Head>Access</Table.Head>
						<Table.Head>Created</Table.Head>
					{/if}
					<Table.Head class="w-40">Actions</Table.Head>
				</Table.Row>
			</Table.Header>
			<Table.Body>
				{#each items as item (item.id)}
					{#if item.kind === 'folder'}
						<Table.Row class="cursor-pointer hover:bg-accent" onclick={() => onFolderClick?.(item)}>
							<Table.Cell>
								<div class="flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
									{#if item.isPublic}
										<Globe class="h-5 w-5 text-primary" />
									{:else}
										<FolderIcon class="h-5 w-5 text-muted-foreground" />
									{/if}
								</div>
							</Table.Cell>
							<Table.Cell>
								<div class="flex flex-col">
									<span class="max-w-[300px] truncate font-medium">{item.name}</span>
									{#if item.isPublic}
										<span class="text-xs text-muted-foreground">Public folder</span>
									{:else}
										<span class="text-xs text-muted-foreground">Folder</span>
									{/if}
								</div>
							</Table.Cell>
							{#if hasFileMetadata}
								<Table.Cell>--</Table.Cell>
								<Table.Cell>--</Table.Cell>
								<Table.Cell>--</Table.Cell>
								<Table.Cell>--</Table.Cell>
							{/if}
							<Table.Cell>
								<div class="flex items-center gap-1">
									{#if onFolderDelete}
										<Button
											variant="ghost"
											size="sm"
											onclick={(e) => {
												e.stopPropagation();
												onFolderDelete?.(item);
											}}
											title="Delete"
										>
											<Trash2 class="h-4 w-4 text-destructive" />
										</Button>
									{/if}
								</div>
							</Table.Cell>
						</Table.Row>
					{:else if item.kind === 'file'}
						{@const FileIcon = getFileIcon(item.mimeType)}
						<Table.Row>
							<Table.Cell>
								<div class="flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
									<FileIcon class="h-5 w-5 text-muted-foreground" />
								</div>
							</Table.Cell>
							<Table.Cell>
								<div class="flex flex-col">
									<span class="max-w-[300px] truncate font-medium">{item.filename}</span>
									<span class="text-xs text-muted-foreground">{item.mimeType}</span>
								</div>
							</Table.Cell>
							<Table.Cell>
								<span class="text-sm text-muted-foreground">{formatFileSize(item.size)}</span>
							</Table.Cell>
							<Table.Cell>
								<Badge variant={getStatusVariant(item.status)}>
									{item.status}
								</Badge>
							</Table.Cell>
							<Table.Cell>
								{#if item.isPublic}
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
								<span class="text-sm text-muted-foreground">{formatDate(item.createdAt)}</span>
							</Table.Cell>
							<Table.Cell>
								<div class="flex items-center gap-1">
									{#if canPreview(item.mimeType) && item.status === 'completed'}
										<Button
											variant="ghost"
											size="sm"
											onclick={() => onPreview?.(item)}
											title="Preview"
										>
											<Eye class="h-4 w-4" />
										</Button>
									{/if}
									{#if item.status === 'completed' && item.url}
										<Button
											variant="ghost"
											size="sm"
											onclick={() => onCopyLink?.(item)}
											title={item.isPublic ? 'Copy Link' : 'Share'}
										>
											<Link class="h-4 w-4" />
										</Button>
									{/if}
									{#if item.status === 'completed'}
										<Button
											variant="ghost"
											size="sm"
											onclick={() => onDownload?.(item)}
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
											{#if onRename}
												<DropdownMenu.Item onclick={() => onRename?.(item)}>
													<Pencil class="mr-2 h-4 w-4" />
													Rename
												</DropdownMenu.Item>
											{/if}
											{#if onMove}
												<DropdownMenu.Item onclick={() => onMove?.(item)}>
													<Move class="mr-2 h-4 w-4" />
													Move to folder
												</DropdownMenu.Item>
											{/if}
											{#if (onRename || onMove) && onDelete}
												<DropdownMenu.Separator />
											{/if}
											{#if onDelete}
												<DropdownMenu.Item
													class="text-destructive"
													onclick={() => onDelete?.(item)}
												>
													<Trash2 class="mr-2 h-4 w-4" />
													Delete
												</DropdownMenu.Item>
											{/if}
										</DropdownMenu.Content>
									</DropdownMenu.Root>
								</div>
							</Table.Cell>
						</Table.Row>
					{:else}
						<!-- media-url: minimal row -->
						{@const filename = getItemFilename(item)}
						{@const ItemIcon = getFileIconByMediaType(getItemMediaType(item))}
						<Table.Row>
							<Table.Cell>
								<div class="flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
									<ItemIcon class="h-5 w-5 text-muted-foreground" />
								</div>
							</Table.Cell>
							<Table.Cell>
								<span class="max-w-[300px] truncate font-medium">{filename}</span>
							</Table.Cell>
							{#if hasFileMetadata}
								<Table.Cell>--</Table.Cell>
								<Table.Cell>--</Table.Cell>
								<Table.Cell>--</Table.Cell>
								<Table.Cell>--</Table.Cell>
							{/if}
							<Table.Cell>
								<div class="flex items-center gap-1">
									{#if onPreview}
										<Button
											variant="ghost"
											size="sm"
											onclick={() => onPreview?.(item)}
											title="Preview"
										>
											<Eye class="h-4 w-4" />
										</Button>
									{/if}
									<a href={item.url} download={filename}>
										<Button variant="ghost" size="sm" title="Download">
											<Download class="h-4 w-4" />
										</Button>
									</a>
								</div>
							</Table.Cell>
						</Table.Row>
					{/if}
				{/each}
			</Table.Body>
		</Table.Root>
	</Card.Content>
</Card.Root>
