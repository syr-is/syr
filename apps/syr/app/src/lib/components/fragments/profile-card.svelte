<script lang="ts" module>
	export type ProfileCardModel = {
		username: string;
		display_name?: string | null;
		bio?: string | null;
		avatar_url?: string | null;
		banner_url?: string | null;
		did?: string | null;
		signed_payload_json?: string | null;
		content_signature?: string | null;
		signing_device_public_key?: string | null;
		instanceHost?: string | null;
	};
</script>

<script lang="ts">
	import type { Snippet } from 'svelte';
	import * as Card from '@syr-is/ui/card';
	import { Avatar, AvatarFallback, AvatarImage } from '@syr-is/ui/avatar';
	import { Badge } from '@syr-is/ui/badge';
	import { Button } from '@syr-is/ui/button';
	import SignatureVerification from '$lib/components/fragments/signature-verification.svelte';
	import { Check } from 'lucide-svelte';
	import { isSafeMediaUrl } from '$lib/utils/url-sanitize';

	type Props = {
		profile: ProfileCardModel;
		class?: string;
		showAdminBadge?: boolean;
		showFollow?: boolean;
		followBusy?: boolean;
		/** While true, follow button is disabled (e.g. loading whether we already follow). */
		followStateLoading?: boolean;
		/** When true, show secondary button with check + “Following” (click still calls onFollow to unfollow). */
		isFollowing?: boolean;
		followLabel?: string;
		onFollow?: () => void | Promise<void>;
		showSignatureVerification?: boolean;
		bioVariant?: 'divider' | 'muted';
		headerActions?: Snippet;
		titleExtra?: Snippet;
		/** Link to following list (e.g. `/following`); shows “Following N” under @username */
		followingHref?: string;
		followingCount?: number;
		/** Whether this user has active stories (shows ring on avatar) */
		hasStories?: boolean;
		/** Called when the avatar is clicked and hasStories is true */
		onStoryClick?: () => void;
	};

	let {
		profile,
		class: className = '',
		showAdminBadge = false,
		showFollow = false,
		followBusy = false,
		followStateLoading = false,
		isFollowing = false,
		followLabel = 'Follow',
		onFollow,
		showSignatureVerification = true,
		bioVariant = 'divider',
		headerActions,
		titleExtra,
		followingHref,
		followingCount = 0,
		hasStories = false,
		onStoryClick
	}: Props = $props();

	const displayName = $derived(profile.display_name?.trim() || profile.username);
	const safeAvatarUrl = $derived(
		isSafeMediaUrl(profile.avatar_url) ? profile.avatar_url : undefined
	);
	const showSigBlock = $derived(showSignatureVerification && !!profile.did?.trim());
	const bioText = $derived(profile.bio?.trim() ?? '');
</script>

<Card.Root class="gap-0 overflow-hidden p-0 shadow-md {className}">
	<div class="relative h-36 w-full shrink-0 bg-muted sm:h-44">
		{#if isSafeMediaUrl(profile.banner_url)}
			<img
				src={profile.banner_url}
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

	<div class="space-y-4 px-6 pt-0 pb-6">
		<div class="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
			<div class="flex min-w-0 flex-1 flex-col gap-3 sm:flex-row sm:items-start sm:gap-5">
				{#if hasStories && onStoryClick}
					<button
						type="button"
						class="relative z-10 -mt-14 h-24 w-24 shrink-0 cursor-pointer self-start rounded-full shadow-md ring-2 ring-primary ring-offset-2 ring-offset-card sm:-mt-16 sm:h-28 sm:w-28"
						onclick={onStoryClick}
						aria-label="View stories"
					>
						<Avatar class="h-full w-full">
							<AvatarImage src={safeAvatarUrl ?? undefined} alt="" />
							<AvatarFallback class="text-lg">{displayName.slice(0, 2) || '?'}</AvatarFallback>
						</Avatar>
					</button>
				{:else}
					<Avatar
						class="-mt-14 h-24 w-24 shrink-0 self-start border-4 border-card shadow-md sm:-mt-16 sm:h-28 sm:w-28"
					>
						<AvatarImage src={safeAvatarUrl ?? undefined} alt="" />
						<AvatarFallback class="text-lg">{displayName.slice(0, 2) || '?'}</AvatarFallback>
					</Avatar>
				{/if}
				<div class="min-w-0 flex-1 space-y-1 sm:pt-1 sm:pb-0.5">
					<div class="flex min-w-0 flex-wrap items-center gap-2">
						<Card.Title class="truncate text-xl font-semibold tracking-tight sm:text-2xl">
							{displayName}
						</Card.Title>
						{#if showAdminBadge}
							<Badge
								variant="outline"
								class="shrink-0 border-transparent bg-primary/10 text-xs font-medium text-primary"
							>
								Admin
							</Badge>
						{/if}
						{@render titleExtra?.()}
					</div>
					<Card.Description class="font-mono text-xs"
						>{profile.instanceHost
							? `@${profile.username}@${profile.instanceHost}`
							: `@${profile.username}`}</Card.Description
					>
					{#if followingHref}
						<a
							href={followingHref}
							class="inline-flex text-sm font-medium text-primary underline-offset-4 hover:underline"
						>
							Following {followingCount}
						</a>
					{/if}
					{#if showSigBlock}
						<SignatureVerification
							did={profile.did!}
							signedPayloadJson={profile.signed_payload_json}
							signatureMultibase={profile.content_signature}
							signingPublicKeyMultibase={profile.signing_device_public_key}
						/>
					{/if}
				</div>
			</div>
			<div class="flex shrink-0 flex-wrap items-center justify-end gap-2 sm:mt-2">
				{#if showFollow && onFollow}
					<Button
						size="sm"
						variant={isFollowing ? 'secondary' : 'default'}
						onclick={() => void onFollow()}
						disabled={followBusy || followStateLoading}
						aria-label={isFollowing ? 'Unfollow' : followLabel}
					>
						{#if followBusy}
							Loading…
						{:else if followStateLoading}
							…
						{:else if isFollowing}
							<Check class="size-4" aria-hidden="true" />
							Following
						{:else}
							{followLabel}
						{/if}
					</Button>
				{/if}
				{@render headerActions?.()}
			</div>
		</div>
		{#if bioText}
			{#if bioVariant === 'muted'}
				<div class="rounded-lg bg-muted/50 p-4">
					<p class="text-sm leading-relaxed whitespace-pre-wrap text-foreground/90">{bioText}</p>
				</div>
			{:else}
				<div class="border-t border-border pt-4">
					<p class="text-sm whitespace-pre-wrap text-foreground/90">{bioText}</p>
				</div>
			{/if}
		{/if}
	</div>
</Card.Root>
