<script lang="ts">
	import type { Snippet } from 'svelte';
	import * as Card from '@syr-is/ui/card';
	import { Avatar, AvatarFallback, AvatarImage } from '@syr-is/ui/avatar';
	import { Button } from '@syr-is/ui/button';

	let {
		displayName,
		username,
		did,
		avatarUrl,
		bannerUrl,
		instanceHost,
		onOpen,
		openDisabled = false,
		cardFooter
	}: {
		displayName: string;
		username: string;
		did: string;
		avatarUrl?: string | null;
		bannerUrl?: string | null;
		instanceHost?: string | null;
		onOpen: () => void;
		/** When true, Open is disabled (e.g. profile URL unknown). */
		openDisabled?: boolean;
		/** Extra content inside the card (e.g. instance URL + actions on Following). */
		cardFooter?: Snippet;
	} = $props();

	const label = $derived(displayName?.trim() || username || '—');
	const handle = $derived(instanceHost ? `${username}@${instanceHost}` : `@${username}`);
</script>

<Card.Root class="gap-0 overflow-hidden p-0 shadow-sm transition-shadow hover:shadow-md">
	<div class="relative h-20 w-full shrink-0 bg-muted sm:h-24">
		{#if bannerUrl}
			<img
				src={bannerUrl}
				alt=""
				class="h-full w-full object-cover"
				loading="lazy"
				decoding="async"
			/>
		{:else}
			<div
				class="h-full w-full bg-gradient-to-br from-primary/20 via-muted to-muted-foreground/10"
				aria-hidden="true"
			></div>
		{/if}
	</div>

	<div
		class="flex flex-col gap-3 px-4 pt-0 pb-4 sm:flex-row sm:items-start sm:justify-between sm:gap-4"
	>
		<div class="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row sm:items-start sm:gap-3">
			<Avatar
				class="-mt-10 h-14 w-14 shrink-0 self-start border-4 border-card shadow-sm sm:-mt-11 sm:h-16 sm:w-16"
			>
				<AvatarImage src={avatarUrl ?? undefined} alt="" />
				<AvatarFallback class="text-sm">{label.slice(0, 2) || '?'}</AvatarFallback>
			</Avatar>
			<div class="min-w-0 flex-1 space-y-0.5 sm:pt-0.5">
				<Card.Title class="truncate text-base font-semibold tracking-tight">{label}</Card.Title>
				<Card.Description class="font-mono text-xs">{handle}</Card.Description>
				<p class="truncate font-mono text-[11px] text-muted-foreground" title={did}>{did}</p>
			</div>
		</div>
		<Button
			size="sm"
			variant="outline"
			class="shrink-0 self-start sm:mt-1"
			disabled={openDisabled}
			onclick={onOpen}
		>
			Open
		</Button>
	</div>
	{#if cardFooter}
		<div class="space-y-3 border-t border-border/60 px-4 pt-3 pb-4">
			{@render cardFooter()}
		</div>
	{/if}
</Card.Root>
