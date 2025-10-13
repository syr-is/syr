<script lang="ts">
	import * as Sidebar from '$lib/components/ui/sidebar';
	import { Button } from '$lib/components/ui/button';
	import { toggleMode } from 'mode-watcher';
	import { House } from 'lucide-svelte';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import NavUser from '$lib/components/nav-user.svelte';

	let { user }: { user?: App.Locals['user'] } = $props();

	async function handleLogout() {
		try {
			const response = await fetch(resolve('/api/auth/logout'), {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json'
				}
			});

			if (response.ok) {
				window.location.reload();
			}
		} catch (error) {
			console.error('Logout error:', error);
		}
	}

	const items = [
		{
			title: 'Home',
			href: '/',
			icon: House
		}
	];

	let currentPath = $derived(page.url.pathname);
	let navUserData = $derived(
		user
			? {
					name: user.profile?.display_name ?? user.username,
					avatar: user.profile?.avatar_url
				}
			: null
	);
</script>

<Sidebar.Root>
	<Sidebar.Header>
		<div class="flex items-center gap-2 px-2 py-4">
			<a href="/" class="flex items-center gap-2">
				<span class="text-2xl font-bold">
					<span class="text-primary">SYR</span>
				</span>
				<span class="text-muted-foreground">Directory</span>
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

	<Sidebar.Footer>
		{#if !user}
			<div class="flex gap-2 p-2">
				<Button href="/register" variant="default" size="sm" class="flex-1">Register</Button>
				<Button href="/login" variant="outline" size="sm" class="flex-1">Login</Button>
			</div>
		{:else if navUserData}
			<NavUser user={navUserData} handleSignOut={handleLogout} toggleTheme={toggleMode} />
		{/if}
	</Sidebar.Footer>
</Sidebar.Root>
