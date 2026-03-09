<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import {
		cancel,
		checkPermissions,
		openAppSettings,
		requestPermissions,
		scan,
		Format
	} from '@tauri-apps/plugin-barcode-scanner';
	import { ArrowLeft } from '@lucide/svelte';
	import { Button } from '@syr-is/ui/button';
	import { toast } from 'svelte-sonner';
	import {
		parseSyrLoginUrl,
		parseSyrSyncProfileUrl,
		parseSyrChallengeSignUrlAny
	} from '$lib/utils/syr-url';

	let _scanning = $state(true);
	let cancelled = $state(false);

	const pathProps = {
		stroke: 'white',
		'stroke-width': 7,
		'stroke-linecap': 'round' as const,
		'stroke-linejoin': 'round' as const
	};

	onMount(() => {
		let mounted = true;

		async function runScan() {
			try {
				const status = await checkPermissions();
				if (status !== 'granted') {
					const newStatus = await requestPermissions();
					if (newStatus === 'denied') {
						toast.error('Camera access is required. Enable it in app settings.');
						await openAppSettings();
						goto('/');
						return;
					}
				}

				// windowed: true = camera shows through transparent areas (see eid-wallet)
				const result = await scan({ windowed: true, formats: [Format.QRCode] });

				if (!mounted || cancelled) return;

				if (result) {
					const content = typeof result === 'string' ? result : result.content;
					const loginParsed = parseSyrLoginUrl(content);
					if (loginParsed) {
						const q = new URLSearchParams(loginParsed);
						goto(`/scan-confirm?${q.toString()}`);
					} else {
						const challengeSignParsed = parseSyrChallengeSignUrlAny(content);
						if (challengeSignParsed) {
							const q = new URLSearchParams(challengeSignParsed);
							goto(`/export-verify?${q.toString()}`);
						} else {
							const syncParsed = parseSyrSyncProfileUrl(content);
							if (syncParsed) {
								const q = new URLSearchParams(syncParsed);
								goto(`/sync-profile?${q.toString()}`);
							} else {
								toast.error('Not a recognized SYR QR code');
								goto('/');
							}
						}
					}
				} else {
					goto('/');
				}
			} catch (e) {
				if (!mounted || cancelled) return;
				const msg = e instanceof Error ? e.message : String(e);
				if (msg.includes('plugin') || msg.includes('barcode')) {
					toast.error('Scan is available on mobile only');
				} else {
					toast.error('Failed to scan');
				}
				goto('/');
			} finally {
				if (mounted) _scanning = false;
			}
		}

		runScan();

		return () => {
			mounted = false;
		};
	});

	async function handleBack() {
		cancelled = true;
		try {
			await cancel();
		} catch {
			// ignore
		}
		goto('/');
	}
</script>

<!-- Transparent background so camera shows through (windowed: true). Only header and overlay have opaque/semi-opaque elements. -->
<div class="fixed inset-0 z-50 flex min-h-dvh flex-col bg-transparent">
	<header
		class="flex shrink-0 items-center gap-2 p-4 pt-[env(safe-area-inset-top,0px)]"
		style="background: rgba(0,0,0,0.5)"
	>
		<Button
			variant="ghost"
			size="icon"
			class="text-white hover:bg-white/20 hover:text-white"
			aria-label="Back"
			onclick={handleBack}
		>
			<ArrowLeft class="h-6 w-6" />
		</Button>
		<h1 class="text-lg font-semibold text-white">Scan QR code</h1>
	</header>

	<div class="flex min-h-0 flex-1 flex-col items-center justify-center pb-20">
		<svg
			class="mx-auto"
			width="204"
			height="215"
			viewBox="0 0 204 215"
			fill="none"
			xmlns="http://www.w3.org/2000/svg"
		>
			<path d="M46 4H15C8.92487 4 4 8.92487 4 15V46" {...pathProps}></path>
			<path d="M158 4H189C195.075 4 200 8.92487 200 15V46" {...pathProps}></path>
			<path d="M46 211H15C8.92487 211 4 206.075 4 200V169" {...pathProps}></path>
			<path d="M158 211H189C195.075 211 200 206.075 200 200V169" {...pathProps}></path>
		</svg>
		<h4 class="mt-20 text-center font-semibold text-white">Point the camera at the code</h4>
	</div>
</div>
