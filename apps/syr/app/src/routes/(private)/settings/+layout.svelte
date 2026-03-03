<script lang="ts">
	import { afterNavigate } from '$app/navigation';
	import SettingsNav from '$lib/components/settings-nav.svelte';
	import * as Sheet from '@syr-is/ui/sheet';
	import { IsMobile } from '$lib/hooks/is-mobile.svelte';
	import PanelLeftIcon from '@lucide/svelte/icons/panel-left';

	let { data, children } = $props();
	const isMobile = new IsMobile();
	let settingsNavOpen = $state(false);

	// Close settings nav sheet when navigating to another settings page
	afterNavigate(() => {
		settingsNavOpen = false;
	});
</script>

<div class="flex h-full flex-col md:flex-row">
	<!-- Desktop: persistent aside -->
	{#if !isMobile.current}
		<aside class="hidden w-64 shrink-0 border-r bg-background md:block">
			<div class="px-4 py-4">
				<h2 class="mb-3 text-sm font-semibold text-muted-foreground">Settings</h2>
				<SettingsNav user={data?.user} />
			</div>
		</aside>
	{/if}

	<!-- Mobile: Sheet for settings nav - Root must wrap Trigger -->
	{#if isMobile.current}
		<Sheet.Root bind:open={settingsNavOpen}>
			<div class="flex min-w-0 flex-1 flex-col">
				<header class="flex h-16 items-center gap-2 border-b px-3 sm:px-4">
					<Sheet.Trigger
						class="inline-flex size-9 shrink-0 items-center justify-center rounded-md border border-input bg-transparent text-sm font-medium shadow-xs transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50"
						aria-label="Open settings menu"
					>
						<PanelLeftIcon class="size-5" />
					</Sheet.Trigger>
					<h1 class="text-lg font-semibold">Settings</h1>
				</header>
				<main class="flex-1 overflow-y-auto p-4">
					{@render children?.()}
				</main>
			</div>
			<Sheet.Content side="left" class="w-64 p-0 [&>button]:hidden">
				<Sheet.Header class="sr-only">
					<Sheet.Title>Settings navigation</Sheet.Title>
					<Sheet.Description>Settings menu</Sheet.Description>
				</Sheet.Header>
				<div class="flex h-full flex-col px-4 py-4">
					<h2 class="mb-3 text-sm font-semibold text-muted-foreground">Settings</h2>
					<SettingsNav user={data?.user} />
				</div>
			</Sheet.Content>
		</Sheet.Root>
	{:else}
		<div class="flex min-w-0 flex-1 flex-col">
			<header class="flex h-16 items-center gap-2 border-b px-3 sm:px-4">
				<h1 class="text-lg font-semibold">Settings</h1>
			</header>
			<main class="flex-1 overflow-y-auto p-4">
				{@render children?.()}
			</main>
		</div>
	{/if}
</div>
