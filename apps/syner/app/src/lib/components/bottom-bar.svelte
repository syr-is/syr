<script lang="ts">
	import { Users, FileInput, PenLine, Settings, ScanLine } from '@lucide/svelte';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';

	const linkItems = [
		{ title: 'Personas', href: '/', icon: Users },
		{ title: 'Import', href: '/import', icon: FileInput },
		{ title: 'Sign', href: '/sign', icon: PenLine },
		{ title: 'Settings', href: '/settings', icon: Settings }
	];

	let currentPath = $derived(page.url.pathname);

	function handleScan() {
		goto('/scan');
	}
</script>

<nav
	class="bg-background fixed right-0 bottom-0 left-0 z-50 grid grid-cols-5 place-items-center border-t px-2 py-2 pb-[max(0.5rem,env(safe-area-inset-bottom,0px))]"
	aria-label="Main navigation"
>
	{#each linkItems.slice(0, 2) as item (item.title)}
		{@const Icon = item.icon}
		<a
			href={item.href}
			aria-current={currentPath === item.href ? 'page' : undefined}
			class="hover:bg-accent hover:text-accent-foreground flex flex-col items-center gap-1 rounded-md px-3 py-2 text-xs transition-colors {currentPath ===
			item.href
				? 'text-primary'
				: 'text-muted-foreground'}"
		>
			<Icon class="h-5 w-5" />
			<span>{item.title}</span>
		</a>
	{/each}

	<button
		type="button"
		onclick={handleScan}
		class="bg-primary text-primary-foreground hover:bg-primary/90 -mt-4 flex h-12 w-12 flex-col items-center justify-center gap-0.5 rounded-full shadow-md transition-colors disabled:opacity-50"
		aria-label="Scan QR code"
	>
		<ScanLine class="h-6 w-6" />
		<span class="text-[10px]">Scan</span>
	</button>

	{#each linkItems.slice(2, 4) as item (item.title)}
		{@const Icon = item.icon}
		<a
			href={item.href}
			aria-current={currentPath === item.href ? 'page' : undefined}
			class="hover:bg-accent hover:text-accent-foreground flex flex-col items-center gap-1 rounded-md px-3 py-2 text-xs transition-colors {currentPath ===
			item.href
				? 'text-primary'
				: 'text-muted-foreground'}"
		>
			<Icon class="h-5 w-5" />
			<span>{item.title}</span>
		</a>
	{/each}
</nav>
