<script lang="ts">
	import { Button } from '@syr-is/ui/button';
	import { Badge } from '@syr-is/ui/badge';
	import {
		Plus,
		Eye,
		EyeOff,
		Trash2,
		Loader2,
		VideoIcon,
		ImageIcon,
		Clock,
		CheckCircle2
	} from 'lucide-svelte';
	import { toast } from 'svelte-sonner';
	import { type UploadWithCompositeId } from '@syr-is/types';
	import StoryPickerDialog from '$lib/components/fragments/story-picker-dialog.svelte';
	import DeleteUploadDialog from '$lib/components/fragments/delete-upload-dialog.svelte';

	const STORY_WINDOW_MS = 24 * 60 * 60 * 1000;

	let stories = $state<UploadWithCompositeId[]>([]);
	let loading = $state(true);
	let error = $state<string | null>(null);
	let pickerOpen = $state(false);
	let togglingId = $state<string | null>(null);

	// Delete dialog state
	let deleteDialogOpen = $state(false);
	let uploadToDelete = $state<UploadWithCompositeId | null>(null);

	type StoryStatus = 'active' | 'expired' | 'unpublished';

	function toMs(v: unknown): number | null {
		if (v instanceof Date) return v.getTime();
		if (typeof v === 'string') {
			const t = Date.parse(v);
			return Number.isNaN(t) ? null : t;
		}
		if (typeof v === 'number') return v;
		return null;
	}

	function classify(u: UploadWithCompositeId): StoryStatus {
		if (!u.is_public) return 'unpublished';
		const t = toMs(u.published_at) ?? toMs(u.updated_at);
		if (!t) return 'unpublished';
		return Date.now() - t < STORY_WINDOW_MS ? 'active' : 'expired';
	}

	const active = $derived(stories.filter((s) => classify(s) === 'active'));
	const expired = $derived(stories.filter((s) => classify(s) === 'expired'));
	const unpublished = $derived(stories.filter((s) => classify(s) === 'unpublished'));

	async function loadStories() {
		loading = true;
		error = null;
		try {
			const res = await fetch('/api/stories');
			if (!res.ok) throw new Error('Failed to load stories');
			const body = await res.json();
			stories = body.data ?? [];
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to load stories';
		}
		loading = false;
	}

	async function togglePublish(u: UploadWithCompositeId, publish: boolean) {
		togglingId = u.id.toString();
		try {
			const did = u.did ?? '';
			const local_id = u.local_id ?? '';
			if (!did || !local_id) throw new Error('Missing composite ID');
			const res = await fetch(
				`/api/stories/${encodeURIComponent(did)}/${encodeURIComponent(local_id)}`,
				{
					method: 'PATCH',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify(publish ? { republish: true } : { is_public: false })
				}
			);
			if (!res.ok) {
				const err = await res.json().catch(() => ({}));
				throw new Error(err.error?.message ?? 'Failed to update');
			}
			toast.success(publish ? 'Story republished' : 'Story unpublished');
			await loadStories();
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Failed');
		}
		togglingId = null;
	}

	function openDelete(u: UploadWithCompositeId) {
		uploadToDelete = u;
		deleteDialogOpen = true;
	}

	function onDeleted() {
		loadStories();
	}

	function formatAge(u: UploadWithCompositeId): string {
		const t = toMs(u.published_at) ?? toMs(u.updated_at);
		if (!t) return '';
		const diff = Math.max(0, Date.now() - t);
		const mins = Math.floor(diff / 60000);
		if (mins < 1) return 'just now';
		if (mins < 60) return `${mins}m ago`;
		const hours = Math.floor(mins / 60);
		if (hours < 24) return `${hours}h ago`;
		const days = Math.floor(hours / 24);
		return `${days}d ago`;
	}

	function expiresIn(u: UploadWithCompositeId): string | null {
		const t = toMs(u.published_at) ?? toMs(u.updated_at);
		if (!t) return null;
		const remaining = t + STORY_WINDOW_MS - Date.now();
		if (remaining <= 0) return null;
		const hours = Math.floor(remaining / 3600000);
		const mins = Math.floor((remaining % 3600000) / 60000);
		if (hours > 0) return `${hours}h ${mins}m`;
		return `${mins}m`;
	}

	$effect(() => {
		loadStories();
	});
