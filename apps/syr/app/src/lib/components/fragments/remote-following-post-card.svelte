<script lang="ts" module>
	export type RemoteTimelineRow = {
		did: string;
		provider: string;
		title?: string;
		description?: string;
		created_at: string;
		local_id: string;
		fullUrl: string;
	};

	export type RemoteAuthorProfile = {
		displayName: string;
		username: string;
		avatarUrl: string | null;
		bannerUrl: string | null;
		instanceHost?: string | null;
	};

	export type RemotePostDetail =
		| { status: 'idle' }
		| { status: 'loading' }
		| { status: 'error'; message: string }
		| { status: 'ready'; contentPreview?: string; mediaCount?: number }
		| {
				status: 'oversized';
				kind: 'raw' | 'payload';
				byteLength: number;
				limit: number;
		  };
</script>

<script lang="ts">
	import * as Card from '@syr-is/ui/card';
	import { Avatar, AvatarFallback, AvatarImage } from '@syr-is/ui/avatar';
	import { Button } from '@syr-is/ui/button';
	import { Skeleton } from '@syr-is/ui/skeleton';
	import { ExternalLink } from 'lucide-svelte';

	type Props = {
		row: RemoteTimelineRow;
		/** `undefined` = author profile still loading */
		author: RemoteAuthorProfile | null | undefined;
		detail: RemotePostDetail | undefined;
		onLoadDetail: (row: RemoteTimelineRow) => void;
		onOversizeOverride: (row: RemoteTimelineRow) => void;
	};

	let { row, author, detail, onLoadDetail, onOversizeOverride }: Props = $props();

	const safeOrigin = $derived.by(() => {
		try {
			const u = new URL(row.provider);
			if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
			return u.origin;
		} catch {
			return '';
		}
	});
	const postHref = $derived(
		safeOrigin
			? `${safeOrigin}/p/${encodeURIComponent(row.did)}/${encodeURIComponent(row.local_id)}`
			: '#'
	);
	const profileHref = $derived(safeOrigin ? `${safeOrigin}/u/${encodeURIComponent(row.did)}` : '#');

	const displayName = $derived(
		author?.displayName?.trim() || author?.username || shortDid(row.did)
	);
	const handle = $derived.by(() => {
		const u = author?.username?.trim() || '…';
		const host = author?.instanceHost;
		return host ? `${u}@${host}` : `@${u}`;
	});

	function shortDid(did: string): string {
		return did.length > 18 ? `${did.slice(0, 10)}…${did.slice(-6)}` : did;
	}

	function formatRelativeTime(iso: string): string {
		const t = new Date(iso).getTime();
		if (Number.isNaN(t)) return '—';
		const sec = Math.round((Date.now() - t) / 1000);
		if (sec < 45) return 'now';
		const min = Math.floor(sec / 60);
		if (min < 60) return `${min}m`;
		const h = Math.floor(min / 60);
		if (h < 24) return `${h}h`;
		const d = Math.floor(h / 24);
		if (d < 7) return `${d}d`;
		return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
	}

	const snippet = $derived.by(() => {
		const desc = row.description?.trim();
		if (desc) return desc;
		if (detail?.status === 'ready' && detail.contentPreview?.trim()) {
			const t = detail.contentPreview.trim();
			return t.length > 280 ? `${t.slice(0, 277)}…` : t;
		}
		if (detail?.status === 'ready' && detail.mediaCount != null) {
			return `${detail.mediaCount} media item${detail.mediaCount === 1 ? '' : 's'}`;
		}
		return '';
	});
</script>

<!-- Compact feed variant: shorter banner + smaller overlapping avatar (profile-card pattern) -->
<Card.Root
	class="gap-0 overflow-hidden p-0 shadow-md transition-all hover:border-primary/50 hover:shadow-md"
