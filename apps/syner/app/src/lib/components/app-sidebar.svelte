<script lang="ts">
	import * as Sidebar from '@syr-is/ui/sidebar';
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

<Sidebar.Root>
	<Sidebar.Header>
		<div class="flex items-center gap-2 px-2 py-4">
			<a href="/" class="flex items-center gap-2">
				<span class="text-2xl font-bold">
					<span class="text-primary">Syner</span>
				</span>
			</a>
		</div>
	</Sidebar.Header>

	<Sidebar.Content>
		<Sidebar.Group>
			<Sidebar.GroupContent>
				<Sidebar.Menu>
					{#each items as item (item.title)}
						{@const Icon = item.icon}
						<Sidebar.MenuItem>
							<Sidebar.MenuButton isActive={currentPath === item.href}>
								{#snippet child({ props })}
									<a href={item.href} {...props}>
										<Icon class="h-4 w-4" />
										<span>{item.title}</span>
									</a>
								{/snippet}
							</Sidebar.MenuButton>
						</Sidebar.MenuItem>
					{/each}
				</Sidebar.Menu>
			</Sidebar.GroupContent>
		</Sidebar.Group>
	</Sidebar.Content>
</Sidebar.Root>
