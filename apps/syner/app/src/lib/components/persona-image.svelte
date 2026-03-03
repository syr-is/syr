<script lang="ts">
	import { invoke } from '@tauri-apps/api/core';
	import * as Avatar from '@syr-is/ui/avatar';
	import { getInitials } from '$lib/utils';

	let {
		personaId,
		role,
		mtime,
		displayName = '',
		variant = 'avatar',
		class: className = ''
	}: {
		personaId: string;
		role: 'avatar' | 'banner';
		mtime?: number;
		displayName?: string;
		variant?: 'avatar' | 'banner';
		class?: string;
	} = $props();

	let dataUrl = $state<string | null>(null);
	let error = $state(false);

	$effect(() => {
		if (!personaId || !role) {
			dataUrl = null;
			error = false;
			return;
		}
		// Refetch when mtime changes (file was updated)
		void mtime;
		dataUrl = null;
		error = false;
		invoke<[string, string] | null>('read_persona_asset_cmd', {
			personaId,
			role
		})
			.then((result) => {
				if (result) {
					const [base64, mime] = result;
					dataUrl = `data:${mime};base64,${base64}`;
				}
			})
			.catch(() => {
				error = true;
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
	<div
		class="{className} [mask-image:linear-gradient(to_right,rgba(0,0,0,0.5),transparent)] bg-cover bg-center [mask-size:cover] [-webkit-mask-image:linear-gradient(to_right,rgba(0,0,0,0.5),transparent)] [-webkit-mask-size:cover]"
		style="background-image: url('{dataUrl}')"
		role="img"
		aria-label="Banner"
	></div>
{/if}
