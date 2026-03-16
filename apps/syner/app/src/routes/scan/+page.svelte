<script lang="ts">
	import { goto } from '$app/navigation';
	import { scanOutcome } from '$lib/stores/scanner';
	import {
		parseSyrLoginUrl,
		parseSyrSyncProfileUrl,
		parseSyrChallengeSignUrlAny
	} from '$lib/utils/syr-url';
	import { openAppSettings } from '@tauri-apps/plugin-barcode-scanner';
	import { toast } from 'svelte-sonner';
	import Scanner from '$lib/components/scanner.svelte';

	$effect(() => {
		const outcome = $scanOutcome;
		if (!outcome) return;

		if (outcome.status === 'cancelled') {
			scanOutcome.set(null);
			goto('/');
			return;
		}

		if (outcome.status === 'permission_denied') {
			scanOutcome.set(null);
			toast.error('Camera access is required. Enable it in app settings.');
			openAppSettings();
			goto('/');
			return;
		}

		// outcome.status === 'result'
		const content = outcome.content;
		scanOutcome.set(null);

		const login = parseSyrLoginUrl(content);
		if (login) {
			goto(`/scan-confirm?${new URLSearchParams(login)}`);
			return;
		}

		const sign = parseSyrChallengeSignUrlAny(content);
		if (sign) {
			goto(`/export-verify?${new URLSearchParams(sign)}`);
			return;
		}

		const sync = parseSyrSyncProfileUrl(content);
		if (sync) {
			goto(`/sync-profile?${new URLSearchParams(sync)}`);
			return;
		}

		toast.error('Not a recognized SYR QR code');
		goto('/');
	});
</script>

<Scanner />
