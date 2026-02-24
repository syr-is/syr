<script lang="ts">
	import { Users, FileInput, PenLine, Settings } from '@lucide/svelte';
	import { page } from '$app/state';

	const items = [
		{ title: 'Personas', href: '/', icon: Users },
		{ title: 'Import', href: '/import', icon: FileInput },
		{ title: 'Sign', href: '/sign', icon: PenLine },
		{ title: 'Settings', href: '/settings', icon: Settings }
	];

	let currentPath = $derived(page.url.pathname);
</script>

<nav
	class="fixed bottom-0 left-0 right-0 z-50 flex items-center justify-around border-t bg-background px-2 py-2 safe-area-pb"
	aria-label="Main navigation"
>
	{#each items as item (item.title)}
		{@const Icon = item.icon}
		<a
			href={item.href}
			class="flex flex-col items-center gap-1 rounded-md px-4 py-2 text-xs transition-colors hover:bg-accent hover:text-accent-foreground {currentPath === item.href
				? 'text-primary'
				: 'text-muted-foreground'}"
		>
			<Icon class="h-5 w-5" />
			<span>{item.title}</span>
		</a>
	{/each}
</nav>
