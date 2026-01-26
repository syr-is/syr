<script lang="ts">
	import * as Dialog from '$lib/components/ui/dialog';
	import * as Accordion from '$lib/components/ui/accordion';
	import { Button } from '$lib/components/ui/button';
	import { Label } from '$lib/components/ui/label';
	import type { Upload, Folder } from '@syr-is/types';
	import { toast } from 'svelte-sonner';
	import {
		Loader2,
		Home,
		FolderIcon,
		Globe,
		Circle,
		CircleCheck,
		TriangleAlert,
		Trash2,
		FolderPlus
	} from 'lucide-svelte';
	import { SvelteMap, SvelteSet } from 'svelte/reactivity';
	import CreateFolderDialog from './create-folder-dialog.svelte';
	import DeleteFolderDialog from './delete-folder-dialog.svelte';

	interface FolderNode extends Folder {
		children: FolderNode[];
		childrenLoaded: boolean;
	}

	let {
		upload = null,
		open = $bindable(false),
		onSuccess
	}: {
		upload?: Upload | null;
		open?: boolean;
		onSuccess?: () => void;
	} = $props();

	let targetFolderId = $state<string>('');
	let folderNodes = new SvelteMap<string, FolderNode>();
	let rootFolderIds = $state<string[]>([]);
	let loadingFolders = $state(false);
	let loadingFolderIds = new SvelteSet<string>();
	let expandedFolderIds = $state<string[]>([]);
	let moving = $state(false);

	// Create folder dialog state
	let createFolderOpen = $state(false);
	let createFolderParentId = $state<string | null>(null);
	let createFolderParentName = $state<string | null>(null);

	// Delete folder dialog state
	let deleteFolderOpen = $state(false);
	let deleteFolderId = $state<string | null>(null);
	let deleteFolderName = $state<string | null>(null);

	// Get root folders sorted by name
	const rootFolders = $derived(
		rootFolderIds
			.map((id) => folderNodes.get(id))
			.filter((node): node is FolderNode => node !== undefined)
			.sort((a, b) => a.name.localeCompare(b.name))
	);

	function getSelectedFolderPath(): string {
		if (!targetFolderId) return 'Root';
		const folder = folderNodes.get(targetFolderId);
		if (!folder) return 'Select folder';

		const path: string[] = [folder.name];
		let current: FolderNode | undefined = folder;
		while (current?.parent_id) {
			const parent = folderNodes.get(current.parent_id.toString());
			if (parent) {
				path.unshift(parent.name);
				current = parent;
			} else {
				break;
			}
		}
		return path.join(' / ');
	}

	async function fetchFolders(parentId: string | null = null): Promise<Folder[]> {
		const queryString = parentId ? `?parent_id=${encodeURIComponent(parentId)}` : '';
		const response = await fetch(`/api/folders${queryString}`);
		if (!response.ok) return [];

		const result = await response.json();
		return result.data?.folders || [];
	}

	async function fetchRootFolders() {
		loadingFolders = true;
		try {
			const folders = await fetchFolders(null);
			folderNodes.clear();
			const newRootFolderIds: string[] = [];

			for (const folder of folders) {
				const id = folder.id.toString();
				folderNodes.set(id, { ...folder, children: [], childrenLoaded: false });
				newRootFolderIds.push(id);
			}

			rootFolderIds = newRootFolderIds;

			if (rootFolderIds.length > 0) {
				await Promise.all(rootFolderIds.map((id) => fetchChildrenForFolder(id)));
			}

			expandedFolderIds = [];
		} catch {
			folderNodes.clear();
			rootFolderIds = [];
		} finally {
			loadingFolders = false;
		}
	}

	async function fetchChildrenForFolder(folderId: string) {
		const node = folderNodes.get(folderId);
		if (!node || node.childrenLoaded) return;

		loadingFolderIds.add(folderId);

		try {
			const children = await fetchFolders(folderId);

			for (const child of children) {
				const childId = child.id.toString();
				const childNode: FolderNode = { ...child, children: [], childrenLoaded: false };
				folderNodes.set(childId, childNode);
				node.children.push(childNode);
			}

			node.children.sort((a, b) => a.name.localeCompare(b.name));
			node.childrenLoaded = true;
		} finally {
			loadingFolderIds.delete(folderId);
		}
	}

	function handleAccordionChange(folderId: string, expanded: string[]) {
		const isExpanded = expanded.includes(folderId);
		if (isExpanded) {
			if (!expandedFolderIds.includes(folderId)) {
				expandedFolderIds = [...expandedFolderIds, folderId];
			}
			const node = folderNodes.get(folderId);
			if (node && !node.childrenLoaded) {
				fetchChildrenForFolder(folderId);
			}
		} else {
			expandedFolderIds = expandedFolderIds.filter((id) => id !== folderId);
		}
	}

	async function handleMove() {
		if (!upload) return;

		moving = true;
		try {
			const uploadId = typeof upload.id === 'string' ? upload.id : upload.id.toString();
			const response = await fetch(`/api/uploads/${uploadId}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					folder_id: targetFolderId || null
				})
			});

			if (!response.ok) {
				const errorData = await response.json();
				throw new Error(errorData.error?.message || 'Failed to move file');
			}

			toast.success('File moved successfully');
			open = false;
			onSuccess?.();
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Failed to move file');
		} finally {
			moving = false;
		}
	}

	function openCreateFolderDialog() {
		const selectedFolder = targetFolderId ? folderNodes.get(targetFolderId) : null;
		createFolderParentId = targetFolderId || null;
		createFolderParentName = selectedFolder?.name || null;
		createFolderOpen = true;
	}

	function openDeleteFolderDialog(folderId: string, folderName: string) {
		deleteFolderId = folderId;
		deleteFolderName = folderName;
		deleteFolderOpen = true;
	}

	async function handleFolderCreated() {
		await fetchRootFolders();
		// Expand the parent folder to show the new folder
		if (createFolderParentId && !expandedFolderIds.includes(createFolderParentId)) {
			expandedFolderIds = [...expandedFolderIds, createFolderParentId];
		}
	}

	async function handleFolderDeleted() {
		// Clear selection if deleted folder was selected
		if (targetFolderId === deleteFolderId) {
			targetFolderId = '';
		}
		await fetchRootFolders();
	}

	$effect(() => {
		if (open) {
			targetFolderId = '';
			expandedFolderIds = [];
			fetchRootFolders();
		}
	});
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="max-w-md">
		<Dialog.Header>
			<Dialog.Title>Move File</Dialog.Title>
			<Dialog.Description>
				Move "{upload?.filename}" to a different folder.
			</Dialog.Description>
		</Dialog.Header>
		<div class="py-4">
			<div class="flex flex-col gap-2">
				<div class="flex items-center justify-between">
					<Label>Destination Folder</Label>
					<Button
						variant="ghost"
						size="sm"
						class="h-7 gap-1 text-xs"
						onclick={openCreateFolderDialog}
					>
						<FolderPlus class="h-3.5 w-3.5" />
						New Folder
					</Button>
				</div>
				<div class="text-muted-foreground mb-2 text-sm">
					Selected: <span class="text-foreground font-medium">{getSelectedFolderPath()}</span>
				</div>

				<div class="border-input max-h-64 overflow-y-auto rounded-md border p-2">
					{#if loadingFolders}
						<div class="flex items-center justify-center py-4">
							<Loader2 class="text-muted-foreground h-5 w-5 animate-spin" />
						</div>
					{:else}
						<button
							type="button"
							class="hover:bg-accent flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors"
							onclick={() => (targetFolderId = '')}
						>
							{#if targetFolderId === ''}
								<CircleCheck class="text-primary h-4 w-4" />
							{:else}
								<Circle class="text-muted-foreground h-4 w-4" />
							{/if}
							<Home class="h-4 w-4" />
							<span>Root</span>
						</button>

						{#if rootFolders.length > 0}
							{#snippet renderFolderNode(node: FolderNode, depth: number)}
								{@const nodeId = node.id.toString()}
								{@const isLoading = loadingFolderIds.has(nodeId)}
								{@const hasLoadedChildren = node.childrenLoaded && node.children.length > 0}
								{@const showExpandable = !node.childrenLoaded || hasLoadedChildren}

								{#if showExpandable}
									<Accordion.Root
										type="multiple"
										class="w-full"
										value={expandedFolderIds}
										onValueChange={(expanded) => handleAccordionChange(nodeId, expanded)}
									>
										<Accordion.Item value={nodeId} class="border-b-0">
											<div class="group flex items-center" style="padding-left: {depth * 16}px">
												<button
													type="button"
													class="hover:bg-accent flex flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors"
													onclick={() => (targetFolderId = nodeId)}
												>
													{#if targetFolderId === nodeId}
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
												<button
													type="button"
													class="hover:bg-destructive/10 hover:text-destructive rounded p-1 opacity-0 transition-opacity group-hover:opacity-100"
													onclick={(e) => {
														e.stopPropagation();
														openDeleteFolderDialog(nodeId, node.name);
													}}
													title="Delete folder"
												>
													<Trash2 class="h-3.5 w-3.5" />
												</button>
												<Accordion.Trigger
													class="px-2 py-1.5 hover:no-underline [&>svg]:h-4 [&>svg]:w-4"
												/>
											</div>
											<Accordion.Content class="pb-0">
												{#if isLoading}
													<div
														class="text-muted-foreground flex items-center gap-2 py-2 text-sm"
														style="padding-left: {(depth + 1) * 16 + 8}px"
													>
														<Loader2 class="h-4 w-4 animate-spin" />
														<span>Loading...</span>
													</div>
												{:else if node.childrenLoaded && node.children.length === 0}
													<div
														class="text-muted-foreground py-2 text-sm"
														style="padding-left: {(depth + 1) * 16 + 8}px"
													>
														No subfolders
													</div>
												{:else}
													{#each node.children as child (child.id.toString())}
														{@render renderFolderNode(child, depth + 1)}
													{/each}
												{/if}
											</Accordion.Content>
										</Accordion.Item>
									</Accordion.Root>
								{:else}
									<div class="group flex items-center" style="padding-left: {depth * 16}px">
										<button
											type="button"
											class="hover:bg-accent flex flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors"
											onclick={() => (targetFolderId = nodeId)}
										>
											{#if targetFolderId === nodeId}
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
										<button
											type="button"
											class="hover:bg-destructive/10 hover:text-destructive rounded p-1 opacity-0 transition-opacity group-hover:opacity-100"
											onclick={(e) => {
												e.stopPropagation();
												openDeleteFolderDialog(nodeId, node.name);
											}}
											title="Delete folder"
										>
											<Trash2 class="h-3.5 w-3.5" />
										</button>
									</div>
								{/if}
							{/snippet}
							{#each rootFolders as node (node.id.toString())}
								{@render renderFolderNode(node, 0)}
							{/each}
						{/if}
					{/if}
				</div>
			</div>
			<div
				class="bg-destructive/10 text-destructive mt-4 flex items-start gap-2 rounded-md p-3 text-sm"
			>
				<TriangleAlert class="mt-0.5 h-4 w-4 shrink-0" />
				<span
					>Moving this file will break any existing share links and external references to it.</span
				>
			</div>
		</div>
		<Dialog.Footer>
			<Button variant="outline" onclick={() => (open = false)}>Cancel</Button>
			<Button onclick={handleMove} disabled={moving}>
				{moving ? 'Moving...' : 'Move File'}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>

<!-- Create folder dialog -->
<CreateFolderDialog
	bind:open={createFolderOpen}
	parentId={createFolderParentId}
	parentName={createFolderParentName}
	onSuccess={handleFolderCreated}
/>

<!-- Delete folder dialog -->
<DeleteFolderDialog
	bind:open={deleteFolderOpen}
	folderId={deleteFolderId}
	folderName={deleteFolderName}
	onSuccess={handleFolderDeleted}
/>
