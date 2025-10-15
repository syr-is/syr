<script lang="ts">
	import { SidebarProvider, SidebarInset, SidebarTrigger } from '$lib/components/ui/sidebar';
	import SettingsSidebar from '$lib/components/settings-sidebar.svelte';

	// Remove unused data export
</script>

<SidebarProvider class="h-full">
	<SettingsSidebar />
	<SidebarInset class="flex h-full flex-col overflow-hidden">
		<header class="flex h-16 shrink-0 items-center gap-2 border-b px-4">
			<SidebarTrigger class="-ml-1" />
			<div class="flex items-center gap-2">
				<h1 class="text-lg font-semibold">Settings</h1>
			</div>
		</header>
		<main class="flex-1 overflow-y-auto p-4">
			<slot />
		</main>
	</SidebarInset>
</SidebarProvider>
