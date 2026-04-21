<script lang="ts">
	import { Progress } from '@syr-is/ui/progress';
	import { Loader2, Check, X, AlertCircle, ChevronDown, ChevronUp, Ban } from 'lucide-svelte';
	import {
		getUploadQueue,
		cancelUpload,
		dismissUpload,
		dismissAll,
		type QueuedUpload
	} from '$lib/stores/upload-queue.svelte';

	const queue = getUploadQueue();
	let collapsed = $state(false);

	const activeUploads = $derived(
		queue.list.filter(
			(u) =>
				u.status === 'queued' ||
				u.status === 'hashing' ||
				u.status === 'presigning' ||
				u.status === 'uploading' ||
				u.status === 'finalizing'
		)
	);
	const finishedUploads = $derived(
		queue.list.filter(
			(u) => u.status === 'completed' || u.status === 'failed' || u.status === 'cancelled'
		)
	);
	const completedCount = $derived(queue.list.filter((u) => u.status === 'completed').length);
	const totalCount = $derived(queue.list.length);

	function formatSize(bytes: number): string {
		if (bytes < 1024) return `${bytes} B`;
		if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
		return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
	}

	function statusIcon(status: QueuedUpload['status']) {
		switch (status) {
			case 'queued':
				return 'queued';
			case 'hashing':
			case 'presigning':
				return 'spinner';
			case 'uploading':
				return 'progress';
			case 'finalizing':
				return 'spinner';
			case 'completed':
				return 'check';
			case 'failed':
				return 'error';
			case 'cancelled':
				return 'cancelled';
		}
	}

	function statusLabel(status: QueuedUpload['status']) {
		switch (status) {
			case 'queued':
				return 'Queued';
			case 'hashing':
				return 'Hashing...';
			case 'presigning':
				return 'Preparing...';
			case 'uploading':
				return '';
			case 'finalizing':
				return 'Syncing...';
			case 'completed':
				return '';
			case 'failed':
				return 'Failed';
			case 'cancelled':
				return 'Cancelled';
		}
	}

	const isActive = (u: QueuedUpload) =>
		u.status !== 'completed' && u.status !== 'failed' && u.status !== 'cancelled';
</script>

<div class="w-80 rounded-lg border border-border bg-popover text-popover-foreground shadow-lg">
	<!-- Header -->
	<div class="flex items-center justify-between border-b border-border px-3 py-2">
		<button
			class="flex items-center gap-1.5 text-sm font-medium"
			onclick={() => (collapsed = !collapsed)}
		>
			{#if queue.hasActive}
				<Loader2 class="h-3.5 w-3.5 animate-spin text-primary" />
				Uploading {activeUploads.length} file{activeUploads.length !== 1 ? 's' : ''}
			{:else}
				<Check class="h-3.5 w-3.5 text-green-500" />
				{completedCount}/{totalCount} uploaded
			{/if}
			{#if collapsed}
				<ChevronUp class="h-3.5 w-3.5 text-muted-foreground" />
			{:else}
				<ChevronDown class="h-3.5 w-3.5 text-muted-foreground" />
			{/if}
		</button>
		<div class="flex items-center gap-1">
			{#if finishedUploads.length > 0}
				<button
					class="rounded px-1.5 py-0.5 text-[10px] text-muted-foreground hover:bg-accent hover:text-foreground"
					onclick={dismissAll}
				>
					Clear done
				</button>
			{/if}
		</div>
	</div>

	<!-- File list -->
	{#if !collapsed}
		<div class="max-h-60 overflow-y-auto">
			{#each queue.list as upload (upload.id)}
				{@const icon = statusIcon(upload.status)}
				{@const label = statusLabel(upload.status)}
				<div class="flex items-center gap-2 px-3 py-1.5 {upload.status === 'failed' ? 'bg-destructive/5' : ''}">
					<!-- Status indicator -->
					<div class="flex h-4 w-4 shrink-0 items-center justify-center">
						{#if icon === 'spinner'}
							<Loader2 class="h-3.5 w-3.5 animate-spin text-muted-foreground" />
						{:else if icon === 'progress'}
							<div class="h-3.5 w-3.5 rounded-full border-2 border-primary" style="background: conic-gradient(var(--color-primary) {upload.progress * 360}deg, transparent 0)"></div>
						{:else if icon === 'check'}
							<Check class="h-3.5 w-3.5 text-green-500" />
						{:else if icon === 'error'}
							<AlertCircle class="h-3.5 w-3.5 text-destructive" />
						{:else if icon === 'cancelled'}
							<Ban class="h-3.5 w-3.5 text-muted-foreground" />
						{:else}
							<div class="h-2 w-2 rounded-full bg-muted-foreground/30"></div>
						{/if}
					</div>

					<!-- Filename + progress -->
					<div class="flex min-w-0 flex-1 flex-col gap-0.5">
						<span class="truncate text-xs {upload.status === 'completed' ? 'text-muted-foreground' : 'text-foreground'}">
							{upload.filename}
						</span>
						{#if upload.status === 'uploading'}
							<Progress value={upload.progress * 100} max={100} class="h-1" />
						{:else if label}
							<span class="text-[10px] text-muted-foreground">{label}</span>
						{:else if upload.status === 'completed'}
							<span class="text-[10px] text-muted-foreground">{formatSize(upload.size)}</span>
						{/if}
						{#if upload.error}
							<span class="truncate text-[10px] text-destructive">{upload.error}</span>
						{/if}
					</div>

					<!-- Percent or action -->
					<div class="flex shrink-0 items-center">
						{#if upload.status === 'uploading'}
							<span class="mr-1 text-[10px] text-muted-foreground">{Math.round(upload.progress * 100)}%</span>
						{/if}
						{#if isActive(upload)}
							<button
								class="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
								onclick={() => cancelUpload(upload.id)}
								title="Cancel upload"
							>
								<X class="h-3 w-3" />
							</button>
						{:else}
							<button
								class="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
								onclick={() => dismissUpload(upload.id)}
								title="Dismiss"
							>
								<X class="h-3 w-3" />
							</button>
						{/if}
					</div>
				</div>
			{/each}
		</div>
	{/if}
</div>
