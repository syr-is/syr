<script lang="ts">
	import type { PageData } from './$types';
	import * as Card from '@syr-is/ui/card';
	import { Button } from '@syr-is/ui/button';
	import { toast } from 'svelte-sonner';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import ProfileCard from '$lib/components/fragments/profile-card.svelte';

	type FollowsApiJson = {
		status?: string;
		data?: unknown;
		error?: { message?: string };
		message?: string;
	};

	let { data }: { data: PageData } = $props();

	let followBusy = $state(false);
	let followStateLoading = $state(true);
	let isFollowing = $state(false);

	/** Only allow real http(s) links in the DOM (profile field is not guaranteed normalized). */
	function safeIdentityHostHref(url: string | null | undefined): string | null {
		if (url == null || url === '') return null;
		try {
			const u = new URL(url);
			if (u.username !== '' || u.password !== '') return null;
			if (u.protocol === 'http:' || u.protocol === 'https:') return url;
		} catch {
			/* invalid */
		}
		return null;
	}

	const targetDid = $derived(data.targetDid ?? '');
	const viewerDid = $derived(data.user?.did ?? '');
	const identityHostHref = $derived(
		data.targetProfile?.identity_host_url
			? safeIdentityHostHref(data.targetProfile.identity_host_url)
			: null
	);

	$effect(() => {
		const did = targetDid;
		const vd = viewerDid;
		const can = !!vd && !!did && did !== vd;
		if (!can || data.error != null) {
			isFollowing = false;
			followStateLoading = false;
			return;
		}
		followStateLoading = true;
		let cancelled = false;
		void (async () => {
			try {
				const checkQs = `did=${encodeURIComponent(did)}${data.provider ? `&provider=${encodeURIComponent(data.provider)}` : ''}`;
				const res = await fetch(`/api/follows/check?${checkQs}`, {
					credentials: 'include'
				});
				const j = (await res.json().catch(() => ({}))) as { data?: { following?: boolean } };
				if (cancelled) return;
				if (!res.ok) {
					isFollowing = false;
					return;
				}
				isFollowing = Boolean(j.data?.following);
			} catch {
				if (!cancelled) isFollowing = false;
			} finally {
				if (!cancelled) followStateLoading = false;
			}
		})();
		return () => {
			cancelled = true;
		};
	});

	async function toggleFollow() {
		if (!targetDid || !viewerDid || followBusy || followStateLoading || data.error != null) return;
		const currentDid = targetDid;
		followBusy = true;
		try {
			if (isFollowing) {
				const delQs = `followed_did=${encodeURIComponent(currentDid)}${data.provider ? `&provider_url=${encodeURIComponent(data.provider)}` : ''}`;
				const res = await fetch(`/api/follows?${delQs}`, {
					method: 'DELETE'
				});
				const j: FollowsApiJson = (await res.json().catch(() => ({}))) as FollowsApiJson;
				if (!res.ok) {
					toast.error(j.error?.message ?? j.message ?? 'Unfollow failed');
					return;
				}
				isFollowing = false;
				toast.success('Unfollowed');
				return;
			}

			const followBody: { followed_did: string; provider_url?: string } = {
				followed_did: currentDid
			};
			if (data.provider) {
				followBody.provider_url = data.provider;
			}
			const res = await fetch('/api/follows', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(followBody)
			});
			const j: FollowsApiJson = (await res.json().catch(() => ({}))) as FollowsApiJson;
			if (!res.ok) {
				toast.error(j.error?.message ?? j.message ?? 'Follow failed');
				return;
			}
			if (j.data === null) {
				toast.info('No change');
				return;
			}
			isFollowing = true;
			toast.success('Now following');
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Follow failed');
		} finally {
			followBusy = false;
		}
	}
</script>

<div class="mx-auto max-w-lg space-y-6 p-4">
	<Card.Root>
		<Card.Header>
			<Card.Title>Follow on Syr</Card.Title>
			<Card.Description>
				Confirm following this identity from your account on this instance.
			</Card.Description>
		</Card.Header>
		<Card.Content class="space-y-4">
			{#if data.error === 'invalid_did'}
				<p class="text-sm text-muted-foreground">
					Missing or invalid <code class="text-xs">target_did</code>. Use a link like
					<code class="text-xs">/follow?target_did=did:syr:…</code>.
				</p>
			{:else if data.error === 'self_follow'}
				<p class="text-sm text-muted-foreground">You cannot follow your own DID.</p>
			{:else if data.targetProfile}
				<ProfileCard
					profile={{
						username: data.targetProfile.username,
						display_name: data.targetProfile.display_name,
						bio: data.targetProfile.bio,
						avatar_url: data.targetProfile.avatar_url,
						banner_url: null,
						did: data.targetDid,
						signed_payload_json: null,
						instanceHost: data.provider
							? (() => {
									try {
										return new URL(data.provider).host;
									} catch {
										return null;
									}
								})()
							: null,
						content_signature: null,
						signing_device_public_key: null
					}}
					showFollow={!!viewerDid && viewerDid !== data.targetDid}
					{followBusy}
					{followStateLoading}
					{isFollowing}
					onFollow={toggleFollow}
					bioVariant="muted"
				/>
				{#if identityHostHref}
					<p class="text-xs text-muted-foreground">
						Their public page:
						<a
							class="text-primary underline"
							href={identityHostHref}
							target="_blank"
							rel="noopener noreferrer">{identityHostHref}</a
						>
					</p>
				{:else if data.targetProfile.identity_host_url}
					<p class="text-xs text-muted-foreground">
						Their public page URL is set but is not a safe http(s) link to open from here.
					</p>
				{/if}
			{:else}
				<p class="text-sm text-muted-foreground">
					No profile found for this DID on this instance. You can still try to follow if registry
					resolution allows it.
				</p>
				{#if viewerDid && viewerDid !== data.targetDid}
					<Button disabled={followBusy || followStateLoading} onclick={toggleFollow} class="w-full">
						{#if followStateLoading}
							…
						{:else if isFollowing}
							Unfollow
						{:else}
							Follow {data.targetDid}
						{/if}
					</Button>
				{/if}
			{/if}
		</Card.Content>
		<Card.Footer>
			<Button variant="outline" class="w-full" onclick={() => goto(resolve('/following'))}>
				Your following list
			</Button>
		</Card.Footer>
	</Card.Root>
</div>
