<script lang="ts">
	import { Label } from '@syr-is/ui/label';
	import PersonaImage from '$lib/components/persona-image.svelte';
	import type { Persona } from '$lib/types';

	let {
		personas,
		selected,
		onSelect
	}: { personas: Persona[]; selected: Persona | null; onSelect: (p: Persona) => void } = $props();
</script>

<div class="space-y-2">
	<Label>Select persona</Label>
	<div class="flex flex-col gap-2">
		{#each personas as persona (persona.id)}
			<button
				type="button"
				class="border-border hover:bg-muted/50 flex items-center gap-3 rounded-lg border p-3 text-left transition-colors {selected?.id ===
				persona.id
					? 'border-primary bg-muted/50'
					: ''}"
				onclick={() => onSelect(persona)}
			>
				<PersonaImage
					personaId={persona.id}
					role="avatar"
					mtime={persona.avatarMtime}
					displayName={persona.displayName}
					variant="avatar"
					class="h-10 w-10 shrink-0"
				/>
				<div class="min-w-0 flex-1">
					<p class="font-medium">{persona.displayName}</p>
					<p class="text-muted-foreground truncate font-mono text-xs">{persona.did}</p>
				</div>
			</button>
		{/each}
	</div>
</div>
