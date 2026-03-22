<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import * as Card from '@syr-is/ui/card';
	import { Button } from '@syr-is/ui/button';
	import { toast } from 'svelte-sonner';
	import type { PageData } from './$types';
	import {
		DEFAULT_MAX_POST_PAYLOAD_BYTES,
		MIN_MAX_POST_PAYLOAD_BYTES,
		MAX_MAX_POST_PAYLOAD_BYTES,
		effectiveMaxPostPayloadBytes
	} from '$lib/client/content-limit-config';

	let { data }: { data: PageData } = $props();

	let maxPostPayloadBytes = $state(DEFAULT_MAX_POST_PAYLOAD_BYTES);

	type RuleRow = { key: string; pattern: string; kind: 'allow' | 'deny' };

	let rules = $state<RuleRow[]>([]);
	let autoAuthor = $state(false);
	let allowData = $state(false);
	let saving = $state(false);

	let savingLimits = $state(false);

	const presetBytes = [
		64 * 1024,
		256 * 1024,
		1024 * 1024,
		2 * 1024 * 1024,
		5 * 1024 * 1024,
		10 * 1024 * 1024
	] as const;

	function formatPreset(n: number): string {
		if (n < 1024 * 1024) return `${n / 1024} KiB`;
		return `${n / (1024 * 1024)} MiB`;
	}

	$effect(() => {
		rules = data.rules.map((r) => ({ key: r.id, pattern: r.pattern, kind: r.kind }));
		autoAuthor = data.content_trust_auto_author_provider;
		allowData = data.content_trust_allow_data_urls;
		maxPostPayloadBytes = data.effective_max_post_payload_bytes;
	});

	function addRow(kind: 'allow' | 'deny') {
		rules = [...rules, { key: crypto.randomUUID(), pattern: '', kind }];
	}

	function removeRow(index: number) {
		rules = rules.filter((_, i) => i !== index);
	}

	function moveRow(index: number, dir: -1 | 1) {
		const j = index + dir;
		if (j < 0 || j >= rules.length) return;
		const next = [...rules];
		[next[index], next[j]] = [next[j], next[index]];
		rules = next;
	}

	async function save() {
		for (const r of rules) {
			if (!r.pattern.trim()) {
				toast.error('Remove empty rows or fill in every pattern');
				return;
			}
			try {
				new URL(r.pattern.trim());
			} catch {
				toast.error(`Invalid URL pattern: ${r.pattern}`);
				return;
			}
		}
		saving = true;
		try {
			const res = await fetch('/api/user/content-trust', {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					rules: rules.map((r) => ({ pattern: r.pattern.trim(), kind: r.kind })),
					content_trust_auto_author_provider: autoAuthor,
					content_trust_allow_data_urls: allowData
				})
			});
			if (!res.ok) {
				const err = await res.json().catch(() => ({}));
				throw new Error(err?.message ?? 'Save failed');
			}
			toast.success('Content trust settings saved');
			await invalidateAll();
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Save failed');
		} finally {
			saving = false;
		}
	}

	async function saveContentLimits() {
		const n = Number(maxPostPayloadBytes);
		if (!Number.isFinite(n) || n < MIN_MAX_POST_PAYLOAD_BYTES || n > MAX_MAX_POST_PAYLOAD_BYTES) {
			toast.error(
				`Limit must be between ${MIN_MAX_POST_PAYLOAD_BYTES} and ${MAX_MAX_POST_PAYLOAD_BYTES} bytes`
			);
			return;
		}
		savingLimits = true;
		try {
			const res = await fetch('/api/user/content-limits', {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ max_post_payload_bytes: Math.floor(n) })
			});
			if (!res.ok) {
				const err = await res.json().catch(() => ({}));
				throw new Error(err?.error?.message ?? err?.message ?? 'Save failed');
			}
			toast.success('Content limits saved');
			await invalidateAll();
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Save failed');
		} finally {
			savingLimits = false;
		}
	}
</script>

