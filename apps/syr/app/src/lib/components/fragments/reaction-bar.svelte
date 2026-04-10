<script lang="ts">
	import EmojiPicker from './emoji-picker.svelte';
	import * as Tooltip from '@syr-is/ui/tooltip';
	import { toast } from 'svelte-sonner';
	import { cn } from '$lib/utils';
	import { SvelteMap, SvelteSet } from 'svelte/reactivity';

	type Reactor = { did: string; username?: string; instance?: string };

	type ReactionGroup = {
		kind: string;
		value: string;
		image_url: string | null;
		count: number;
		reacted: boolean;
		reactors: Reactor[];
	};

	let {
		parentType,
		parentDid,
		parentId,
		followedDids = [],
		currentUserDid = null,
		showPicker = true,
		refreshTrigger = 0
	}: {
		parentType: 'post' | 'comment';
		parentDid: string;
		parentId: string;
		followedDids?: Array<{ did: string; providerUrl: string }>;
		currentUserDid?: string | null;
		showPicker?: boolean;
		refreshTrigger?: number;
	} = $props();

	let reactions = $state<ReactionGroup[]>([]);
	let toggling = $state<string | null>(null);
	let loadSeq = 0;

	type ManifestEndpoints = { public_reactions: string; profile: string };
	const manifestCache = new SvelteMap<string, Promise<ManifestEndpoints>>();
	const profileCache = new SvelteMap<string, Promise<string | undefined>>();

	function getManifestEndpoints(did: string, providerBase: string): Promise<ManifestEndpoints> {
		if (manifestCache.has(did)) return manifestCache.get(did)!;
		const promise = (async () => {
			const base = providerBase || '';
			const encoded = encodeURIComponent(did);
			const fallback: ManifestEndpoints = {
				public_reactions: `${base}/api/public/reactions/${encoded}`,
				profile: `${base}/api/public/profile/${encoded}`
			};
			try {
				const res = await fetch(`${base}/.well-known/syr/${encoded}`, {
					headers: { Accept: 'application/json' }
				});
				if (res.ok) {
					const manifest = await res.json();
					return {
						public_reactions: manifest.endpoints?.public_reactions ?? fallback.public_reactions,
						profile: manifest.endpoints?.profile ?? fallback.profile
					};
				}
			} catch {
				/* fallback */
			}
			return fallback;
		})();
		manifestCache.set(did, promise);
		return promise;
	}

	function fetchUsername(did: string, providerBase: string): Promise<string | undefined> {
		if (profileCache.has(did)) return profileCache.get(did)!;
		const promise = (async () => {
			try {
				const endpoints = await getManifestEndpoints(did, providerBase);
				const res = await fetch(endpoints.profile);
				if (!res.ok) return undefined;
				const json = await res.json();
				if (json.status === 'success' && json.data) {
					return (json.data.username ?? json.data.display_name) as string | undefined;
				}
			} catch {
				/* skip */
			}
			return undefined;
		})();
		profileCache.set(did, promise);
		return promise;
	}

	async function loadReactions() {
		const seq = ++loadSeq;
		try {
			const allReactions: Array<{
				kind: string;
				value: string;
				image_url?: string;
				did: string;
				instance: string;
			}> = [];

			// Build DID list (current user + followed, deduped)
			const didsToFetch: Array<{ did: string; base: string }> = [];
			const seen = new SvelteSet<string>();
			if (currentUserDid) {
				seen.add(currentUserDid);
				didsToFetch.push({ did: currentUserDid, base: '' });
			}
			for (const { did, providerUrl } of followedDids) {
				if (!seen.has(did)) {
					seen.add(did);
					didsToFetch.push({ did, base: providerUrl.replace(/\/$/, '') });
				}
			}

			// Fetch reactions from each DID's instance via manifest
			const fetches = didsToFetch.map(async ({ did, base }) => {
				const instance = base ? new URL(base).hostname : 'local';
				try {
					const endpoints = await getManifestEndpoints(did, base);
					const qs = `parent_type=${encodeURIComponent(parentType)}&parent_did=${encodeURIComponent(parentDid)}&parent_id=${encodeURIComponent(parentId)}&limit=100`;
					const res = await fetch(`${endpoints.public_reactions}?${qs}`);
					if (!res.ok) return;
					const json = await res.json();
					if (json.status === 'success' && json.data) {
						for (const r of json.data) {
							allReactions.push({ ...r, did: r.did ?? did, instance });
						}
					}
				} catch {
					/* skip unreachable */
				}
			});
			await Promise.all(fetches);

			// Group by kind+value
			const groups = new SvelteMap<string, ReactionGroup>();
			for (const r of allReactions) {
				const key = `${r.kind}:${r.value}`;
				if (!groups.has(key)) {
					groups.set(key, {
						kind: r.kind,
						value: r.value,
						image_url: r.image_url ?? null,
						count: 0,
						reacted: false,
						reactors: []
					});
				}
				const group = groups.get(key)!;
				group.count++;
				group.reactors.push({ did: r.did, instance: r.instance });
				if (r.did === currentUserDid) group.reacted = true;
			}

			// Resolve usernames for all reactor DIDs
			const uniqueReactorDids = new SvelteMap<string, string>();
			for (const r of allReactions) {
				if (!uniqueReactorDids.has(r.did)) {
					const entry = didsToFetch.find((d) => d.did === r.did);
					uniqueReactorDids.set(r.did, entry?.base ?? '');
				}
			}
			const usernameFetches = Array.from(uniqueReactorDids.entries()).map(async ([did, base]) => {
				const username = await fetchUsername(did, base);
				return { did, username };
			});
			const usernameResults = await Promise.all(usernameFetches);
			const didToUsername = new Map(usernameResults.map((u) => [u.did, u.username]));

			// Attach usernames to reactors
			for (const group of groups.values()) {
				for (const reactor of group.reactors) {
					reactor.username = didToUsername.get(reactor.did);
				}
			}

			if (seq !== loadSeq) return; // stale response, discard
			reactions = Array.from(groups.values());
		} catch {
			/* skip */
		}
	}

	async function toggleReaction(kind: string, value: string, imageUrl?: string | null) {
		const key = `${kind}:${value}`;
		if (toggling) return;
		toggling = key;
		try {
			const res = await fetch('/api/reactions', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					parent_type: parentType,
					parent_did: parentDid,
					parent_id: parentId,
					kind,
					value,
					...(imageUrl ? { image_url: imageUrl } : {})
				})
			});
			if (!res.ok) {
				const err = await res.json().catch(() => ({}));
				toast.error(err.message ?? 'Failed to react');
				return;
			}
			await loadReactions();
		} catch {
			toast.error('Failed to react');
		} finally {
			toggling = null;
		}
	}

	function handleEmojiReaction(emoji: {
		shortcode: string;
		url: string;
		is_sticker: boolean;
		unicode?: boolean;
	}) {
		if (emoji.unicode) {
			toggleReaction('unicode', emoji.shortcode);
		} else {
			const kind = emoji.is_sticker ? 'sticker' : 'custom_emoji';
			toggleReaction(kind, emoji.shortcode, emoji.url);
		}
	}

	function reactorName(r: Reactor): string {
		return r.username ?? r.did.slice(8, 18) + '...';
	}

	function reactorDisplayWithInstance(r: Reactor): string {
		const name = reactorName(r);
		if (r.instance && r.instance !== 'local') return `${name}@${r.instance}`;
		return name;
	}

	$effect(() => {
		void refreshTrigger;
		if (parentDid && parentId) loadReactions();
	});