</script>

<svelte:head>
	<title>Stories · Syr</title>
</svelte:head>

<div class="mx-auto max-w-6xl space-y-6 p-6">
	<div class="flex items-center justify-between gap-3">
		<div>
			<h1 class="text-2xl font-bold tracking-tight">Stories</h1>
			<p class="text-sm text-muted-foreground">
				Stories are visible publicly for 24 hours after publishing.
			</p>
		</div>
		<Button onclick={() => (pickerOpen = true)}>
			<Plus class="mr-1 h-4 w-4" />
			Add story
		</Button>
	</div>

	{#if loading}
		<div class="flex items-center justify-center py-16 text-muted-foreground">
			<Loader2 class="mr-2 h-5 w-5 animate-spin" /> Loading...
		</div>
	{:else if error}
		<p class="py-8 text-center text-sm text-destructive">{error}</p>
	{:else if stories.length === 0}
		<div class="rounded-lg border border-dashed py-16 text-center">
			<p class="text-sm font-medium">No stories yet</p>
			<p class="mt-1 text-xs text-muted-foreground">
				Upload media and flag it as a story, or pick an existing asset.
			</p>
		</div>
	{:else}
		<!-- Active -->
		{#if active.length > 0}
			<section class="space-y-3">
				<h2
					class="flex items-center gap-2 text-sm font-semibold tracking-wide text-muted-foreground uppercase"
				>
					<CheckCircle2 class="h-4 w-4 text-green-500" />
					Active ({active.length})
				</h2>
				<div class="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
					{#each active as u (u.id)}
						{@const exp = expiresIn(u)}
						<article class="overflow-hidden rounded-lg border bg-card">
							<div class="relative aspect-[9/16] bg-muted">
								{#if u.mime_type?.startsWith('image/') && u.url}
									<img src={u.url} alt={u.filename} class="h-full w-full object-cover" />
								{:else if u.mime_type?.startsWith('video/') && u.url}
									<video
										src={u.url}
										class="h-full w-full object-cover"
										muted
										playsinline
										preload="metadata"
									></video>
									<VideoIcon class="absolute top-2 right-2 h-4 w-4 text-white drop-shadow" />
								{:else}
									<div class="flex h-full w-full items-center justify-center text-muted-foreground">
										<ImageIcon class="h-6 w-6" />
									</div>
								{/if}
								<Badge class="absolute top-2 left-2 bg-green-500/90 text-white" variant="default">
									Live
								</Badge>
								{#if exp}
									<div
										class="absolute bottom-2 left-2 flex items-center gap-1 rounded bg-black/60 px-1.5 py-0.5 text-[11px] text-white"
									>
										<Clock class="h-3 w-3" />
										{exp}
									</div>
								{/if}
							</div>
							<div class="space-y-2 p-2">
								<p class="line-clamp-1 text-xs font-medium">{u.filename}</p>
								<p class="text-[11px] text-muted-foreground">{formatAge(u)}</p>
								<div class="flex gap-1">
									<Button
										size="sm"
										variant="outline"
										class="flex-1"
										onclick={() => togglePublish(u, false)}
										disabled={togglingId === u.id.toString()}
									>
										{#if togglingId === u.id.toString()}
											<Loader2 class="h-3 w-3 animate-spin" />
										{:else}
											<EyeOff class="mr-1 h-3 w-3" /> Unpublish
										{/if}
									</Button>
									<Button
										size="sm"
										variant="destructive"
										aria-label={`Delete story ${u.filename}`}
										onclick={() => openDelete(u)}
									>
										<Trash2 class="h-3 w-3" />
									</Button>
								</div>
							</div>
						</article>
					{/each}
				</div>
			</section>
		{/if}

		<!-- Unpublished -->
		{#if unpublished.length > 0}
			<section class="space-y-3">
				<h2
					class="flex items-center gap-2 text-sm font-semibold tracking-wide text-muted-foreground uppercase"
				>
					<EyeOff class="h-4 w-4" />
					Unpublished ({unpublished.length})
				</h2>
				<div class="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
					{#each unpublished as u (u.id)}
						<article class="overflow-hidden rounded-lg border bg-card opacity-80">
							<div class="relative aspect-[9/16] bg-muted">
								{#if u.mime_type?.startsWith('image/') && u.url}
									<img src={u.url} alt={u.filename} class="h-full w-full object-cover" />
								{:else if u.mime_type?.startsWith('video/') && u.url}
									<video
										src={u.url}
										class="h-full w-full object-cover"
										muted
										playsinline
										preload="metadata"
									></video>
								{/if}
								<Badge class="absolute top-2 left-2" variant="secondary">Hidden</Badge>
							</div>
							<div class="space-y-2 p-2">
								<p class="line-clamp-1 text-xs font-medium">{u.filename}</p>
								<p class="text-[11px] text-muted-foreground">{formatAge(u)}</p>
								<div class="flex gap-1">
									<Button
										size="sm"
										class="flex-1"
										onclick={() => togglePublish(u, true)}
										disabled={togglingId === u.id.toString()}
									>
										{#if togglingId === u.id.toString()}
											<Loader2 class="h-3 w-3 animate-spin" />
										{:else}
											<Eye class="mr-1 h-3 w-3" /> Publish
										{/if}
									</Button>
									<Button
										size="sm"
										variant="destructive"
										aria-label={`Delete story ${u.filename}`}
										onclick={() => openDelete(u)}
									>
										<Trash2 class="h-3 w-3" />
									</Button>
								</div>
							</div>
						</article>
					{/each}
				</div>
			</section>
		{/if}

		<!-- Expired -->
		{#if expired.length > 0}
			<section class="space-y-3">
				<h2
					class="flex items-center gap-2 text-sm font-semibold tracking-wide text-muted-foreground uppercase"
				>
					<Clock class="h-4 w-4" />
					Expired ({expired.length})
				</h2>
				<p class="text-xs text-muted-foreground">
					Past their 24-hour window. Republish to push them live again.
				</p>
				<div class="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
					{#each expired as u (u.id)}
						<article class="overflow-hidden rounded-lg border bg-card opacity-75">
							<div class="relative aspect-[9/16] bg-muted">
								{#if u.mime_type?.startsWith('image/') && u.url}
									<img src={u.url} alt={u.filename} class="h-full w-full object-cover grayscale" />
								{:else if u.mime_type?.startsWith('video/') && u.url}
									<video
										src={u.url}
										class="h-full w-full object-cover grayscale"
										muted
										playsinline
										preload="metadata"
									></video>
								{/if}
								<Badge class="absolute top-2 left-2" variant="outline">Expired</Badge>
							</div>
							<div class="space-y-2 p-2">
								<p class="line-clamp-1 text-xs font-medium">{u.filename}</p>
								<p class="text-[11px] text-muted-foreground">{formatAge(u)}</p>
								<div class="flex gap-1">
									<Button
										size="sm"
										class="flex-1"
										onclick={() => togglePublish(u, true)}
										disabled={togglingId === u.id.toString()}
									>
										{#if togglingId === u.id.toString()}
											<Loader2 class="h-3 w-3 animate-spin" />
										{:else}
											<Eye class="mr-1 h-3 w-3" /> Republish
										{/if}
									</Button>
									<Button
										size="sm"
										variant="destructive"
										aria-label={`Delete story ${u.filename}`}
										onclick={() => openDelete(u)}
									>
										<Trash2 class="h-3 w-3" />
									</Button>
								</div>
							</div>
						</article>
					{/each}
				</div>
			</section>
		{/if}
	{/if}
</div>

<StoryPickerDialog bind:open={pickerOpen} onAdded={loadStories} />

{#if uploadToDelete}
	<DeleteUploadDialog bind:open={deleteDialogOpen} upload={uploadToDelete} onSuccess={onDeleted} />
{/if}
