<script lang="ts">
	import { Button } from '@syr-is/ui/button';
	import { Plus, Loader2, CheckCircle2, Clock, EyeOff, Lock } from 'lucide-svelte';
	import { toast } from 'svelte-sonner';
	import { type UploadWithCompositeId } from '@syr-is/types';
	import StoryPickerDialog from '$lib/components/fragments/story-picker-dialog.svelte';
	import DeleteUploadDialog from '$lib/components/fragments/delete-upload-dialog.svelte';
	import StoryCard from '$lib/components/fragments/story-card.svelte';
	import { SvelteMap } from 'svelte/reactivity';

	const STORY_WINDOW_MS = 24 * 60 * 60 * 1000;

	let stories = $state<UploadWithCompositeId[]>([]);
	let loading = $state(true);
	let error = $state<string | null>(null);

	/** Resolved display URLs — signed URLs for private files, direct URLs for public */
	const resolvedUrls = new SvelteMap<string, string>();

	function displayUrl(u: UploadWithCompositeId): string {
		const key = u.id?.toString() ?? '';
		return resolvedUrls.get(key) ?? u.url ?? '';
	}

	async function resolvePrivateUrls() {
		for (const u of stories) {
			if (u.is_public || !u.did || !u.local_id) continue;
			const key = u.id?.toString() ?? '';
			if (resolvedUrls.has(key)) continue;
			try {
				const res = await fetch(
					`/api/uploads/${encodeURIComponent(u.did)}/${encodeURIComponent(u.local_id)}`
				);
				if (res.ok) {
					const json = await res.json();
					if (json.data?.downloadUrl) {
						resolvedUrls.set(key, json.data.downloadUrl);
					}
				}
			} catch {
				/* skip */
			}
		}
	}
	let pickerOpen = $state(false);
	let togglingId = $state<string | null>(null);
	let privacyTogglingId = $state<string | null>(null);

	// Delete dialog state
	let deleteDialogOpen = $state(false);
	let uploadToDelete = $state<UploadWithCompositeId | null>(null);

	type StoryStatus = 'active' | 'private' | 'expired' | 'unpublished';

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
		if (!u.is_story) return 'unpublished';
		const publishedMs = toMs(u.published_at);
		if (!publishedMs) return 'unpublished';
		if (Date.now() - publishedMs >= STORY_WINDOW_MS) return 'expired';
		if (!u.is_public) return 'private';
		return 'active';
	}

	function storyCreatedMs(u: UploadWithCompositeId): number {
		return toMs(u.created_at) ?? 0;
	}

	function storyPublishedMs(u: UploadWithCompositeId): number {
		return toMs(u.published_at) ?? 0;
	}

	// Active: most recently published first (leftmost), closest to expiry last (rightmost)
	const active = $derived(
		stories
			.filter((s) => classify(s) === 'active')
			.sort((a, b) => storyPublishedMs(b) - storyPublishedMs(a))
	);
	// Private: in story feed but file not publicly accessible
	const privateStories = $derived(
		stories
			.filter((s) => classify(s) === 'private')
			.sort((a, b) => storyPublishedMs(b) - storyPublishedMs(a))
	);
	// Expired: most recent first
	const expired = $derived(
		stories
			.filter((s) => classify(s) === 'expired')
			.sort((a, b) => storyCreatedMs(b) - storyCreatedMs(a))
	);
	// Unpublished (removed from story feed): most recent first
	const unpublished = $derived(
		stories
			.filter((s) => classify(s) === 'unpublished')
			.sort((a, b) => storyCreatedMs(b) - storyCreatedMs(a))
	);

	async function loadStories() {
		loading = true;
		error = null;
		try {
			const res = await fetch('/api/stories');
			if (!res.ok) throw new Error('Failed to load stories');
			const body = await res.json();
			stories = body.data ?? [];
			resolvedUrls.clear();
			void resolvePrivateUrls();
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
					body: JSON.stringify(publish ? { republish: true } : { unpublish: true })
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

	async function togglePrivacy(u: UploadWithCompositeId) {
		const id = u.id.toString();
		privacyTogglingId = id;
		try {
			const did = u.did ?? '';
			const local_id = u.local_id ?? '';
			if (!did || !local_id) throw new Error('Missing composite ID');
			const makePrivate = u.is_public;
			const res = await fetch(
				`/api/stories/${encodeURIComponent(did)}/${encodeURIComponent(local_id)}`,
				{
					method: 'PATCH',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ set_private: makePrivate })
				}
			);
			if (!res.ok) {
				const err = await res.json().catch(() => ({}));
				throw new Error(err.error?.message ?? 'Failed to update');
			}
			toast.success(makePrivate ? 'File made private' : 'File made public');
			await loadStories();
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Failed');
		}
		privacyTogglingId = null;
	}

	function openDelete(u: UploadWithCompositeId) {
		uploadToDelete = u;
		deleteDialogOpen = true;
	}

	function onDeleted() {
		loadStories();
	}

	function formatAge(u: UploadWithCompositeId): string {
		const t = toMs(u.created_at);
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
		const t = toMs(u.published_at);
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
		{@const gridClass = 'grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6'}

		<!-- Active -->
		{#if active.length > 0}
			<section class="space-y-3">
				<h2
					class="flex items-center gap-2 text-sm font-semibold tracking-wide text-muted-foreground uppercase"
				>
					<CheckCircle2 class="h-4 w-4 text-green-500" />
					Active ({active.length})
				</h2>
				<div class={gridClass}>
					{#each active as u (u.id)}
						<StoryCard
							story={u}
							displayUrl={displayUrl(u)}
							age={formatAge(u)}
							expiry={expiresIn(u)}
							badgeText="Live"
							badgeClass="bg-green-500/90 text-white"
							showUnpublish
							showPrivacyToggle
							publishing={togglingId === u.id.toString()}
							privacyToggling={privacyTogglingId === u.id.toString()}
							onUnpublish={() => togglePublish(u, false)}
							onTogglePrivacy={() => togglePrivacy(u)}
							onDelete={() => openDelete(u)}
						/>
					{/each}
				</div>
			</section>
		{/if}

		{#if privateStories.length > 0}
			<section class="space-y-3">
				<h2
					class="flex items-center gap-2 text-sm font-semibold tracking-wide text-muted-foreground uppercase"
				>
					<Lock class="h-4 w-4 text-amber-500" />
					Private ({privateStories.length})
				</h2>
				<p class="text-xs text-muted-foreground">
					In story feed but file is private — not visible to others until made public.
				</p>
				<div class={gridClass}>
					{#each privateStories as u (u.id)}
						<StoryCard
							story={u}
							displayUrl={displayUrl(u)}
							age={formatAge(u)}
							expiry={expiresIn(u)}
							badgeText="Private"
							badgeClass="bg-amber-500/90 text-white"
							cardClass="border-amber-500/30"
							imageClass="opacity-75"
							showUnpublish
							showPrivacyToggle
							publishing={togglingId === u.id.toString()}
							privacyToggling={privacyTogglingId === u.id.toString()}
							onUnpublish={() => togglePublish(u, false)}
							onTogglePrivacy={() => togglePrivacy(u)}
							onDelete={() => openDelete(u)}
						/>
					{/each}
				</div>
			</section>
		{/if}

		{#if unpublished.length > 0}
			<section class="space-y-3">
				<h2
					class="flex items-center gap-2 text-sm font-semibold tracking-wide text-muted-foreground uppercase"
				>
					<EyeOff class="h-4 w-4" />
					Unpublished ({unpublished.length})
				</h2>
				<div class={gridClass}>
					{#each unpublished as u (u.id)}
						<StoryCard
							story={u}
							displayUrl={displayUrl(u)}
							age={formatAge(u)}
							badgeText="Hidden"
							badgeVariant="secondary"
							cardClass="opacity-80"
							showPublish
							showPrivacyToggle
							publishing={togglingId === u.id.toString()}
							privacyToggling={privacyTogglingId === u.id.toString()}
							onPublish={() => togglePublish(u, true)}
							onTogglePrivacy={() => togglePrivacy(u)}
							onDelete={() => openDelete(u)}
						/>
					{/each}
				</div>
			</section>
		{/if}

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
				<div class={gridClass}>
					{#each expired as u (u.id)}
						<StoryCard
							story={u}
							displayUrl={displayUrl(u)}
							age={formatAge(u)}
							badgeText="Expired"
							badgeVariant="outline"
							cardClass="opacity-75"
							imageClass="grayscale"
							showPublish
							showPrivacyToggle
							publishing={togglingId === u.id.toString()}
							privacyToggling={privacyTogglingId === u.id.toString()}
							onPublish={() => togglePublish(u, true)}
							onTogglePrivacy={() => togglePrivacy(u)}
							onDelete={() => openDelete(u)}
						/>
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
