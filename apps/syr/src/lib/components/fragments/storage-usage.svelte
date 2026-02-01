<script lang="ts">
	import * as Card from '$lib/components/ui/card';
	import { Progress } from '$lib/components/ui/progress';
	import { Skeleton } from '$lib/components/ui/skeleton';
	import { HardDrive } from 'lucide-svelte';
	import { storageEvents } from '$lib/stores/storage-events.svelte';

	let {
		class: className = ''
	}: {
		class?: string;
	} = $props();

	interface StorageUsageData {
		bytes_used: number;
		bytes_limit: number;
		percentage_used: number;
		bytes_remaining: number;
	}

	let loading = $state(true);
	let usageData = $state<StorageUsageData | null>(null);
	let error = $state<string | null>(null);

	async function fetchUsage() {
		loading = true;
		error = null;

		try {
			const response = await fetch('/api/storage-usage');
			if (!response.ok) {
				const errorData = await response.json();
				throw new Error(errorData.error?.message || 'Failed to fetch storage usage');
			}

			const result = await response.json();
			usageData = result.data;
		} catch (err) {
			error = err instanceof Error ? err.message : 'An unexpected error occurred';
		} finally {
			loading = false;
		}
	}

	// Format bytes to human readable string
	function formatBytes(bytes: number): string {
		if (bytes === 0) return '0 Bytes';
		const k = 1024;
		const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
		const i = Math.floor(Math.log(bytes) / Math.log(k));
		return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
	}

	// Get progress color class based on usage percentage
	function getProgressColorClass(percentage: number): string {
		if (percentage >= 90) return 'storage-critical';
		if (percentage >= 75) return 'storage-warning';
		return '';
	}

	// Fetch on mount and when global storage events trigger
	$effect(() => {
		// Read reactive value so effect re-runs when storageEvents.refresh() is called
		void storageEvents.value;
		fetchUsage();
	});
</script>

<Card.Root class={className}>
	<Card.Content class="p-4">
		{#if loading}
			<div class="space-y-3">
				<div class="flex items-center gap-2">
					<Skeleton class="h-4 w-4 rounded" />
					<Skeleton class="h-4 w-24" />
				</div>
				<Skeleton class="h-2 w-full rounded-full" />
				<Skeleton class="h-3 w-32" />
			</div>
		{:else if error}
			<div class="flex items-center gap-2 text-sm text-destructive">
				<HardDrive class="h-4 w-4" />
				<span>Failed to load storage usage</span>
			</div>
		{:else if usageData}
			<div class="space-y-3">
				<div class="flex items-center justify-between">
					<div class="flex items-center gap-2">
						<HardDrive class="h-4 w-4 text-muted-foreground" />
						<span class="text-sm font-medium">Storage</span>
					</div>
					<span class="text-xs text-muted-foreground">
						{usageData.percentage_used.toFixed(1)}% used
					</span>
				</div>

				<!-- Progress bar -->
				<div class={getProgressColorClass(usageData.percentage_used)}>
					<Progress value={usageData.percentage_used} max={100} />
				</div>

				<div class="flex items-center justify-between text-xs text-muted-foreground">
					<span>{formatBytes(usageData.bytes_used)} of {formatBytes(usageData.bytes_limit)}</span>
					<span>{formatBytes(usageData.bytes_remaining)} remaining</span>
				</div>
			</div>
		{/if}
	</Card.Content>
</Card.Root>

<style>
	/* Override progress indicator colors based on usage thresholds */
	.storage-warning :global([data-slot='progress-indicator']) {
		background-color: rgb(234 179 8); /* yellow-500 */
	}
	.storage-critical :global([data-slot='progress-indicator']) {
		background-color: hsl(var(--destructive));
	}
</style>
