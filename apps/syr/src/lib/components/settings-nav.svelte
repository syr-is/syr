<script lang="ts">
	import { page } from '$app/state';

	const items = [
		{ title: 'Profile', href: '/settings/profile' },
		{ title: 'Sessions', href: '/settings/sessions' }
	];

	let currentPath = $derived(page.url.pathname);
	const isActive = (href: string) => {
		const norm = (s: string) => (s.endsWith('/') ? s.slice(0, -1) : s);
		return norm(currentPath) === norm(href);
	};
</script>

<nav class="space-y-1">
	{#each items as item (item.href)}
		<a
			href={item.href}
			class="hover:bg-accent hover:text-accent-foreground block rounded-md px-3 py-2 text-sm transition-colors {isActive(
				item.href
			)
				? 'bg-accent text-accent-foreground'
				: 'text-muted-foreground'}"
			aria-current={isActive(item.href) ? 'page' : undefined}
		>
			{item.title}
		</a>
	{/each}
</nav>
