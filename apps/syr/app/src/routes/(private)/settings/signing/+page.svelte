<script lang="ts">
	import * as Card from '@syr-is/ui/card';
	import { Label } from '@syr-is/ui/label';
	import { onMount } from 'svelte';
	import { toast } from 'svelte-sonner';

	let warn = $state(true);
	let explicit = $state(true);
	let loading = $state(true);
	let saving = $state(false);

	onMount(async () => {
		try {
			const res = await fetch('/api/user/signing-preferences');
			const j = await res.json();
			if (res.ok && j.data) {
				warn = j.data.signing_warn_before_each_action ?? warn;
				explicit = j.data.signing_require_explicit_sign_button ?? explicit;
			}
		} catch {
			toast.error('Could not load signing preferences');
		} finally {
			loading = false;
		}
	});

	async function save(patch: Record<string, boolean>) {
		saving = true;
		try {
			const res = await fetch('/api/user/signing-preferences', {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(patch)
			});
			const j = await res.json();
			if (!res.ok) {
				toast.error(j.error?.message ?? 'Save failed');
				return;
			}
			toast.success('Saved');
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Save failed');
		} finally {
			saving = false;
		}
	}
</script>

<div class="mx-auto max-w-2xl space-y-6 p-4">
	<Card.Root>
		<Card.Header>
			<Card.Title>Signing behavior</Card.Title>
			<Card.Description>
				Controls how the app asks you before cryptographic signing (profile, posts, follows when
				signed).
			</Card.Description>
		</Card.Header>
		<Card.Content class="space-y-6">
			{#if loading}
				<p class="text-sm text-muted-foreground">Loading…</p>
			{:else}
				<div class="flex items-start justify-between gap-4">
					<div class="space-y-1">
						<Label for="warn">Warn before each sign</Label>
						<p class="text-xs text-muted-foreground">
							Show a confirmation step summarizing what will be signed.
						</p>
					</div>
					<input
						id="warn"
						type="checkbox"
						class="mt-1 size-4"
						checked={warn}
						disabled={saving}
						onchange={(e) => {
							const v = e.currentTarget.checked;
							warn = v;
							void save({ signing_warn_before_each_action: v });
						}}
					/>
				</div>
				<div class="flex items-start justify-between gap-4">
					<div class="space-y-1">
						<Label for="explicit">Require explicit Sign control</Label>
						<p class="text-xs text-muted-foreground">
							Prefer a dedicated “Sign” / “Sign and submit” action where the UI supports it.
						</p>
					</div>
					<input
						id="explicit"
						type="checkbox"
						class="mt-1 size-4"
						checked={explicit}
						disabled={saving}
						onchange={(e) => {
							const v = e.currentTarget.checked;
							explicit = v;
							void save({ signing_require_explicit_sign_button: v });
						}}
					/>
				</div>
			{/if}
		</Card.Content>
	</Card.Root>

	<Card.Root>
		<Card.Header>
			<Card.Title>Sigil signing session</Card.Title>
			<Card.Description>
				When you import an encrypted Sigil into this browser for signing, it should live only in
				session storage until you log out or clear it. Prefer a trusted personal device; anyone with
				access to the device could sign as you until the session ends.
			</Card.Description>
		</Card.Header>
	</Card.Root>
</div>
