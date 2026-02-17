<script lang="ts">
	import * as Dialog from '@syr-is/ui/dialog';
	import { Button } from '@syr-is/ui/button';
	import { Input } from '@syr-is/ui/input';
	import { Label } from '@syr-is/ui/label';
	import { toast } from 'svelte-sonner';
	import { Loader2, FolderPlus } from 'lucide-svelte';

	let {
		open = $bindable(false),
		parentId = null,
		parentName = null,
		onSuccess
	}: {
		open?: boolean;
		parentId?: string | null;
		parentName?: string | null;
		onSuccess?: () => void;
	} = $props();

	let folderName = $state('');
	let creating = $state(false);

	async function handleCreate() {
		if (!folderName.trim()) {
			toast.error('Please enter a folder name');
			return;
		}

		creating = true;
		try {
			const response = await fetch('/api/folders', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					name: folderName.trim(),
					parent_id: parentId
				})
			});

			if (!response.ok) {
				const errorData = await response.json();
				throw new Error(errorData.error?.message || 'Failed to create folder');
			}

			toast.success('Folder created successfully');
			open = false;
			onSuccess?.();
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Failed to create folder');
		} finally {
			creating = false;
		}
	}

	// Reset state when dialog opens
	$effect(() => {
		if (open) {
			folderName = '';
		}
	});
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="max-w-sm">
		<Dialog.Header>
			<Dialog.Title class="flex items-center gap-2">
				<FolderPlus class="h-5 w-5" />
				Create New Folder
			</Dialog.Title>
			<Dialog.Description>
				{#if parentName}
					Create a new folder inside "{parentName}".
				{:else}
					Create a new folder at the root level.
				{/if}
			</Dialog.Description>
		</Dialog.Header>
		<div class="py-4">
			<div class="flex flex-col gap-2">
				<Label for="folder-name">Folder Name</Label>
				<Input
					id="folder-name"
					type="text"
					placeholder="Enter folder name"
					bind:value={folderName}
					onkeydown={(e) => e.key === 'Enter' && !creating && handleCreate()}
					disabled={creating}
				/>
			</div>
		</div>
		<Dialog.Footer>
			<Button variant="outline" onclick={() => (open = false)} disabled={creating}>Cancel</Button>
			<Button onclick={handleCreate} disabled={creating || !folderName.trim()}>
				{#if creating}
					<Loader2 class="mr-2 h-4 w-4 animate-spin" />
					Creating...
				{:else}
					Create Folder
				{/if}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
