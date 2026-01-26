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
		TriangleAlert
	} from 'lucide-svelte';

	interface FolderNode extends Folder {
		children: FolderNode[];
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
	let allFolders = $state<Folder[]>([]);
	let loadingFolders = $state(false);
	let moving = $state(false);

	// Build folder tree from flat list
	function buildFolderTree(folders: Folder[]): FolderNode[] {
		const folderMap: Record<string, FolderNode> = {};
		const rootFolders: FolderNode[] = [];

		for (const folder of folders) {
			folderMap[folder.id.toString()] = { ...folder, children: [] };
		}

		for (const folder of folders) {
			const node = folderMap[folder.id.toString()];
			if (folder.parent_id) {
				const parent = folderMap[folder.parent_id.toString()];
				if (parent) {
					parent.children.push(node);
				} else {
					rootFolders.push(node);
				}
			} else {
				rootFolders.push(node);
			}
		}

		const sortChildren = (nodes: FolderNode[]) => {
			nodes.sort((a, b) => a.name.localeCompare(b.name));
			for (const node of nodes) {
				sortChildren(node.children);
			}
		};
		sortChildren(rootFolders);

		return rootFolders;
	}

	const folderTree = $derived(buildFolderTree(allFolders));

	function getSelectedFolderPath(): string {
		if (!targetFolderId) return 'Root';
		const folder = allFolders.find((f) => f.id.toString() === targetFolderId);
		if (!folder) return 'Select folder';

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

	async function fetchAllFoldersRecursive(parentId: string | null = null): Promise<Folder[]> {
		const queryString = parentId ? `?parent_id=${encodeURIComponent(parentId)}` : '';
		const response = await fetch(`/api/folders${queryString}`);
		if (!response.ok) return [];

		const result = await response.json();
		const folders: Folder[] = result.data?.folders || [];

		const allFolders: Folder[] = [...folders];
		for (const folder of folders) {
			const children = await fetchAllFoldersRecursive(folder.id.toString());
			allFolders.push(...children);
		}

		return allFolders;
	}

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

	function handleOpenChange(newOpen: boolean) {
		open = newOpen;
		if (newOpen) {
			targetFolderId = '';
			fetchAllFolders();
		}
	}
</script>

<Dialog.Root bind:open onOpenChange={handleOpenChange}>
	<Dialog.Content class="max-w-md">
		<Dialog.Header>
			<Dialog.Title>Move File</Dialog.Title>
			<Dialog.Description>
				Move "{upload?.filename}" to a different folder.
			</Dialog.Description>
		</Dialog.Header>
		<div class="py-4">
			<div class="flex flex-col gap-2">
				<Label>Destination Folder</Label>
				<div class="mb-2 text-sm text-muted-foreground">
					Selected: <span class="font-medium text-foreground">{getSelectedFolderPath()}</span>
				</div>
				<div class="max-h-64 overflow-y-auto rounded-md border border-input p-2">
					{#if loadingFolders}
						<div class="flex items-center justify-center py-4">
							<Loader2 class="h-5 w-5 animate-spin text-muted-foreground" />
						</div>
					{:else}
						<button
							type="button"
							class="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent"
							onclick={() => (targetFolderId = '')}
						>
							{#if targetFolderId === ''}
								<CircleCheck class="h-4 w-4 text-primary" />
							{:else}
								<Circle class="h-4 w-4 text-muted-foreground" />
							{/if}
							<Home class="h-4 w-4" />
							<span>Root</span>
						</button>

						{#if folderTree.length > 0}
							{#snippet renderFolderNode(node: FolderNode, depth: number)}
								{#if node.children.length > 0}
									<Accordion.Root type="multiple" class="w-full">
										<Accordion.Item value={node.id.toString()} class="border-b-0">
											<div class="flex items-center" style="padding-left: {depth * 16}px">
												<button
													type="button"
													class="flex flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent"
													onclick={() => (targetFolderId = node.id.toString())}
												>
													{#if targetFolderId === node.id.toString()}
														<CircleCheck class="h-4 w-4 shrink-0 text-primary" />
													{:else}
														<Circle class="h-4 w-4 shrink-0 text-muted-foreground" />
													{/if}
													{#if node.name.toLowerCase() === 'public'}
														<Globe class="h-4 w-4 shrink-0 text-primary" />
													{:else}
														<FolderIcon class="h-4 w-4 shrink-0 text-muted-foreground" />
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
									<div style="padding-left: {depth * 16}px">
										<button
											type="button"
											class="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent"
											onclick={() => (targetFolderId = node.id.toString())}
										>
											{#if targetFolderId === node.id.toString()}
												<CircleCheck class="h-4 w-4 shrink-0 text-primary" />
											{:else}
												<Circle class="h-4 w-4 shrink-0 text-muted-foreground" />
											{/if}
											{#if node.name.toLowerCase() === 'public'}
												<Globe class="h-4 w-4 shrink-0 text-primary" />
											{:else}
												<FolderIcon class="h-4 w-4 shrink-0 text-muted-foreground" />
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
			<div
				class="mt-4 flex items-start gap-2 rounded-md bg-destructive/10 p-3 text-sm text-destructive"
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
