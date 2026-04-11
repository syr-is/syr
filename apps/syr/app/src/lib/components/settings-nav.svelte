<script lang="ts">
	import { page } from '$app/state';
	import * as Sidebar from '@syr-is/ui/sidebar';
	import {
		User,
		Smartphone,
		Key,
		Monitor,
		Settings,
		KeyRound,
		Compass,
		Shield,
		Users,
		Smile,
		Film,
		ImagePlus
	} from 'lucide-svelte';

	type NavItem = { title: string; href: string; icon: typeof User };
	const userItems: NavItem[] = [
		{ title: 'Profile', href: '/settings/profile', icon: User },
		{ title: 'Sync with Syner', href: '/settings/sync-syner', icon: Smartphone },
		{ title: 'Identity', href: '/settings/identity', icon: Key },
		{ title: 'Discovery', href: '/settings/discovery', icon: Compass },
		{ title: 'Content trust', href: '/settings/content-trust', icon: Shield },
		{ title: 'Signing', href: '/settings/signing', icon: KeyRound },
		{ title: 'Sessions', href: '/settings/sessions', icon: Monitor },
		{ title: 'Emojis & Stickers', href: '/settings/emojis', icon: Smile },
		{ title: 'GIFs', href: '/settings/gifs', icon: Film }
	];

	const instanceItems: NavItem[] = [
		{ title: 'Instance config', href: '/settings/instance-config', icon: Settings },
		{ title: 'Instance media', href: '/settings/instance-media', icon: ImagePlus },
		{ title: 'Users', href: '/settings/users', icon: Users }
	];

	let { user }: { user?: { role?: string } | null } = $props();

	let currentPath = $derived(page.url.pathname);
	const isActive = (href: string): boolean => {
		const norm = (s: string) => (s.endsWith('/') ? s.slice(0, -1) : s);
		const normCurrent = norm(currentPath);
		const normHref = norm(href);
		return normCurrent === normHref || normCurrent.startsWith(normHref + '/');
	};
</script>

<nav class="flex flex-col gap-4">
	<Sidebar.Group>
		<Sidebar.GroupLabel>Account</Sidebar.GroupLabel>
		<Sidebar.GroupContent>
			<Sidebar.Menu>
				{#each userItems as item (item.href)}
					{@const Icon = item.icon}
					<Sidebar.MenuItem>
						<Sidebar.MenuButton isActive={isActive(item.href)}>
							{#snippet child({ props })}
								<a
									href={item.href}
									{...props}
									aria-current={isActive(item.href) ? 'page' : undefined}
								>
									<Icon class="h-4 w-4 shrink-0" />
									<span>{item.title}</span>
								</a>
							{/snippet}
						</Sidebar.MenuButton>
					</Sidebar.MenuItem>
				{/each}
			</Sidebar.Menu>
		</Sidebar.GroupContent>
	</Sidebar.Group>

	{#if user?.role === 'ADMIN'}
		<Sidebar.Group>
			<Sidebar.GroupLabel>Instance</Sidebar.GroupLabel>
			<Sidebar.GroupContent>
				<Sidebar.Menu>
					{#each instanceItems as item (item.href)}
						{@const Icon = item.icon}
						<Sidebar.MenuItem>
							<Sidebar.MenuButton isActive={isActive(item.href)}>
								{#snippet child({ props })}
									<a
										href={item.href}
										{...props}
										aria-current={isActive(item.href) ? 'page' : undefined}
									>
										<Icon class="h-4 w-4 shrink-0" />
										<span>{item.title}</span>
									</a>
								{/snippet}
							</Sidebar.MenuButton>
						</Sidebar.MenuItem>
					{/each}
				</Sidebar.Menu>
			</Sidebar.GroupContent>
		</Sidebar.Group>
	{/if}
</nav>
