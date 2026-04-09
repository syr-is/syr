<script lang="ts">
	import * as Card from '@syr-is/ui/card';
	import * as Tooltip from '@syr-is/ui/tooltip';
	import { Badge } from '@syr-is/ui/badge';
	import { Button } from '@syr-is/ui/button';
	import { Skeleton } from '@syr-is/ui/skeleton';
	import MediaViewer from '$lib/components/fragments/media-viewer.svelte';
	import PostExternalSourcesCard from '$lib/components/fragments/post-external-sources-card.svelte';
	import SigilUnlockWarningDialog from '$lib/components/fragments/sigil-unlock-warning-dialog.svelte';
	import { clearSigilSession, getSigilSessionStatus } from '$lib/client/sigil-session';
	import { browser } from '$app/environment';
	import { goto, invalidateAll } from '$app/navigation';
	import { SvelteMap } from 'svelte/reactivity';
	import { toast } from 'svelte-sonner';
	import type { PageData } from './$types';
	import { Pencil, ArrowLeft, Pin, PinOff, FilePen, Send, EyeOff } from 'lucide-svelte';
	import SignatureVerification from '$lib/components/fragments/signature-verification.svelte';
	import CommentThread from '$lib/components/fragments/comment-thread.svelte';
	import ReactionBar from '$lib/components/fragments/reaction-bar.svelte';
	import PostPublishSignDialog from '$lib/components/fragments/post-publish-sign-dialog.svelte';
	import type { PostSignSnapshot } from '$lib/client/post-signed-payload';
	import type { MediaDisplayMode, SignedMutationEnvelope } from '@syr-is/types';
	import {
		sanitizeMarkdownToHtml,
		sanitizePostHtmlFragment,
		sanitizedHtmlToPlainText
	} from '$lib/client/sanitize-post-body';
	import { collectPostSubresourceUrls } from '$lib/content-trust/post-sources';
	import { postContentFingerprint } from '$lib/content-trust/post-fingerprint';
	import {
		readPostContentConsent,
		writePostContentConsent,
		consentStorageForSession,
		type PostContentConsent
	} from '$lib/content-trust/consent-storage';
	import { classifyUrls, allResourcesLoadable, type UrlTrustStatus } from '$lib/content-trust/gate';
	import type { SigilWarnMode } from '$lib/components/fragments/sigil-unlock-warning-dialog.svelte';

	let { data }: { data: PageData } = $props();
	let isPinned = $state(false);
	let pinLoading = $state(false);
	let publishLoading = $state(false);
	let publishSignOpen = $state(false);
	let publishSnapshot = $state<PostSignSnapshot>({
		type: 'blog',
		visibility: 'public'
	});

	let clientBodyReady = $state(false);
	let sanitizedBlogHtml = $state('');
	let blogPlainText = $state('');
	let sourceUrls = $state<string[]>([]);
	let trustEntries = $state<{ url: string; status: UrlTrustStatus }[]>([]);
	let textOnlyMode = $state(false);
	let consentState = $state<PostContentConsent | null>(null);
	let quickAddPattern = $state('');
	let quickAddBusy = $state(false);

	let sigilWarnOpen = $state(false);
	let sigilWarnMode = $state<SigilWarnMode | null>(null);
	/** After acknowledging Sigil risk for this content fingerprint, allow rich render when session is unlocked. */
	let sigilAckFingerprint = $state<string | null>(null);
	let lastSigilResetKey = $state('');

	let postPrepareGeneration = 0;

	// Check if post is a draft
	const isDraft = $derived(data.post.status === 'draft');

	const isOwner = $derived(data.user != null && data.user.id === data.post.author_id);

	const compositePostId = $derived(
		data.post.did && data.post.local_id ? `${data.post.did}/${data.post.local_id}` : data.post.id
	);

	const consentDid = $derived(data.post.did ?? '');
	const consentLocalId = $derived(
		data.post.local_id ??
			String(data.post.id)
				.replace(/^post:/, '')
				.split(':')
				.pop() ??
			'unknown'
	);

	const contentFp = $derived(postContentFingerprint(data.post));

	const persistConsent = $derived(data.user != null);

	const allSourcesLoadable = $derived.by(() => {
		if (!browser || sourceUrls.length === 0) return true;
		const map = new SvelteMap<string, UrlTrustStatus>();
		for (const e of trustEntries) map.set(e.url, e.status);
		const cls = new SvelteMap<string, UrlTrustStatus>();
		for (const u of sourceUrls) cls.set(u, map.get(u) ?? 'unknown');
		return allResourcesLoadable(sourceUrls, cls, {
			isOwner,
			consent: consentState,
			contentFingerprint: contentFp
		});
	});

	const showTrustUi = $derived.by(() => {
		if (!browser || sourceUrls.length === 0) return false;
		if (textOnlyMode) return false;
		if (isOwner) return false;
		return !allSourcesLoadable;
	});

	const blockRichUntilSigilAck = $derived.by(() => {
		if (!browser || !clientBodyReady || isOwner) return false;
		if (textOnlyMode || showTrustUi) return false;
		if (sourceUrls.length === 0 || !allSourcesLoadable) return false;
		if (getSigilSessionStatus() !== 'unlocked') return false;
		return sigilAckFingerprint !== contentFp;
	});

	$effect(() => {
		const key = `${compositePostId}:${contentFp}`;
		if (key !== lastSigilResetKey) {
			lastSigilResetKey = key;
			sigilAckFingerprint = null;
		}
	});

	$effect(() => {
		if (!blockRichUntilSigilAck || sigilWarnOpen) return;
		sigilWarnMode = 'auto_view';
		sigilWarnOpen = true;
	});

	$effect(() => {
		void compositePostId;
		textOnlyMode = false;
	});

	// Check if post is pinned on mount
	$effect(() => {
		if (data.user) {
			checkPinStatus();
		}
	});

	async function checkPinStatus() {
		try {
			const response = await fetch('/api/posts/pinned');
			if (response.ok) {
				const result = await response.json();
				const pinnedIds: string[] = result.data?.post_ids || [];
				isPinned = pinnedIds.includes(compositePostId);
			}
		} catch {
			// Ignore errors
		}
	}

	async function handlePinToggle() {
		if (pinLoading) return;

		pinLoading = true;
		try {
			const response = await fetch('/api/posts/pinned', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					post_id: compositePostId,
					action: isPinned ? 'unpin' : 'pin'
				})
			});

			if (!response.ok) {
				const errorData = await response.json();
				throw new Error(errorData.error?.message || 'Failed to toggle pin');
			}

			isPinned = !isPinned;
			toast.success(isPinned ? 'Post pinned' : 'Post unpinned');
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Failed to toggle pin');
		} finally {
			pinLoading = false;
		}
	}

	function postApiUrl(): string {
		return `/api/posts/${compositePostId}`;
	}

	function buildSnapshotFromPost(): PostSignSnapshot {
		const p = data.post;
		const vis = (p.visibility ?? 'public') as 'public' | 'unlisted' | 'private';
		if (p.type === 'blog') {
			return {
				type: 'blog',
				title: p.title,
				description: p.description,
				content: p.content ?? '',
				content_type: (p.content_type ?? 'markdown') as 'markdown' | 'html',
				visibility: vis
			};
		}
		return {
			type: 'media',
			media_urls: [...(p.media_urls ?? [])],
			display_mode: (p.display_mode ?? 'masonry') as MediaDisplayMode,
			visibility: vis
		};
	}

	function beginPublishFromView() {
		publishSnapshot = buildSnapshotFromPost();
		publishSignOpen = true;
	}

	async function runPublishFromView(envelope?: SignedMutationEnvelope): Promise<boolean> {
		publishLoading = true;
		try {
			const response = await fetch(postApiUrl(), {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					status: 'completed',
					...(envelope ? { signed_mutation: envelope } : {})
				})
			});

			if (!response.ok) {
				const errorData = await response.json();
				throw new Error(errorData.error?.message || 'Failed to publish post');
			}

			toast.success(envelope ? 'Post published and signed' : 'Post published (not signed)');
			window.location.reload();
			return true;
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Failed to publish post');
			return false;
		} finally {
			publishLoading = false;
		}
	}

	async function handleUnpublish() {
		if (publishLoading) return;

		publishLoading = true;
		try {
			const response = await fetch(postApiUrl(), {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					status: 'draft'
				})
			});

			if (!response.ok) {
				const errorData = await response.json();
				throw new Error(errorData.error?.message || 'Failed to unpublish post');
			}

			toast.success('Post moved back to drafts');
			// Reload page to show updated status
			window.location.reload();
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Failed to unpublish post');
		} finally {
			publishLoading = false;
		}
	}

	// Format date (handles both Date objects and ISO strings)
	function formatDate(date: Date | string): string {
		const d = typeof date === 'string' ? new Date(date) : date;
		if (isNaN(d.getTime())) return 'Invalid date';
		return new Intl.DateTimeFormat('en-US', {
			year: 'numeric',
			month: 'long',
			day: 'numeric',
			hour: 'numeric',
			minute: '2-digit'
		}).format(d);
	}

	// Get visibility badge variant
	function getVisibilityVariant(
		visibility: string
	): 'default' | 'secondary' | 'destructive' | 'outline' {
		if (visibility === 'public') return 'default';
		if (visibility === 'unlisted') return 'secondary';
		return 'destructive';
	}

	$effect(() => {
		if (!browser) return;
		const post = data.post;
		const ct = data.contentTrust;
		const base = `${window.location.origin}/`;
		const rules = ct.rules.map((r) => ({
			pattern: r.pattern,
			kind: r.kind,
			sort_order: r.sort_order
		}));
		const options = {
			pageOrigin: window.location.origin,
			implicitAllowPrefixes: ct.implicitAllowPrefixes,
			allowDataAndBlob: ct.allowDataUrls
		};

		postPrepareGeneration += 1;
		const gen = postPrepareGeneration;
		void (async () => {
			clientBodyReady = false;
			try {
				const urls = collectPostSubresourceUrls(post, base);
				sourceUrls = urls;
				const cls = classifyUrls(urls, rules, options);
				trustEntries = urls.map((u) => ({ url: u, status: cls.get(u) ?? 'unknown' }));

				let storage: Storage;
				try {
					storage = consentStorageForSession(persistConsent);
				} catch {
					storage = localStorage;
				}
				const stored = readPostContentConsent(storage, consentDid, consentLocalId);
				if (stored && stored.contentVersion !== contentFp) {
					try {
						storage.removeItem(`syr:post-content-consent:${consentDid}:${consentLocalId}`);
					} catch {
						/* ignore */
					}
					consentState = null;
				} else {
					consentState = stored && stored.contentVersion === contentFp ? stored : null;
				}

				const allowData = ct.allowDataUrls;
				if (post.type === 'blog' && post.content_type === 'html' && post.content) {
					sanitizedBlogHtml = await sanitizePostHtmlFragment(post.content, allowData);
				} else if (post.type === 'blog' && post.content_type === 'markdown' && post.content) {
					sanitizedBlogHtml = await sanitizeMarkdownToHtml(post.content, allowData);
				} else {
					sanitizedBlogHtml = '';
				}
				blogPlainText = sanitizedBlogHtml ? sanitizedHtmlToPlainText(sanitizedBlogHtml) : '';

				const unk = trustEntries.find((e) => e.status === 'unknown');
				if (unk) {
					try {
						const u = new URL(unk.url);
						quickAddPattern = `${u.origin}/`;
					} catch {
						quickAddPattern = unk.url;
					}
				} else {
					quickAddPattern = '';
				}
			} catch (e) {
				console.error(e);
				if (gen === postPrepareGeneration) toast.error('Could not prepare post body');
			} finally {
				if (gen === postPrepareGeneration) clientBodyReady = true;
			}
		})();
	});

	function applyExternalLoadConsent() {
		if (!browser || !consentDid || !consentLocalId) return;
		const storage = consentStorageForSession(persistConsent);
		const next: PostContentConsent = {
			mode: 'all_for_snapshot',
			contentVersion: contentFp,
			at: Date.now()
		};
		writePostContentConsent(storage, consentDid, consentLocalId, next);
		consentState = next;
		textOnlyMode = false;
		sigilAckFingerprint = contentFp;
		toast.success('External media enabled for this post on this device');
	}

	function requestLoadExternal() {
		if (!browser) return;
		if (getSigilSessionStatus() !== 'unlocked') {
			applyExternalLoadConsent();
			return;
		}
		sigilWarnMode = 'load_external';
		sigilWarnOpen = true;
	}

	function handleSigilClearSession() {
		clearSigilSession();
		toast.success('Signing session cleared from this tab');
		if (sigilWarnMode === 'load_external') {
			applyExternalLoadConsent();
		} else if (sigilWarnMode === 'quick_add') {
			sigilAckFingerprint = contentFp;
			toast.success('Allow rule added');
			void invalidateAll();
		} else if (sigilWarnMode === 'auto_view') {
			sigilAckFingerprint = contentFp;
		}
		sigilWarnMode = null;
	}

	function handleSigilProceedUnlocked() {
		if (sigilWarnMode === 'load_external') {
			applyExternalLoadConsent();
		} else if (sigilWarnMode === 'quick_add') {
			sigilAckFingerprint = contentFp;
			toast.success('Allow rule added');
			void invalidateAll();
		} else if (sigilWarnMode === 'auto_view') {
			sigilAckFingerprint = contentFp;
		}
		sigilWarnMode = null;
	}

	function handleSigilDismiss() {
		if (sigilWarnMode === 'auto_view') {
			textOnlyMode = true;
		}
		if (sigilWarnMode === 'quick_add') {
			void invalidateAll();
			textOnlyMode = true;
			toast.message(
				'Allow rule saved. Showing text-only until you choose a safer view; signing session is still unlocked.'
			);
		}
		sigilWarnMode = null;
	}

	function enableTextOnly() {
		textOnlyMode = true;
	}

	async function quickAddAllowRule() {
		const p = quickAddPattern.trim();
		if (!p) {
			toast.error('Enter a URL pattern');
			return;
		}
		try {
			new URL(p);
		} catch {
			toast.error('Pattern must be a valid absolute URL');
			return;
		}
		quickAddBusy = true;
		try {
			const res = await fetch('/api/user/content-trust/append', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ pattern: p, kind: 'allow' })
			});
			if (!res.ok) {
				const err = await res.json().catch(() => ({}));
				throw new Error(err?.message ?? 'Failed to save rule');
			}
			if (getSigilSessionStatus() === 'unlocked') {
				sigilWarnMode = 'quick_add';
				sigilWarnOpen = true;
				return;
			}
			toast.success('Allow rule added');
			await invalidateAll();
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Failed to save rule');
		} finally {
			quickAddBusy = false;
		}
	}

	function postPageUrl(): string {
		const postId =
			data.post.did && data.post.local_id ? `${data.post.did}/${data.post.local_id}` : data.post.id;
		return `/posts/${postId}`;
	}
