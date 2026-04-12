<script lang="ts">
	import * as Dialog from '@syr-is/ui/dialog';
	import { Button } from '@syr-is/ui/button';
	import { Loader2, ImageIcon, VideoIcon } from 'lucide-svelte';
	import { toast } from 'svelte-sonner';
	import { type UploadWithCompositeId } from '@syr-is/types';

	let {
		open = $bindable(false),
		onAdded
	}: {
		open?: boolean;
		onAdded?: () => void;
	} = $props();

	let uploads = $state<UploadWithCompositeId[]>([]);
	let loading = $state(false);
	let error = $state<string | null>(null);
	let adding = $state<string | null>(null);

	$effect(() => {
		if (open) load();
	});

	async function load() {
		loading = true;
		error = null;
		try {
			// Fetch user's most recent completed media uploads across all folders
			const res = await fetch('/api/uploads?limit=60&sort_field=created_at&sort_order=desc');
			if (!res.ok) throw new Error('Failed to load uploads');
			const body = await res.json();
			// /api/uploads returns a flat array in data (serialized with did/local_id)
			const all: UploadWithCompositeId[] = Array.isArray(body.data) ? body.data : [];
			uploads = all.filter(
				(u) =>
					u.status === 'completed' &&
					u.mime_type &&
					(u.mime_type.startsWith('image/') || u.mime_type.startsWith('video/'))
			);
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to load';
		}
		loading = false;
	}

	async function pick(u: UploadWithCompositeId) {
		adding = u.id.toString();
		try {
			const did = u.did ?? '';
			const local_id = u.local_id ?? '';
			if (!did || !local_id) throw new Error('Missing composite ID');
			const res = await fetch('/api/stories', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ did, local_id })
			});
			if (!res.ok) {
				const err = await res.json().catch(() => ({}));
				throw new Error(err.error?.message ?? err.message ?? 'Failed to add story');
			}
			toast.success('Added to your stories');
			onAdded?.();
			open = false;
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Failed to add');
		}
		adding = null;
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="max-w-3xl">
		<Dialog.Header>
			<Dialog.Title>Pick an asset for your story</Dialog.Title>
			<Dialog.Description>
				Choose an existing image or video upload. It'll be flagged as a story and published for 24
				hours.
			</Dialog.Description>
		</Dialog.Header>

		<div class="max-h-[60vh] overflow-y-auto py-2">
			{#if loading}
				<div class="flex items-center justify-center py-12 text-muted-foreground">
					<Loader2 class="mr-2 h-5 w-5 animate-spin" /> Loading uploads...
				</div>
			{:else if error}
				<p class="py-8 text-center text-sm text-destructive">{error}</p>
			{:else if uploads.length === 0}
				<p class="py-8 text-center text-sm text-muted-foreground">
					No eligible uploads. Upload an image or video first.
				</p>
			{:else}
				<div class="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-5">
					{#each uploads as u (u.id)}
						<button
							type="button"
							onclick={() => pick(u)}
							disabled={adding !== null}
							class="group relative aspect-square overflow-hidden rounded-md border bg-muted transition-colors hover:border-primary disabled:opacity-50"
							title={u.filename}
						>
							{#if u.mime_type?.startsWith('image/') && u.url}
								<img
									src={u.url}
									alt={u.filename}
									class="h-full w-full object-cover"
									loading="lazy"
								/>
							{:else if u.mime_type?.startsWith('video/') && u.url}
								<video
									src={u.url}
									class="h-full w-full object-cover"
									muted
									playsinline
									preload="metadata"
								></video>
								<VideoIcon class="absolute top-1.5 right-1.5 h-4 w-4 text-white drop-shadow" />
							{:else}
								<div class="flex h-full w-full items-center justify-center text-muted-foreground">
									<ImageIcon class="h-6 w-6" />
								</div>
							{/if}
							<div
								class="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-2 py-1 text-left text-[11px] text-white"
							>
								<span class="line-clamp-1">{u.filename}</span>
							</div>
							{#if adding === u.id.toString()}
								<div class="absolute inset-0 flex items-center justify-center bg-black/50">
									<Loader2 class="h-6 w-6 animate-spin text-white" />
								</div>
							{/if}
						</button>
					{/each}
				</div>
			{/if}
		</div>

		<Dialog.Footer>
			<Button variant="outline" onclick={() => (open = false)} disabled={adding !== null}>
				Cancel
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