>
	<div class="relative h-20 w-full shrink-0 bg-muted sm:h-24">
		{#if author === undefined}
			<Skeleton class="h-full w-full rounded-none" />
		{:else if author?.bannerUrl}
			<img
				src={author.bannerUrl}
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

	<div class="space-y-3 px-5 pt-0 pb-5 sm:px-6 sm:pb-6">
		<div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
			<div class="flex min-w-0 flex-1 flex-col gap-2.5 sm:flex-row sm:items-start sm:gap-4">
				<a
					href={profileHref}
					target="_blank"
					rel="noopener noreferrer"
					class="shrink-0 self-start ring-offset-background outline-none focus-visible:ring-2 focus-visible:ring-ring"
					aria-label="Open {displayName} profile on their instance"
				>
					{#if author === undefined}
						<Skeleton
							class="-mt-11 h-16 w-16 shrink-0 rounded-full border-4 border-card sm:-mt-12 sm:h-20 sm:w-20"
						/>
					{:else}
						<Avatar
							class="-mt-11 h-16 w-16 shrink-0 border-4 border-card shadow-md sm:-mt-12 sm:h-20 sm:w-20"
						>
							<AvatarImage src={author?.avatarUrl ?? undefined} alt="" />
							<AvatarFallback class="text-sm sm:text-base"
								>{displayName.slice(0, 2) || '?'}</AvatarFallback
							>
						</Avatar>
					{/if}
				</a>

				<div class="min-w-0 flex-1 space-y-0.5 sm:pt-0.5 sm:pb-0.5">
					<div class="flex min-w-0 flex-wrap items-center gap-2">
						{#if author === undefined}
							<Skeleton class="h-6 w-36 sm:h-7 sm:w-44" />
						{:else}
							<Card.Title
								class="min-w-0 truncate p-0 text-lg font-semibold tracking-tight sm:text-xl"
							>
								<a
									href={profileHref}
									target="_blank"
									rel="noopener noreferrer"
									class="text-foreground hover:underline"
								>
									{displayName}
								</a>
							</Card.Title>
						{/if}
					</div>
					<Card.Description
						class="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 font-mono text-xs"
					>
						{#if author === undefined}
							<Skeleton class="h-3 w-32" />
						{:else}
							<a
								href={profileHref}
								target="_blank"
								rel="noopener noreferrer"
								class="text-muted-foreground hover:text-foreground hover:underline"
							>
								{handle}
							</a>
							<span class="text-muted-foreground">·</span>
							<time
								class="text-muted-foreground tabular-nums"
								datetime={row.created_at}
								title={new Date(row.created_at).toLocaleString()}
							>
								{formatRelativeTime(row.created_at)}
							</time>
						{/if}
					</Card.Description>
					<p
						class="truncate pt-0.5 font-mono text-[11px] leading-tight text-muted-foreground sm:text-xs"
						title={row.did}
					>
						{row.did}
					</p>
				</div>
			</div>
		</div>

		<div class="border-t border-border pt-4">
			<a
				href={postHref}
				target="_blank"
				rel="noopener noreferrer"
				class="group/post -mx-2 -mb-2 block rounded-lg px-2 pb-2 ring-offset-background transition-colors outline-none hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring"
			>
				<h3
					class="text-base leading-snug font-semibold tracking-tight text-foreground group-hover/post:text-primary"
				>
					{row.title?.trim() || 'Untitled post'}
				</h3>
				{#if snippet}
					<p class="mt-2 line-clamp-4 text-sm leading-relaxed text-muted-foreground">
						{snippet}
					</p>
				{/if}
				<span
					class="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-primary opacity-90 group-hover/post:opacity-100"
				>
					View full post
					<ExternalLink class="size-3.5 shrink-0" aria-hidden="true" />
				</span>
			</a>

			{#if detail?.status === 'error'}
				<p class="mt-3 text-xs text-destructive">{detail.message}</p>
			{:else if detail?.status === 'oversized'}
				<p class="mt-3 text-xs text-destructive">
					Post exceeds your limit ({detail.kind === 'raw'
						? 'compressed response'
						: 'decoded payload'}).
				</p>
				<Button
					type="button"
					size="sm"
					variant="secondary"
					class="mt-2"
					onclick={() => onOversizeOverride(row)}
				>
					Load anyway
				</Button>
			{:else if detail?.status === 'loading'}
				<p class="mt-3 text-xs text-muted-foreground">Loading preview…</p>
			{:else if !snippet && (detail === undefined || detail.status === 'idle')}
				<Button
					type="button"
					size="sm"
					variant="ghost"
					class="mt-3 h-8 px-2 text-xs"
					onclick={() => onLoadDetail(row)}
				>
					Load preview
				</Button>
			{/if}
		</div>
	</div>
</Card.Root>
