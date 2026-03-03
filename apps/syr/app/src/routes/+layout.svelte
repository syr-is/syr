<script lang="ts">
	import { Toaster } from '@syr-is/ui/sonner';
	import { ModeWatcher } from 'mode-watcher';
	import { SidebarProvider, SidebarTrigger, SidebarInset } from '@syr-is/ui/sidebar';
	import AppSidebar from '$lib/components/app-sidebar.svelte';
	import { authStore } from '$lib/stores/auth.svelte';
	import { userSessionStore } from '$lib/stores/user-session.svelte';
	import { initCryptoWasm } from '@syr-is/crypto';
	import '../app.css';

	let { children, data } = $props();

	// Initialize WASM crypto early (browser only; falls back to TS if unavailable)
	initCryptoWasm();

	if (data.user) userSessionStore.setUser(data.user);

	let open = $state(true);

	$effect(() => {
		if (!data.user) {
			authStore.logout();
			userSessionStore.clearUser();
		} else {
			userSessionStore.setUser(data.user);
		}
	});
</script>

<ModeWatcher />
<Toaster />

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
