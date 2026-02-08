<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import { List, Grid3x3, LayoutGrid, GalleryHorizontal } from 'lucide-svelte';
	import type { ViewMode } from '$lib/types/display-item';

	let {
		mode = $bindable('gallery'),
		availableModes = ['gallery', 'masonry', 'carousel']
	}: {
		mode?: ViewMode;
		availableModes?: ViewMode[];
	} = $props();

	const modeConfig: Record<ViewMode, { icon: typeof List; label: string }> = {
		list: { icon: List, label: 'List' },
		gallery: { icon: Grid3x3, label: 'Gallery' },
		masonry: { icon: LayoutGrid, label: 'Grid' },
		carousel: { icon: GalleryHorizontal, label: 'Carousel' }
	};
</script>

<div class="flex items-center gap-1">
	{#each availableModes as m (m)}
		{@const config = modeConfig[m]}
		<Button variant={mode === m ? 'default' : 'outline'} size="sm" onclick={() => (mode = m)}>
			<config.icon class="mr-1.5 h-4 w-4" />
			{config.label}
		</Button>
	{/each}
</div>
