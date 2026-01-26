<script lang="ts">
	import * as Dialog from '$lib/components/ui/dialog';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { toast } from 'svelte-sonner';

	let {
		currentFolderId = null,
		open = $bindable(false),
		onSuccess
	}: {
		currentFolderId?: string | null;
		open?: boolean;
		onSuccess?: () => void;
	} = $props();

	let folderName = $state('');
	let creating = $state(false);

	async function handleCreateFolder() {
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
					parent_id: currentFolderId
				})
			});

			if (!response.ok) {
				const errorData = await response.json();
				throw new Error(errorData.error?.message || 'Failed to create folder');
			}

			toast.success('Folder created successfully');
			open = false;
			folderName = '';
			onSuccess?.();
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Failed to create folder');
		} finally {
			creating = false;
		}
	}

	function handleOpenChange(newOpen: boolean) {
		open = newOpen;
		if (!newOpen) {
			folderName = '';
		}
	}
</script>

<Dialog.Root bind:open onOpenChange={handleOpenChange}>
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
					bind:value={folderName}
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
			<Button variant="outline" onclick={() => (open = false)}>Cancel</Button>
			<Button onclick={handleCreateFolder} disabled={creating || !folderName.trim()}>
				{creating ? 'Creating...' : 'Create Folder'}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
