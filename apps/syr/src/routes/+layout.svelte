<script lang="ts">
	import { Toaster } from '$lib/components/ui/sonner';
	import { ModeWatcher } from 'mode-watcher';
	import { SidebarProvider, SidebarTrigger, SidebarInset } from '$lib/components/ui/sidebar';
	import AppSidebar from '$lib/components/app-sidebar.svelte';
	import { authStore } from '$lib/stores/auth.svelte';
	import { checkIdentityStatus, createIdentity } from '$lib/services/identity.client';
	import { toast } from 'svelte-sonner';
	import { browser } from '$app/environment';
	import '../app.css';

	let { children, data } = $props();
	let identityChecked = $state(false);

	$effect(() => {
		if (!data.user) {
			authStore.logout();
		}
	});

	// Check and initialize identity for authenticated users
	$effect(() => {
		if (!browser || !data.user || identityChecked) return;

		(async () => {
			try {
				const { hasIdentity } = await checkIdentityStatus();

				if (!hasIdentity) {
					console.log('[layout] User has no identity, creating one...');
					toast.info('Setting up your identity...');

					const did = await createIdentity();
					console.log('[layout] Identity created:', did);
					toast.success('Identity created successfully!');
				} else {
					console.log('[layout] User already has an identity');
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

<SidebarProvider class="h-full">
	<AppSidebar user={data.user} />
	<SidebarInset class="flex h-full flex-col overflow-hidden">
		<header class="flex h-16 shrink-0 items-center gap-2 border-b px-3 sm:px-4">
			<SidebarTrigger />
		</header>
		<main class="min-h-0 flex-1 overflow-x-hidden overflow-y-auto">
			{@render children?.()}
		</main>
	</SidebarInset>
</SidebarProvider>
