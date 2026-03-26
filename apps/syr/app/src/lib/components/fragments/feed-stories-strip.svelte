<script lang="ts">
	import * as Dialog from '@syr-is/ui/dialog';
	import { Button } from '@syr-is/ui/button';
	import { toast } from 'svelte-sonner';
	import type { StoryBundle } from '$lib/types/feed-stories';

	let {
		bundles,
		selfDid,
		loading = false,
		error = null,
		onRefresh
	} = $props<{
		bundles: StoryBundle[];
		selfDid: string;
		loading?: boolean;
		error?: string | null;
		onRefresh: () => void;
	}>();

	let viewerOpen = $state(false);
	let viewerBundle = $state<StoryBundle | null>(null);
	let slideIndex = $state(0);
	let fileInput: HTMLInputElement | undefined = $state();
	let uploadBusy = $state(false);

	function openViewer(b: StoryBundle) {
		if (b.slides.length === 0) return;
		viewerBundle = b;
		slideIndex = 0;
		viewerOpen = true;
	}

	function handleSelfRingClick(b: StoryBundle) {
		if (b.slides.length > 0) openViewer(b);
		else fileInput?.click();
	}

	function nextSlide() {
		if (!viewerBundle) return;
		if (slideIndex < viewerBundle.slides.length - 1) slideIndex += 1;
		else viewerOpen = false;
	}

	function prevSlide() {
		if (slideIndex > 0) slideIndex -= 1;
	}

	async function onPickStory(e: Event) {
		const input = e.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		input.value = '';
		if (!file) return;
		uploadBusy = true;
		try {
			const presign = await fetch('/api/stories/presign', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					filename: file.name,
					mime_type: file.type || 'application/octet-stream',
					size: file.size
				})
			});
			const pj = (await presign.json()) as {
				message?: string;
				data?: {
					signedUrl: string;
					uploadDid: string;
					uploadLocalId: string;
				};
			};
			if (!presign.ok || !pj.data) {
				throw new Error(pj.message ?? 'Could not start upload');
			}
			const d = pj.data;
			const put = await fetch(d.signedUrl, {
				method: 'PUT',
				body: file,
				headers: { 'Content-Type': file.type || 'application/octet-stream' }
			});
			if (!put.ok) throw new Error('Upload to storage failed');
			const patch = await fetch('/api/uploads', {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					did: d.uploadDid,
					local_id: d.uploadLocalId,
					status: 'completed'
				})
			});
			const patchBody = (await patch.json()) as { message?: string };
			if (!patch.ok) {
				throw new Error(patchBody.message ?? 'Could not finalize story');
			}
			toast.success('Story published');
			onRefresh();
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Story upload failed');
		} finally {
			uploadBusy = false;
		}
	}
</script>

<input
	bind:this={fileInput}
	type="file"
	accept="image/jpeg,image/png,image/webp,video/mp4"
	class="sr-only"
	aria-hidden="true"
	onchange={onPickStory}
/>

<div class="mb-6">
	<div class="mb-3 flex flex-wrap items-center justify-between gap-2">
		<h2 class="text-sm font-medium text-muted-foreground">Stories</h2>
		<Button
			type="button"
			variant="ghost"
			size="sm"
			class="h-8 text-primary"
			disabled={uploadBusy}
			onclick={() => fileInput?.click()}
		>
			{uploadBusy ? 'Uploading…' : 'Add story'}
		</Button>
	</div>
	{#if error}
		<p class="mb-2 text-sm text-destructive">{error}</p>
	{/if}
	{#if loading && bundles.length === 0}
		<p class="text-sm text-muted-foreground">Loading stories…</p>
	{:else}
		<div
			class="flex gap-4 overflow-x-auto pt-2 pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
		>
			{#each bundles as b (b.did)}
				<div class="flex w-[4.5rem] shrink-0 flex-col items-center gap-1.5">
					<button
						type="button"
						class="relative h-16 w-16 shrink-0 rounded-full ring-offset-background focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-none {b
							.slides.length > 0
							? 'ring-2 ring-primary ring-offset-2'
							: 'ring-1 ring-border'}"
						onclick={() => (b.did === selfDid ? handleSelfRingClick(b) : openViewer(b))}
						aria-label={b.did === selfDid
							? b.slides.length > 0
								? 'Your stories'
								: 'Add a story'
							: `Stories from ${b.profile?.username ?? b.did}`}
					>
						{#if b.profile?.avatarUrl}
							<img
								src={b.profile.avatarUrl}
								alt=""
								class="h-full w-full rounded-full object-cover"
							/>
						{:else}
							<div
								class="flex h-full w-full items-center justify-center rounded-full bg-muted text-[10px] font-medium text-muted-foreground"
							>
								{b.did.slice(-4)}
							</div>
						{/if}
					</button>
					<span
						class="max-w-full truncate text-center text-[11px] leading-tight text-muted-foreground"
					>
						{b.did === selfDid ? 'You' : (b.profile?.username ?? '…')}
					</span>
				</div>
			{/each}
		</div>
	{/if}
</div>

<Dialog.Root
	bind:open={viewerOpen}
	onOpenChange={(open) => {
		if (!open) viewerBundle = null;
	}}
>
	<Dialog.Content
		showCloseButton={false}
		class="fixed inset-0 z-50 h-[100dvh] max-h-[100dvh] w-full max-w-none translate-x-0 translate-y-0 rounded-none border-0 bg-black p-0 text-white shadow-none data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0 sm:max-w-none"
	>
		{#if viewerBundle}
			{@const s = viewerBundle.slides[slideIndex]}
			<div class="relative flex h-[100dvh] w-full items-center justify-center">
				{#if s.mime_type.startsWith('video/')}
					<video
						src={s.url}
						controls
						class="max-h-full max-w-full object-contain"
						autoplay
						playsinline
					>
						<track kind="captions" label="Captions unavailable" />
					</video>
				{:else}
					<img src={s.url} alt="" class="max-h-full max-w-full object-contain" />
				{/if}
				<button
					type="button"
					class="absolute top-4 right-4 rounded-md bg-white/10 px-3 py-1.5 text-sm hover:bg-white/20"
					onclick={() => (viewerOpen = false)}
				>
					Close
				</button>
				{#if viewerBundle.slides.length > 1}
					<button
						type="button"
						class="absolute top-1/2 left-2 -translate-y-1/2 rounded-full bg-white/10 px-3 py-2 text-xl hover:bg-white/20"
						onclick={prevSlide}
						aria-label="Previous slide"
					>
						‹
					</button>
					<button
						type="button"
						class="absolute top-1/2 right-2 -translate-y-1/2 rounded-full bg-white/10 px-3 py-2 text-xl hover:bg-white/20"
						onclick={nextSlide}
						aria-label="Next slide"
					>
						›
					</button>
				{/if}
				<p class="absolute bottom-4 left-1/2 -translate-x-1/2 text-xs text-white/70">
					{slideIndex + 1} / {viewerBundle.slides.length}
				</p>
			</div>
		{/if}
	</Dialog.Content>
</Dialog.Root>
