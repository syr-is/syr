<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { getCurrent, onOpenUrl } from '@tauri-apps/plugin-deep-link';
	import { syrUrlToInternalRoute } from '$lib/utils/syr-url';

	function handleUrl(url: string) {
		const route = syrUrlToInternalRoute(url);
		if (route) {
			// eslint-disable-next-line svelte/no-navigation-without-resolve
			goto(route);
		}
	}

	onMount(() => {
		let unsub: (() => void) | undefined;
		getCurrent()
			.then((urls) => {
				const first = urls?.[0];
				if (first) handleUrl(first);
			})
			.catch(() => {});

		onOpenUrl((urls) => {
			const first = urls?.[0];
			if (first) handleUrl(first);
		})
			.then((fn) => {
				unsub = fn;
			})
			.catch(() => {});

		return () => {
			unsub?.();
		};
	});
</script>
