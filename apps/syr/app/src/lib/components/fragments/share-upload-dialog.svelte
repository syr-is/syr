<script lang="ts">
	import * as Dialog from '@syr-is/ui/dialog';
	import * as Select from '@syr-is/ui/select';
	import { Button } from '@syr-is/ui/button';
	import { Input } from '@syr-is/ui/input';
	import { Label } from '@syr-is/ui/label';
	import { getUploadApiUrl, type UploadWithCompositeId } from '@syr-is/types';
	import { toast } from 'svelte-sonner';
	import { Loader2, Link, Clock, Copy, Check } from 'lucide-svelte';
	import { copyToClipboard } from '$lib/utils/clipboard';

	let {
		upload = null,
		open = $bindable(false)
	}: {
		upload?: UploadWithCompositeId | null;
		open?: boolean;
	} = $props();

	let expiryValue = $state('3600');
	let generating = $state(false);
	let generatedUrl = $state<string | null>(null);
	let expiresAt = $state<string | null>(null);
	let linkCopied = $state(false);

	const expiryOptions = [
		{ value: '3600', label: '1 hour' },
		{ value: '21600', label: '6 hours' },
		{ value: '86400', label: '24 hours' },
		{ value: '259200', label: '3 days' },
		{ value: '604800', label: '7 days' }
	];

	async function generateShareLink() {
		if (!upload) return;

		generating = true;
		try {
			const expiresIn = parseInt(expiryValue, 10);
			const response = await fetch(getUploadApiUrl(upload, '/share'), {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ expiresIn })
			});

			if (!response.ok) {
				const errorData = await response.json();
				throw new Error(errorData.error?.message || 'Failed to generate share link');
			}

			const result = await response.json();
			generatedUrl = result.data.url;
			expiresAt = result.data.expiresAt;
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Failed to generate share link');
		} finally {
			generating = false;
		}
	}

	async function copyShareUrl() {
		if (!generatedUrl) return;
		try {
			await copyToClipboard(generatedUrl);
			linkCopied = true;
			toast.success('Share link copied to clipboard');
			setTimeout(() => {
				linkCopied = false;
			}, 2000);
		} catch {
			toast.error('Failed to copy link');
		}
	}

	function formatExpiryTime(isoString: string): string {
		const date = new Date(isoString);
		return date.toLocaleString('en-US', {
			month: 'short',
			day: 'numeric',
			hour: '2-digit',
			minute: '2-digit'
		});
	}

	function handleOpenChange(newOpen: boolean) {
		open = newOpen;
		if (!newOpen) {
			expiryValue = '3600';
			generatedUrl = null;
			expiresAt = null;
		}
	}
</script>

<Dialog.Root bind:open onOpenChange={handleOpenChange}>
	<Dialog.Content>
		<Dialog.Header>
			<Dialog.Title>Share File</Dialog.Title>
			<Dialog.Description>
				Generate a temporary link for "{upload?.filename}"
			</Dialog.Description>
		</Dialog.Header>
		<div class="space-y-4 py-4">
			{#if !generatedUrl}
				<div class="flex flex-col gap-2">
					<Label for="expiry-select">Link validity</Label>
					<Select.Root type="single" bind:value={expiryValue} name="expiry-select">
						<Select.Trigger>
							<Clock class="mr-2 h-4 w-4" />
							{expiryOptions.find((o) => o.value === expiryValue)?.label || 'Select duration'}
						</Select.Trigger>
						<Select.Content>
							{#each expiryOptions as option (option.value)}
								<Select.Item value={option.value}>{option.label}</Select.Item>
							{/each}
						</Select.Content>
					</Select.Root>
					<p class="text-xs text-muted-foreground">
						This link will expire after the selected duration. Anyone with this link can view the
						file.
					</p>
				</div>
			{:else}
				<div class="space-y-3">
					<div class="flex flex-col gap-2">
						<Label>Share link</Label>
						<div class="flex gap-2">
							<Input value={generatedUrl} readonly class="font-mono text-xs" />
							<Button variant="outline" size="icon" onclick={copyShareUrl} title="Copy link">
								{#if linkCopied}
									<Check class="h-4 w-4 text-green-500" />
								{:else}
									<Copy class="h-4 w-4" />
								{/if}
							</Button>
						</div>
					</div>
					{#if expiresAt}
						<p class="flex items-center gap-1 text-sm text-muted-foreground">
							<Clock class="h-4 w-4" />
							Expires: {formatExpiryTime(expiresAt)}
						</p>
					{/if}
				</div>
			{/if}
		</div>
		<Dialog.Footer>
			<Button variant="outline" onclick={() => (open = false)}>
				{generatedUrl ? 'Close' : 'Cancel'}
			</Button>
			{#if !generatedUrl}
				<Button onclick={generateShareLink} disabled={generating}>
					{#if generating}
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
						generatedUrl = null;
						expiresAt = null;
					}}
				>
					Generate New Link
				</Button>
			{/if}
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
