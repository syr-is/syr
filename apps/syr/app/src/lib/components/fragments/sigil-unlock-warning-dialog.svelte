<script lang="ts">
	import * as Dialog from '@syr-is/ui/dialog';
	import { Button } from '@syr-is/ui/button';

	export type SigilWarnMode = 'load_external' | 'auto_view' | 'quick_add';

	let {
		open = $bindable(false),
		mode = null as SigilWarnMode | null,
		onClearSession,
		onProceedUnlocked,
		onDismiss
	}: {
		open?: boolean;
		mode?: SigilWarnMode | null;
		onClearSession: () => void;
		onProceedUnlocked: () => void;
		onDismiss: () => void;
	} = $props();

	let finishing = $state(false);

	const title = $derived.by(() => {
		if (mode === 'quick_add') return 'Trust rule saved';
		return 'Signing session active';
	});

	const description = $derived.by(() => {
		const base =
			'Your Sigil is unlocked in this tab (decrypted signing key in memory). Untrusted HTML is sanitized, but embedded images and media can still run in the page context. If a rare sanitizer bug or malicious asset chained with another issue occurred, material in this tab could be at higher risk.';
		if (mode === 'load_external') {
			return `${base} You are about to allow external resources for this post.`;
		}
		if (mode === 'quick_add') {
			return `${base} New allow rules may let this post load remote content without another prompt.`;
		}
		return `${base} This post is allowed to load remote content by your trust rules.`;
	});

	function wrapFinish(fn: () => void) {
		finishing = true;
		open = false;
		fn();
		queueMicrotask(() => {
			finishing = false;
		});
	}

	function handleOpenChange(v: boolean) {
		open = v;
		if (!v && !finishing) onDismiss();
	}
</script>

<Dialog.Root bind:open onOpenChange={handleOpenChange}>
	<Dialog.Content class="max-w-md">
		<Dialog.Header>
			<Dialog.Title>{title}</Dialog.Title>
			<Dialog.Description class="text-sm leading-relaxed">
				{description}
			</Dialog.Description>
		</Dialog.Header>
		<Dialog.Footer class="flex-col gap-2 sm:flex-col">
			<Button
				type="button"
				class="w-full"
				variant="default"
				onclick={() => wrapFinish(onClearSession)}
			>
				Clear signing session and continue
			</Button>
			<Button
				type="button"
				class="w-full"
				variant="secondary"
				onclick={() => wrapFinish(onProceedUnlocked)}
			>
				Keep session unlocked and continue
			</Button>
			<Button type="button" class="w-full" variant="outline" onclick={() => (open = false)}>
				Cancel
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
