<script lang="ts">
	import { onMount } from 'svelte';
	import {
		cancel,
		checkPermissions,
		requestPermissions,
		scan,
		Format
	} from '@tauri-apps/plugin-barcode-scanner';
	import { ArrowLeft } from '@lucide/svelte';
	import { Button } from '@syr-is/ui/button';
	import { scanOutcome } from '$lib/stores/scanner';

	let cancelled = $state(false);

	// On iOS, cancel() can crash the app. Skip it; navigation will unmount and release resources.
	const isIos = typeof navigator !== 'undefined' && /iPad|iPhone|iPod/.test(navigator.userAgent);

	const pathProps = {
		stroke: 'white',
		'stroke-width': 7,
		'stroke-linecap': 'round' as const,
		'stroke-linejoin': 'round' as const
	};

	onMount(() => {
		let mounted = true;

		async function runScan() {
			scanOutcome.set(null);

			try {
				const status = await checkPermissions();
				if (status !== 'granted') {
					const newStatus = await requestPermissions();
					if (newStatus === 'denied') {
						if (mounted) scanOutcome.set({ status: 'permission_denied' });
						return;
					}
				}

				const result = await scan({
					windowed: true,
					formats: [Format.QRCode]
				});

				if (!mounted || cancelled) return;

				// scan() resolving means native scanner is already stopped; no cancel() needed
				if (result) {
					const content = typeof result === 'string' ? result : result.content;
					scanOutcome.set({ status: 'result', content });
				} else {
					scanOutcome.set({ status: 'cancelled' });
				}
			} catch (_) {
				if (!mounted || cancelled) return;
				await cancel().catch(() => {});
				if (mounted) scanOutcome.set({ status: 'cancelled' });
			}
		}

		runScan();

		return () => {
			mounted = false;
			cancelled = true;
			// Skip cancel() on iOS — it can crash the app. Camera will release when view is deallocated.
			if (!isIos) {
				cancel().catch(() => {});
			}
		};
	});

	function handleBack() {
		cancelled = true;
		scanOutcome.set({ status: 'cancelled' });
		// Don't call cancel() here — on iOS it can crash the app. Let the cleanup
		// (on unmount after navigation) handle it; we navigate immediately.
	}
</script>

<!-- Transparent background so camera shows through (windowed: true) -->
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
