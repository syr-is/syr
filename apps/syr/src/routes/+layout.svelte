<script lang="ts">
	import { Toaster } from '$lib/components/ui/sonner';
	import { ModeWatcher } from 'mode-watcher';
	import { SidebarProvider, SidebarTrigger, SidebarInset } from '$lib/components/ui/sidebar';
	import AppSidebar from '$lib/components/app-sidebar.svelte';
	import { authStore } from '$lib/stores/auth.svelte';
	import '../app.css';

	let { children, data } = $props();

	$effect(() => {
		if (!data.user) {
			authStore.logout();
		}
	});
</script>

<ModeWatcher />
<Toaster />

<SidebarProvider class="h-full">
	<AppSidebar user={data.user} />
	<SidebarInset class="flex h-full flex-col overflow-hidden">
		<header class="flex h-16 shrink-0 items-center gap-2 border-b px-4">
			<SidebarTrigger />
		</header>
		<main class="min-h-0 flex-1 overflow-y-auto">
			{@render children?.()}
		</main>
	</SidebarInset>
</SidebarProvider>
