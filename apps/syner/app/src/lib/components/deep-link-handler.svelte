<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { getCurrent, onOpenUrl } from '@tauri-apps/plugin-deep-link';
	import { parseSyrLoginUrl } from '$lib/utils/syr-url';

	function navigateToScanConfirm(params: {
		challenge: string;
		instance: string;
		callback: string;
	}) {
		const q = new URLSearchParams(params);
		goto(`/scan-confirm?${q.toString()}`);
	}

	onMount(() => {
		let unsub: (() => void) | undefined;
		getCurrent()
			.then((urls) => {
				const first = urls?.[0];
				if (first) {
					const parsed = parseSyrLoginUrl(first);
					if (parsed) navigateToScanConfirm(parsed);
				}
			})
			.catch(() => {});

		onOpenUrl((urls) => {
			const first = urls?.[0];
			if (first) {
				const parsed = parseSyrLoginUrl(first);
				if (parsed) navigateToScanConfirm(parsed);
			}
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
