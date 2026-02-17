<script lang="ts">
	import { Toaster } from '@syr-is/ui/sonner';
	import { ModeWatcher } from 'mode-watcher';
	import { SidebarProvider, SidebarTrigger, SidebarInset } from '@syr-is/ui/sidebar';
	import AppSidebar from '$lib/components/app-sidebar.svelte';
	import { authStore } from '$lib/stores/auth.svelte';
	import { toast } from 'svelte-sonner';
	import { browser } from '$app/environment';
	import '../app.css';

	let { children, data } = $props();
	let identityChecked = $state(false);

	let open = $state(true);

	$effect(() => {
		if (!data.user) {
			authStore.logout();
		}
	});

	// Check and initialize identity for authenticated users (server-side)
	$effect(() => {
		if (!browser || !data.user || identityChecked) return;

		(async () => {
			try {
				const statusRes = await fetch('/api/identity/status');
				if (!statusRes.ok) throw new Error('Failed to check identity status');
				const statusData = await statusRes.json();

				if (!statusData.data.hasIdentity) {
					toast.info('Setting up your identity...');

					const createRes = await fetch('/api/identity/server-create', { method: 'POST' });
					if (!createRes.ok) {
						const errData = await createRes.json().catch(() => null);
						throw new Error(errData?.message ?? 'Failed to create identity');
					}

					toast.success('Identity created successfully!');
				}
			} catch (error) {
				console.error('[layout] Identity check/creation failed:', error);
				toast.error(
					error instanceof Error
						? error.message
						: 'Failed to initialize identity. Please try again.'
				);
			} finally {
				identityChecked = true;
			}
		})();
	});
</script>

<ModeWatcher />
<Toaster />

<SidebarProvider bind:open class="h-full">
	<AppSidebar user={data.user} />
	<SidebarInset class="flex h-full flex-col overflow-hidden">
		<header class="flex h-16 shrink-0 items-center gap-2 border-b px-3 sm:px-4">
			<SidebarTrigger />
			<div class="ml-auto text-xs text-muted-foreground">Sidebar Open: {open}</div>
		</header>
		<main class="min-h-0 flex-1 overflow-x-hidden overflow-y-auto">
			{@render children?.()}
		</main>
	</SidebarInset>
</SidebarProvider>
