<script lang="ts">
	import { GripVertical } from 'lucide-svelte';
	import type { Snippet } from 'svelte';

	interface Props {
		index: number;
		draggedIndex: number | null;
		dragOverIndex: number | null;
		onDragStart: (index: number) => void;
		onDragOver: (e: DragEvent, index: number) => void;
		onDragLeave: () => void;
		onDrop: (e: DragEvent, index: number) => void;
		onDragEnd: () => void;
		children: Snippet;
		class?: string;
	}

	let {
		index,
		draggedIndex,
		dragOverIndex,
		onDragStart,
		onDragOver,
		onDragLeave,
		onDrop,
		onDragEnd,
		children,
		class: className = ''
	}: Props = $props();
</script>

<div
	draggable="true"
	ondragstart={() => onDragStart(index)}
	ondragover={(e) => onDragOver(e, index)}
	ondragleave={onDragLeave}
	ondrop={(e) => onDrop(e, index)}
	ondragend={onDragEnd}
	class="group relative transition-all {dragOverIndex === index
		? 'ring-2 ring-primary ring-offset-2'
		: ''} {draggedIndex === index ? 'opacity-50' : ''} {className}"
	role="listitem"
>
	<!-- Drag handle -->
	<div
		class="absolute top-1/2 -left-2 z-10 -translate-y-1/2 cursor-grab rounded bg-muted p-1 opacity-0 shadow-sm transition-opacity group-hover:opacity-100 active:cursor-grabbing"
	>
		<GripVertical class="h-4 w-4 text-muted-foreground" />
	</div>
	{@render children()}
</div>