<div class="mx-auto max-w-2xl space-y-6">
	<div>
		<h1 class="text-2xl font-semibold">Content trust</h1>
		<p class="mt-1 text-sm text-muted-foreground">
			Control which <strong class="font-medium text-foreground">origins and paths</strong> may load in
			blog HTML, markdown, and media posts. Deny rules win over allows. Your SYR instance origin is always
			allowed unless you block it with a deny rule. Unknown URLs stay blocked on the post page until
			you consent once per post or add a rule.
		</p>
	</div>

	<Card.Root>
		<Card.Header>
			<Card.Title>URL rules</Card.Title>
			<Card.Description>
				Use full URLs. Prefix matching applies (e.g. <code class="text-xs"
					>https://site/u/alice</code
				>
				matches deeper paths). Add <code class="text-xs">*</code> for one path segment and
				<code class="text-xs">**</code> for nested paths (e.g.
				<code class="text-xs">https://cdn.example.com/pub/**</code>).
			</Card.Description>
		</Card.Header>
		<Card.Content class="space-y-3">
			{#if rules.length === 0}
				<p class="text-sm text-muted-foreground">
					No rules yet — only same-origin resources load by default.
				</p>
			{/if}
			<ul class="space-y-2">
				{#each rules as row, i (row.key)}
					<li class="flex flex-wrap items-center gap-2 rounded-md border bg-muted/20 p-2">
						<select
							bind:value={rules[i].kind}
							class="rounded border bg-background px-2 py-1 text-xs font-medium capitalize"
						>
							<option value="allow">allow</option>
							<option value="deny">deny</option>
						</select>
						<input
							type="url"
							bind:value={rules[i].pattern}
							placeholder="https://example.com/path"
							class="min-w-[10rem] flex-1 rounded border bg-background px-2 py-1 text-xs"
						/>
						<div class="flex gap-1">
							<Button
								type="button"
								variant="ghost"
								size="sm"
								onclick={() => moveRow(i, -1)}
								disabled={i === 0}
							>
								Up
							</Button>
							<Button
								type="button"
								variant="ghost"
								size="sm"
								onclick={() => moveRow(i, 1)}
								disabled={i === rules.length - 1}
							>
								Down
							</Button>
							<Button type="button" variant="ghost" size="sm" onclick={() => removeRow(i)}
								>Remove</Button
							>
						</div>
					</li>
				{/each}
			</ul>
			<div class="flex flex-wrap gap-2">
				<Button type="button" variant="outline" size="sm" onclick={() => addRow('allow')}>
					Add allow rule
				</Button>
				<Button type="button" variant="outline" size="sm" onclick={() => addRow('deny')}>
					Add deny rule
				</Button>
			</div>
		</Card.Content>
	</Card.Root>

	<Card.Root>
		<Card.Header>
			<Card.Title>Options</Card.Title>
		</Card.Header>
		<Card.Content class="space-y-3 text-sm">
			<label class="flex cursor-pointer items-start gap-2">
				<input type="checkbox" bind:checked={autoAuthor} class="mt-1" />
				<span>
					<span class="font-medium">Auto-trust author publication registries</span>
					<span class="mt-0.5 block text-xs text-muted-foreground">
						Allow subresources under the same origin as registry URLs where the author listed their
						DID. Convenience only — not a safety proof.
					</span>
				</span>
			</label>
			<label class="flex cursor-pointer items-start gap-2">
				<input type="checkbox" bind:checked={allowData} class="mt-1" />
				<span>
					<span class="font-medium">Allow data: and blob: in sanitized HTML</span>
					<span class="mt-0.5 block text-xs text-muted-foreground"
						>Off by default (smaller attack surface).</span
					>
				</span>
			</label>
		</Card.Content>
	</Card.Root>

	<Card.Root>
		<Card.Header>
			<Card.Title>Post JSON size limit</Card.Title>
			<Card.Description>
				Caps how much decoded post JSON (body, signatures, media URL list) this browser tab will
				load for feeds, pinned lists, and remote timelines. It does not limit media bytes after a
				post loads. Default when unset:
				{DEFAULT_MAX_POST_PAYLOAD_BYTES / (1024 * 1024)} MiB. You can still choose
				<strong>Load anyway</strong> per post (this session only).
			</Card.Description>
		</Card.Header>
		<Card.Content class="space-y-4 text-sm">
			<div class="flex flex-wrap items-end gap-3">
				<label class="flex flex-col gap-1">
					<span class="text-xs font-medium text-muted-foreground">Max bytes (UTF-8 estimate)</span>
					<input
						type="number"
						class="w-40 rounded border bg-background px-2 py-1 font-mono text-xs"
						min={MIN_MAX_POST_PAYLOAD_BYTES}
						max={MAX_MAX_POST_PAYLOAD_BYTES}
						bind:value={maxPostPayloadBytes}
					/>
				</label>
				<Button type="button" onclick={saveContentLimits} disabled={savingLimits}>
					{savingLimits ? 'Saving…' : 'Save limit'}
				</Button>
			</div>
			<div class="flex flex-wrap gap-2">
				<span class="w-full text-xs text-muted-foreground">Presets</span>
				{#each presetBytes as b (b)}
					<Button
						type="button"
						variant="outline"
						size="sm"
						onclick={() => (maxPostPayloadBytes = b)}
					>
						{formatPreset(b)}
					</Button>
				{/each}
			</div>
			<p class="text-xs text-muted-foreground">
				Stored preference:
				{#if data.stored_content_max_post_bytes == null}
					none (using default).
				{:else}
					{data.stored_content_max_post_bytes} B.
				{/if}
				Effective: {effectiveMaxPostPayloadBytes(data.stored_content_max_post_bytes ?? undefined)} B.
			</p>
		</Card.Content>
	</Card.Root>

	<Button type="button" onclick={save} disabled={saving}
		>{saving ? 'Saving…' : 'Save changes'}</Button
	>
</div>
