<script lang="ts">
	import * as Dialog from '@syr-is/ui/dialog';
	import { Button } from '@syr-is/ui/button';
	import { Input } from '@syr-is/ui/input';
	import { Label } from '@syr-is/ui/label';
	import type { UploadWithCompositeId } from '@syr-is/types';
	import { toast } from 'svelte-sonner';

	let {
		upload = null,
		open = $bindable(false),
		onSuccess
	}: {
		upload?: UploadWithCompositeId | null;
		open?: boolean;
		onSuccess?: () => void;
	} = $props();

	let newFilename = $state('');
	let renaming = $state(false);

	async function handleRename() {
		if (!upload || !newFilename.trim()) return;

		renaming = true;
		try {
			const uploadUrl =
				upload.did && upload.local_id
					? `/api/uploads/${upload.did}/${upload.local_id}`
					: `/api/uploads/${typeof upload.id === 'string' ? upload.id : upload.id.toString()}`;
			const response = await fetch(uploadUrl, {
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
			open = false;
			newFilename = '';
			onSuccess?.();
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Failed to rename file');
		} finally {
			renaming = false;
		}
	}

	function handleOpenChange(newOpen: boolean) {
		open = newOpen;
		if (newOpen && upload) {
			newFilename = upload.filename;
		} else if (!newOpen) {
			newFilename = '';
		}
	}

	// Update filename when upload changes while dialog is open
	$effect(() => {
		if (open && upload) {
			newFilename = upload.filename;
		}
	});
</script>

<Dialog.Root bind:open onOpenChange={handleOpenChange}>
	<Dialog.Content>
		<Dialog.Header>
			<Dialog.Title>Rename File</Dialog.Title>
			<Dialog.Description>
				Enter a new name for "{upload?.filename}"
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
			<Button variant="outline" onclick={() => (open = false)}>Cancel</Button>
			<Button onclick={handleRename} disabled={renaming || !newFilename.trim()}>
				{renaming ? 'Renaming...' : 'Rename'}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
