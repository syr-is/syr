<script lang="ts">
	import * as Dialog from '@syr-is/ui/dialog';
	import { Button } from '@syr-is/ui/button';
	import { Input } from '@syr-is/ui/input';
	import * as Select from '@syr-is/ui/select';
	import type { UploadWithCompositeId } from '@syr-is/types';
	import { toast } from 'svelte-sonner';
	import {
		Loader2,
		FileImage,
		FileVideo,
		FileAudio,
		FileText,
		File,
		FileArchive
	} from 'lucide-svelte';
	import MediaThumbnail from './media-thumbnail.svelte';

	let {
		open = $bindable(false),
		onInsert
	}: {
		open?: boolean;
		onInsert?: (item: { url: string; filename: string; mimeType: string }) => void;
	} = $props();

	let allUploads = $state<UploadWithCompositeId[]>([]);
	let loading = $state(false);
	let search = $state('');
	let mimeFilter = $state('all');

	async function loadAllUploads() {
		loading = true;
		allUploads = [];
		try {
			// Fetch all completed uploads across all folders in batches
			let offset = 0;
			const batchSize = 100;
			let hasMore = true;
			const collected: UploadWithCompositeId[] = [];
			while (hasMore) {
				const res = await fetch(
					`/api/uploads?limit=${batchSize}&offset=${offset}&sort_field=created_at&sort_order=desc`
				);
				if (!res.ok) break;
				const json = await res.json();
				const batch = (json.data ?? []) as UploadWithCompositeId[];
				for (const u of batch) {
					if (u.status === 'completed' && u.url) {
						collected.push(u);
					}
				}
				hasMore = json.pagination?.has_more ?? false;
				offset += batchSize;
				// Safety cap
				if (offset > 2000) break;
			}
			allUploads = collected;
		} catch {
			allUploads = [];
		} finally {
			loading = false;
		}
	}

	$effect(() => {
		if (open) {
			search = '';
			mimeFilter = 'all';
			loadAllUploads();
		}
	});

	const filtered = $derived(
		allUploads.filter((u) => {
			if (search.trim()) {
				const q = search.trim().toLowerCase();
				if (!u.filename.toLowerCase().includes(q) && !u.mime_type.toLowerCase().includes(q))
					return false;
			}
			if (mimeFilter === 'image') return u.mime_type.startsWith('image/');
			if (mimeFilter === 'video') return u.mime_type.startsWith('video/');
			if (mimeFilter === 'audio') return u.mime_type.startsWith('audio/');
			if (mimeFilter === 'document')
				return (
					u.mime_type.startsWith('text/') ||
					u.mime_type.includes('pdf') ||
					u.mime_type.includes('document') ||
					u.mime_type.includes('spreadsheet') ||
					u.mime_type.includes('presentation')
				);
			if (mimeFilter === 'other')
				return (
					!u.mime_type.startsWith('image/') &&
					!u.mime_type.startsWith('video/') &&
					!u.mime_type.startsWith('audio/') &&
					!u.mime_type.startsWith('text/') &&
					!u.mime_type.includes('pdf') &&
					!u.mime_type.includes('document')
				);
			return true;
		})
	);

	function getIcon(mime: string) {
		if (mime.startsWith('image/')) return FileImage;
		if (mime.startsWith('video/')) return FileVideo;
		if (mime.startsWith('audio/')) return FileAudio;
		if (mime.startsWith('text/') || mime.includes('pdf') || mime.includes('document'))
			return FileText;
		if (mime.includes('zip') || mime.includes('tar') || mime.includes('archive'))
			return FileArchive;
		return File;
	}

	function selectUpload(u: UploadWithCompositeId) {
		if (!u.url) {
			toast.error('This file has no URL');
			return;
		}
		onInsert?.({ url: u.url, filename: u.filename, mimeType: u.mime_type });
		open = false;
	}

	function fmtSize(bytes: number): string {
		if (bytes <= 0) return '';
		if (bytes < 1024) return `${bytes} B`;
		if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
		return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
	}

	const PAGE_SIZE = 30;
	let page = $state(1);
	$effect(() => {
		// Reset to page 1 when filters change
		void search;
		void mimeFilter;
		page = 1;
	});
	const pagedResults = $derived(filtered.slice(0, page * PAGE_SIZE));
	const hasMorePages = $derived(pagedResults.length < filtered.length);
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="flex max-h-[80vh] max-w-2xl flex-col">
		<Dialog.Header>
			<Dialog.Title>Insert from Uploads</Dialog.Title>
			<Dialog.Description>
				Select a file to insert. Showing {filtered.length} completed
				{filtered.length === 1 ? 'upload' : 'uploads'}.
			</Dialog.Description>
		</Dialog.Header>
		<div class="flex flex-wrap items-center gap-2 border-b pb-3">
			<Input
				type="search"
				placeholder="Search by filename or type..."
				class="h-8 min-w-0 flex-1 text-xs"
				bind:value={search}
			/>
			<Select.Root type="single" bind:value={mimeFilter}>
				<Select.Trigger class="h-8 w-36 text-xs">
					{mimeFilter === 'all'
						? 'All types'
						: mimeFilter === 'image'
							? 'Images'
							: mimeFilter === 'video'
								? 'Video'
								: mimeFilter === 'audio'
									? 'Audio'
									: mimeFilter === 'document'
										? 'Documents'
										: 'Other'}
				</Select.Trigger>
				<Select.Content>
					<Select.Item value="all">All types</Select.Item>
					<Select.Item value="image">Images</Select.Item>
					<Select.Item value="video">Video</Select.Item>
					<Select.Item value="audio">Audio</Select.Item>
					<Select.Item value="document">Documents</Select.Item>
					<Select.Item value="other">Other</Select.Item>
				</Select.Content>
			</Select.Root>
		</div>
		<div class="min-h-0 flex-1 overflow-y-auto py-2">
			{#if loading}
				<div class="flex items-center justify-center py-8">
					<Loader2 class="h-6 w-6 animate-spin text-muted-foreground" />
				</div>
			{:else if filtered.length === 0}
				<p class="py-8 text-center text-sm text-muted-foreground">
					{search.trim() || mimeFilter !== 'all'
						? 'No matching files found.'
						: 'No completed uploads yet.'}
				</p>
			{:else}
				<div class="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
					{#each pagedResults as u (u.id)}
						{@const Icon = getIcon(u.mime_type)}
						<button
							type="button"
							class="group flex flex-col items-center gap-1 rounded-lg border p-2 text-left transition-colors hover:border-primary hover:bg-accent"
							onclick={() => selectUpload(u)}
						>
							<div
								class="relative flex h-20 w-full items-center justify-center overflow-hidden rounded bg-muted/30"
							>
								{#if (u.mime_type.startsWith('image/') || u.mime_type.startsWith('video/') || u.mime_type.startsWith('audio/')) && u.url}
									<MediaThumbnail url={u.url} mimeType={u.mime_type} mode="card" alt={u.filename} />
								{:else}
									<div class="flex flex-col items-center gap-1 text-muted-foreground">
										<Icon class="h-8 w-8" />
										<span class="text-[10px]">{u.mime_type.split('/').pop()}</span>
									</div>
								{/if}
							</div>
							<span class="w-full truncate text-center text-xs font-medium">{u.filename}</span>
							<span class="text-[10px] text-muted-foreground">
								{fmtSize(u.size)}
							</span>
						</button>
					{/each}
				</div>
				{#if hasMorePages}
					<div class="mt-3 flex justify-center">
						<Button variant="outline" size="sm" onclick={() => page++}>
							Show more ({filtered.length - pagedResults.length} remaining)
						</Button>
					</div>
				{/if}
			{/if}
		</div>
		<Dialog.Footer>
			<Button variant="outline" onclick={() => (open = false)}>Cancel</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
