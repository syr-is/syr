<script lang="ts">
	import { onDestroy } from 'svelte';
	import { getIdentityStore } from '$lib/stores/identity.svelte';

	let { data, children } = $props();

	const identityStore = getIdentityStore();

	$effect(() => {
		if (data?.identityContext) {
			identityStore.setIdentityContext(data.identityContext);
		} else {
			identityStore.clearIdentityContext();
		}
	});

	onDestroy(() => {
		identityStore.clearIdentityContext();
	});
</script>

{@render children?.()}