</script>

<div class="container mx-auto flex h-full max-w-4xl flex-col px-4 py-6 sm:py-8">
	<Button
		variant="ghost"
		size="sm"
		class="mb-4 shrink-0 self-start"
		onclick={() => {
			// eslint-disable-next-line svelte/no-navigation-without-resolve
			goto('/');
		}}
	>
		<ArrowLeft class="mr-2 h-4 w-4" />
		Back to Home
	</Button>
	<Card.Root class="flex min-h-0 flex-1 flex-col">
		<Card.Header class="shrink-0">
			<div class="flex flex-wrap items-start justify-between gap-4">
				<div class="min-w-0 flex-1 space-y-2">
					<div class="flex flex-wrap items-center gap-2">
						<Card.Title class="text-2xl sm:text-3xl">
							{data.post.title || 'Untitled Post'}
						</Card.Title>
						<div class="flex flex-wrap gap-2">
							{#if isDraft}
								<Badge variant="outline" class="border-warning text-warning gap-1 text-xs">
									<FilePen class="h-3 w-3" />
									Draft
								</Badge>
							{/if}
							<Badge variant={getVisibilityVariant(data.post.visibility)} class="text-xs">
								{data.post.visibility}
							</Badge>
							<Badge variant="outline" class="text-xs">
								{data.post.type === 'media' ? 'media' : data.post.content_type}
							</Badge>
						</div>
					</div>
					<Card.Description class="text-sm text-muted-foreground">
						{#if isDraft}
							Draft created {formatDate(data.post.created_at)}
							{#if data.post.updated_at && data.post.updated_at !== data.post.created_at}
								<span class="ml-2">• Last edited {formatDate(data.post.updated_at)}</span>
							{/if}
						{:else}
							Published on {formatDate(data.post.created_at)}
							{#if data.post.updated_at && data.post.updated_at !== data.post.created_at}
								<span class="ml-2">• Updated on {formatDate(data.post.updated_at)}</span>
							{/if}
						{/if}
					</Card.Description>
					{#if data.post.did}
						<div class="space-y-1">
							<SignatureVerification
								did={data.post.did}
								signedPayloadJson={data.post.signed_payload_json}
								signatureMultibase={data.post.content_signature}
								signingPublicKeyMultibase={data.post.signing_device_public_key}
							/>
							<p class="text-xs text-muted-foreground">
								Unsigned or invalid signatures are visible here. Others may choose not to show such
								posts in their feeds.
							</p>
						</div>
					{/if}
				</div>
				{#if data.user}
					{@const isOwner = data.post.author_id === data.user.id}
					{#if isOwner}
						<div class="flex flex-wrap gap-2">
							{#if isDraft}
								<Button
									variant="default"
									size="sm"
									onclick={beginPublishFromView}
									disabled={publishLoading}
								>
									{#if publishLoading}
										Publishing...
									{:else}
										<Send class="mr-2 h-4 w-4" />
										Publish
									{/if}
								</Button>
							{:else}
								<Button
									variant="outline"
									size="sm"
									onclick={handleUnpublish}
									disabled={publishLoading}
								>
									{#if publishLoading}
										Unpublishing...
									{:else}
										<EyeOff class="mr-2 h-4 w-4" />
										Unpublish
									{/if}
								</Button>
							{/if}
							<Tooltip.Root>
								<Tooltip.Trigger>
									{#snippet child({ props })}
										<Button
											{...props}
											variant="outline"
											size="sm"
											onclick={handlePinToggle}
											disabled={pinLoading}
											class={isPinned ? 'text-primary' : ''}
										>
											{#if isPinned}
												<PinOff class="mr-2 h-4 w-4" />
												Unpin
											{:else}
												<Pin class="mr-2 h-4 w-4" />
												Pin
											{/if}
										</Button>
									{/snippet}
								</Tooltip.Trigger>
								<Tooltip.Content>
									{isPinned ? 'Remove from pinned posts' : 'Add to pinned posts'}
								</Tooltip.Content>
							</Tooltip.Root>
							<Button
								variant="outline"
								size="sm"
								onclick={() => {
									// eslint-disable-next-line svelte/no-navigation-without-resolve
									goto(`${postPageUrl()}/edit`);
								}}
							>
								<Pencil class="mr-2 h-4 w-4" />
								Edit
							</Button>
						</div>
					{/if}
				{/if}
			</div>
		</Card.Header>
		<Card.Content
			class="min-h-0 max-w-none flex-1 overflow-y-auto {data.post.type !== 'media' &&
			!textOnlyMode &&
			!showTrustUi
				? 'prose prose-slate dark:prose-invert'
				: ''}"
		>
			{#if data.post.type === 'media'}
				{#if !clientBodyReady}
					<div class="space-y-3 py-6">
						<Skeleton class="h-48 w-full rounded-lg" />
						<Skeleton class="h-4 w-2/3" />
					</div>
				{:else if data.post.media_urls && data.post.media_urls.length > 0}
					{#if textOnlyMode}
						<p class="py-6 text-muted-foreground">
							{data.post.description ||
								'Media hidden (text-only mode). Open settings to manage trust rules.'}
						</p>
					{:else if showTrustUi}
						<PostExternalSourcesCard
							authorDid={data.post.did}
							entries={trustEntries}
							onLoadExternal={requestLoadExternal}
							onTextOnly={enableTextOnly}
							bind:quickAddPattern
							onQuickAddAllow={quickAddAllowRule}
							{quickAddBusy}
						/>
					{:else if blockRichUntilSigilAck}
						<p class="py-6 text-sm text-muted-foreground">
							Use the dialog to continue with an unlocked signing session, clear the session, or
							cancel (switches to text-only). You can also clear Sigil under Settings → Signing.
						</p>
					{:else}
						<MediaViewer
							mediaUrls={data.post.media_urls}
							mediaUrlMimeTypes={data.mediaUrlMimeTypes ?? {}}
							mediaUrlFilenames={data.mediaUrlFilenames ?? {}}
							defaultMode={data.post.display_mode ?? 'masonry'}
						/>
					{/if}
				{:else}
					<p class="py-8 text-center text-muted-foreground">No media items in this post.</p>
				{/if}
			{:else if !clientBodyReady}
				<div class="space-y-3 py-6">
					<Skeleton class="h-6 w-full" />
					<Skeleton class="h-6 w-5/6" />
					<Skeleton class="h-6 w-4/6" />
				</div>
			{:else if textOnlyMode}
				{#if blogPlainText}
					<p class="text-sm leading-relaxed whitespace-pre-wrap text-foreground">{blogPlainText}</p>
				{:else}
					<p class="text-muted-foreground">No readable text in this post.</p>
				{/if}
			{:else if showTrustUi}
				<PostExternalSourcesCard
					authorDid={data.post.did}
					entries={trustEntries}
					onLoadExternal={requestLoadExternal}
					onTextOnly={enableTextOnly}
					bind:quickAddPattern
					onQuickAddAllow={quickAddAllowRule}
					{quickAddBusy}
				/>
			{:else if blockRichUntilSigilAck}
				<p class="py-6 text-sm text-muted-foreground">
					Use the dialog to render this post with an unlocked signing session, clear the session, or
					cancel (text-only). Settings → Signing can clear Sigil at any time.
				</p>
			{:else if data.post.content_type === 'html' || data.post.content_type === 'markdown'}
				{#if sanitizedBlogHtml}
					<!-- eslint-disable svelte/no-at-html-tags -->
					{@html sanitizedBlogHtml}
					<!-- eslint-enable svelte/no-at-html-tags -->
				{:else}
					<p class="text-muted-foreground">No content available.</p>
				{/if}
			{:else}
				<p class="text-muted-foreground">No content available.</p>
			{/if}
		</Card.Content>
	</Card.Root>

	<PostPublishSignDialog
		bind:open={publishSignOpen}
		signMode="update"
		postLocalId={data.post.local_id ?? ''}
		existingCreatedAtIso={data.post.created_at}
		snapshot={publishSnapshot}
		onSigned={(e) => runPublishFromView(e)}
		onUnsigned={() => runPublishFromView()}
		onDefer={() => {}}
	/>

	<SigilUnlockWarningDialog
		bind:open={sigilWarnOpen}
		mode={sigilWarnMode}
		onClearSession={handleSigilClearSession}
		onProceedUnlocked={handleSigilProceedUnlocked}
		onDismiss={handleSigilDismiss}
	/>

	<!-- Reactions & Comments -->
	{#if data.post.did && data.post.local_id && data.post.visibility === 'public' && data.post.status === 'completed'}
		<Card.Root>
			<Card.Content class="space-y-6 py-4">
				<ReactionBar parentType="post" parentDid={data.post.did} parentId={data.post.local_id} />
				<div class="border-t pt-4">
					<CommentThread
						postDid={data.post.did}
						postId={data.post.local_id}
						followedDids={data.followedDids ?? []}
						currentUserDid={data.user?.did ?? null}
					/>
				</div>
			</Card.Content>
		</Card.Root>
	{/if}
</div>
