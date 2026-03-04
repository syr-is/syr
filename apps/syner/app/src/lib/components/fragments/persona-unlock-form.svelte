<script lang="ts">
	import { Button } from '@syr-is/ui/button';
	import { Input } from '@syr-is/ui/input';
	import { Label } from '@syr-is/ui/label';
	import { Loader } from '@lucide/svelte';

	interface Props {
		passphrase: string;
		loading?: boolean;
		onUnlock: () => void;
		id?: string;
		label?: string;
		placeholder?: string;
	}

	let {
		passphrase = $bindable(''),
		loading = false,
		onUnlock,
		id = 'passphrase',
		label,
		placeholder = 'Passphrase'
	}: Props = $props();
</script>

{#if label}
	<div class="space-y-2">
		<Label for={id}>{label}</Label>
		<div class="flex gap-2">
			<Input
				{id}
				type="password"
				{placeholder}
				bind:value={passphrase}
				disabled={loading}
				onkeydown={(e) => e.key === 'Enter' && !loading && !!passphrase.trim() && onUnlock()}
			/>
			<Button onclick={onUnlock} disabled={loading || !passphrase.trim()}>
				{#if loading}
					<Loader class="mr-2 h-4 w-4 animate-spin" />
				{/if}
				{loading ? 'Unlocking…' : 'Unlock'}
			</Button>
		</div>
	</div>
{:else}
	<div class="flex gap-2">
		<Input
			{id}
			type="password"
			{placeholder}
			bind:value={passphrase}
			disabled={loading}
			onkeydown={(e) => e.key === 'Enter' && !loading && !!passphrase.trim() && onUnlock()}
		/>
		<Button onclick={onUnlock} disabled={loading || !passphrase.trim()}>
			{#if loading}
				<Loader class="mr-2 h-4 w-4 animate-spin" />
			{/if}
			{loading ? 'Unlocking…' : 'Unlock'}
		</Button>
	</div>
{/if}
