<script lang="ts">
	import * as Card from '@syr-is/ui/card';
	import { Button } from '@syr-is/ui/button';
	import { Badge } from '@syr-is/ui/badge';
	import { ChevronDown, ChevronRight, ShieldAlert } from 'lucide-svelte';
	import type { UrlTrustStatus } from '$lib/content-trust/gate';

	type Entry = { url: string; status: UrlTrustStatus };

	let {
		authorDid,
		entries,
		onLoadExternal,
		onTextOnly,
		quickAddPattern = $bindable(''),
		onQuickAddAllow,
		quickAddBusy = false
	}: {
		authorDid?: string;
		entries: Entry[];
		onLoadExternal: () => void;
		onTextOnly: () => void;
		quickAddPattern: string;
		onQuickAddAllow: () => void;
		quickAddBusy?: boolean;
	} = $props();

	let expanded = $state(false);

	const byOrigin = $derived.by(() => {
		const m: Record<string, Entry[]> = {};
		for (const e of entries) {
			let origin = '(invalid)';
			try {
				origin = new URL(e.url).origin;
			} catch {
				/* keep */
			}
			(m[origin] ??= []).push(e);
		}
		return Object.entries(m).sort(([a], [b]) => a.localeCompare(b));
	});

	const statusVariant = (
		s: UrlTrustStatus
	): 'default' | 'secondary' | 'destructive' | 'outline' => {
		if (s === 'denied') return 'destructive';
		if (s === 'allowed') return 'secondary';
		return 'outline';
	};
</script>

<Card.Root class="border-warning/40 bg-warning/5 mb-4">
	<Card.Header class="pb-2">
		<div class="flex items-start gap-2">
			<ShieldAlert class="text-warning mt-0.5 h-5 w-5 shrink-0" />
			<div class="min-w-0 flex-1 space-y-1">
				<Card.Title class="text-base">External content sources</Card.Title>
				<Card.Description class="text-xs">
					HTML is sanitized (no scripts). Images, media, and embedded resources can still contact
					other servers (tracking, misleading assets). Signatures prove authorship, not that HTML is
					safe to load.
					{#if authorDid}
						<span class="mt-1 block font-mono text-[10px] text-muted-foreground"
							>Author {authorDid}</span
						>
					{/if}
				</Card.Description>
			</div>
		</div>
	</Card.Header>
	<Card.Content class="space-y-3 text-sm">
		<button
			type="button"
			class="flex w-full items-center gap-2 rounded-md border bg-background/80 px-3 py-2 text-left text-xs"
			onclick={() => (expanded = !expanded)}
		>
			{#if expanded}
				<ChevronDown class="h-4 w-4 shrink-0" />
			{:else}
				<ChevronRight class="h-4 w-4 shrink-0" />
			{/if}
			<span>
				{entries.length} URL{entries.length === 1 ? '' : 's'} from {byOrigin.length} origin{byOrigin.length ===
				1
					? ''
					: 's'}
			</span>
		</button>

		{#if expanded}
			<ul class="max-h-48 space-y-2 overflow-y-auto rounded-md border bg-muted/30 p-2 text-xs">
				{#each byOrigin as [origin, list] (origin)}
					<li>
						<p class="font-medium text-foreground">{origin}</p>
						<ul class="mt-1 space-y-1 pl-2">
							{#each list as e (e.url)}
								<li class="flex flex-wrap items-center gap-2 break-all">
									<Badge variant={statusVariant(e.status)} class="shrink-0 text-[10px] capitalize">
										{e.status}
									</Badge>
									<span class="text-muted-foreground">{e.url}</span>
								</li>
							{/each}
						</ul>
					</li>
				{/each}
			</ul>
		{/if}

		<div class="flex flex-wrap gap-2">
			<Button type="button" size="sm" onclick={onLoadExternal}
				>Load external media for this post</Button
			>
			<Button type="button" variant="outline" size="sm" onclick={onTextOnly}
				>Sanitized text only</Button
			>
		</div>

		<div class="space-y-2 border-t pt-3">
			<p class="text-xs text-muted-foreground">
				Add an allow rule (saved to Settings → Content trust)
			</p>
			<div class="flex flex-wrap gap-2">
				<input
					type="url"
					bind:value={quickAddPattern}
					placeholder="https://cdn.example.com/path"
					class="min-w-[12rem] flex-1 rounded-md border border-input bg-background px-3 py-2 text-xs"
				/>
				<Button type="button" size="sm" disabled={quickAddBusy} onclick={onQuickAddAllow}>
					{quickAddBusy ? 'Saving…' : 'Always allow this pattern'}
				</Button>
			</div>
		</div>
	</Card.Content>
</Card.Root>