</script>

<div class="flex flex-wrap items-center gap-1">
	{#each reactions as r (`${r.kind}:${r.value}`)}
		<Tooltip.Root>
			<Tooltip.Trigger>
				<button
					type="button"
					class={cn(
						'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs transition-colors hover:bg-accent',
						r.reacted && 'border-primary/50 bg-primary/10'
					)}
					disabled={toggling !== null}
					onclick={() => toggleReaction(r.kind, r.value, r.image_url)}
				>
					{#if r.kind === 'unicode'}
						<span class="text-sm">{r.value}</span>
					{:else if r.image_url}
						<img src={r.image_url} alt={r.value} class="h-4 w-4 object-contain" />
					{:else}
						<span class="text-xs">:{r.value}:</span>
					{/if}
					<span class="font-medium">{r.count}</span>
				</button>
			</Tooltip.Trigger>
			<Tooltip.Content>
				<div class="flex flex-col gap-0.5 text-xs">
					{#each r.reactors as reactor (reactor.did)}
						<a
							href="/u/{encodeURIComponent(reactor.did)}"
							class="text-primary-foreground underline-offset-2 hover:underline"
						>
							{reactorDisplayWithInstance(reactor)}
						</a>
					{/each}
				</div>
			</Tooltip.Content>
		</Tooltip.Root>
	{/each}

	{#if showPicker}
		<EmojiPicker
			onSelect={handleEmojiReaction}
			triggerClass="h-6 w-6 rounded-full border border-dashed border-muted-foreground/30 hover:border-muted-foreground/60"
		/>
	{/if}
</div>
