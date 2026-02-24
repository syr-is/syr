<script lang="ts">
	import { Toaster } from '@syr-is/ui/sonner';
	import { ModeWatcher } from 'mode-watcher';
	import {
		SidebarProvider,
		SidebarTrigger,
		SidebarInset
	} from '@syr-is/ui/sidebar';
	import AppSidebar from '$lib/components/app-sidebar.svelte';
	import BottomBar from '$lib/components/bottom-bar.svelte';
	import { IsMobile } from '@syr-is/ui/sidebar';
	import '../app.css';

	let { children } = $props();

	const isMobile = new IsMobile();
	let open = $state(true);
</script>

<ModeWatcher />
<Toaster />

{#if isMobile.current}
	<!-- Mobile: bottom bar navigation -->
	<div class="flex min-h-dvh flex-col">
		<main class="min-h-0 flex-1 overflow-x-hidden overflow-y-auto pb-20">
			{@render children?.()}
		</main>
		<BottomBar />
	</div>
{:else}
	<!-- Desktop: sidebar navigation -->
	<SidebarProvider bind:open class="h-full">
		<AppSidebar />
		<SidebarInset class="flex h-full flex-col overflow-hidden">
			<header class="flex h-16 shrink-0 items-center gap-2 border-b px-3 sm:px-4">
				<SidebarTrigger />
			</header>
			<main class="min-h-0 flex-1 overflow-x-hidden overflow-y-auto">
				{@render children?.()}
			</main>
		</SidebarInset>
	</SidebarProvider>
{/if}
