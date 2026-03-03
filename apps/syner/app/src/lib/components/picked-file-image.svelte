<script lang="ts">
	import { invoke } from '@tauri-apps/api/core';
	import * as Avatar from '@syr-is/ui/avatar';
	import { getInitials } from '$lib/utils';

	let {
		sourcePath,
		displayName = '',
		variant = 'avatar',
		class: className = ''
	}: {
		sourcePath: string | null;
		displayName?: string;
		variant?: 'avatar' | 'banner';
		class?: string;
	} = $props();

	let dataUrl = $state<string | null>(null);
	let error = $state(false);

	let loadCounter = 0;

	$effect(() => {
		if (!sourcePath) {
			loadCounter++;
			dataUrl = null;
			error = false;
			return;
		}
		loadCounter++;
		const token = loadCounter;
		dataUrl = null;
		error = false;
		invoke<[string, string] | null>('read_file_as_base64_cmd', {
			sourcePath
		})
			.then((result) => {
				if (token === loadCounter && result) {
					const [base64, mime] = result;
					dataUrl = `data:${mime};base64,${base64}`;
				}
			})
			.catch(() => {
				if (token === loadCounter) error = true;
			});
	});
</script>

{#if variant === 'avatar'}
	<Avatar.Root class={className}>
		{#if dataUrl && !error}
			<Avatar.Image src={dataUrl} alt={displayName} />
		{/if}
		<Avatar.Fallback>{getInitials(displayName)}</Avatar.Fallback>
	</Avatar.Root>
{:else if variant === 'banner' && dataUrl && !error}
	<div class="{className} overflow-hidden rounded border">
		<img src={dataUrl} alt="Banner" class="h-full w-full object-cover" />
	</div>
{/if}
