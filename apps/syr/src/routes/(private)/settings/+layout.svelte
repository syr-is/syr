<script lang="ts">
	import SettingsNav from '$lib/components/settings-nav.svelte';
</script>

<div class="flex h-full">
	<aside class="bg-background w-64 shrink-0 border-r">
		<div class="px-4 py-4">
			<h2 class="text-muted-foreground mb-3 text-sm font-semibold">Settings</h2>
			<SettingsNav />
		</div>
	</aside>
	<div class="flex min-w-0 flex-1 flex-col">
		<header class="flex h-16 items-center gap-2 border-b px-4">
			<h1 class="text-lg font-semibold">Settings</h1>
		</header>
		<main class="flex-1 overflow-y-auto p-4">
			<slot />
		</main>
	</div>
</div>
