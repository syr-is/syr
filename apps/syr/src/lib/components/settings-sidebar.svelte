<script lang="ts">
	import * as Sidebar from '$lib/components/ui/sidebar';
	import { User } from 'lucide-svelte';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';

	const settingsNavItems = [
		{
			title: 'Profile',
			href: '/settings/profile',
			icon: User
		}
	];

	let currentPath = $derived(page.url.pathname);
</script>

<Sidebar.Root>
	<Sidebar.Header>
		<div class="flex items-center gap-2 px-2 py-4">
			<a href={resolve('/')} class="flex items-center gap-2">
				<span class="text-2xl font-bold">
					<span class="text-primary">SYR</span>
				</span>
				<span class="text-muted-foreground">Settings</span>
			</a>
		</div>
	</Sidebar.Header>

	<Sidebar.Content>
		<Sidebar.Group>
			<Sidebar.GroupContent>
				<Sidebar.Menu>
					{#each settingsNavItems as item (item.title)}
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
