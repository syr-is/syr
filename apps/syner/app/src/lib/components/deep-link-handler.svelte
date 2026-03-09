<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { getCurrent, onOpenUrl } from '@tauri-apps/plugin-deep-link';
	import {
		parseSyrLoginUrl,
		parseSyrSyncProfileUrl,
		parseSyrChallengeSignUrlAny
	} from '$lib/utils/syr-url';

	function handleUrl(url: string) {
		const loginParsed = parseSyrLoginUrl(url);
		if (loginParsed) {
			const q = new URLSearchParams(loginParsed);
			goto(`/scan-confirm?${q.toString()}`);
			return;
		}
		const challengeSignParsed = parseSyrChallengeSignUrlAny(url);
		if (challengeSignParsed) {
			const q = new URLSearchParams(challengeSignParsed);
			goto(`/export-verify?${q.toString()}`);
			return;
		}
		const syncParsed = parseSyrSyncProfileUrl(url);
		if (syncParsed) {
			const q = new URLSearchParams(syncParsed);
			goto(`/sync-profile?${q.toString()}`);
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
