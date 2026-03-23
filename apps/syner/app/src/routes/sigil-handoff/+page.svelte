<script lang="ts">
	import { page } from '$app/state';
	import { invoke } from '@tauri-apps/api/core';
	import { fetch } from '@tauri-apps/plugin-http';
	import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@syr-is/ui/card';
	import { Button } from '@syr-is/ui/button';
	import { toast } from 'svelte-sonner';
	import { Loader } from '@lucide/svelte';
	import { validateInstanceUrl } from '$lib/utils/syr-url';
	import type { Persona } from '$lib/types';
	import PersonaImage from '$lib/components/persona-image.svelte';

	const origin = $derived(page.url.searchParams.get('origin') ?? '');
	const sessionId = $derived(page.url.searchParams.get('session') ?? '');
	const expectedDid = $derived(page.url.searchParams.get('did')?.trim() ?? '');

	const hasHandoffSession = $derived(!!sessionId.trim());
	const hasDidBinding = $derived(expectedDid.startsWith('did:syr:'));

	let instanceUrl = $derived(
		origin ? (validateInstanceUrl(origin) ?? validateInstanceUrl(`${origin}/`) ?? null) : null
	);

	let personas = $state<Persona[]>([]);
	let loadingList = $state(true);
	let sending = $state(false);
	let userConfirmed = $state(false);

	let matchingPersonas = $derived(
		hasDidBinding ? personas.filter((p) => p.did === expectedDid) : []
	);
	let targetPersona = $derived(matchingPersonas.length === 1 ? matchingPersonas[0]! : null);

	$effect(() => {
		if (!hasHandoffSession || !hasDidBinding) {
			loadingList = false;
			return;
		}
		void invoke<Persona[]>('list_personas_cmd')
			.then((list) => {
				personas = list ?? [];
			})
			.catch(() => {
				toast.error('Could not load personas');
				personas = [];
			})
			.finally(() => {
				loadingList = false;
			});
	});

	async function sendSigilToBrowser() {
		if (!hasHandoffSession || !instanceUrl || !targetPersona || !userConfirmed) return;
		sending = true;
		try {
			const sigilJson = await invoke<string>('read_persona_encrypted_sigil_json_cmd', {
				personaId: targetPersona.id
			});
			const sigil = JSON.parse(sigilJson) as unknown;
			const base = instanceUrl.replace(/\/$/, '');
			const url = `${base}/api/user/sigil-handoff/${encodeURIComponent(sessionId)}/payload`;
			const res = await fetch(url, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ sigil })
			});
			if (!res.ok) {
				const err = (await res.json().catch(() => ({}))) as {
					message?: string;
					error_description?: string;
					code?: string;
				};
				const msg =
					err.message ??
					err.error_description ??
					(err.code === 'SIGIL_DID_MISMATCH'
						? 'Sigil does not match the SYR account DID.'
						: `HTTP ${res.status}`);
				throw new Error(msg || 'Upload failed');
			}
			toast.success('Encrypted Sigil sent. Return to the browser tab to unlock.');
			userConfirmed = false;
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Failed to send Sigil');
		} finally {
			sending = false;
		}
	}
</script>

<div class="mx-auto max-w-lg space-y-4 p-4">
	<Card>
		<CardHeader>
			<CardTitle>Export Sigil to browser</CardTitle>
			<CardDescription>
				{#if instanceUrl}
					Instance <span class="font-mono">{instanceUrl}</span>
				{:else}
					<span class="font-mono">{origin || '—'}</span>
				{/if}
			</CardDescription>
		</CardHeader>
		<CardContent class="space-y-4 text-sm">
			<p class="text-muted-foreground">
				<strong class="text-foreground">Trust warning:</strong> Only send your Sigil to a browser and
				device you control. The SYR tab will validate the file and store the encrypted payload in session
				storage.
			</p>
			<p class="text-muted-foreground">
				Syner only uploads ciphertext. Your SYR browser tab checks the identity and passphrase
				unlock.
			</p>

			{#if !hasHandoffSession}
				<p
					class="rounded-md border border-amber-200 bg-amber-50 p-3 text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-100"
				>
					This link is missing a <code class="font-mono">session</code> id. Start the handoff from
					<strong>SYR → Settings → Signing → Receive from Syner</strong>, then scan the new QR code
					or open the deep link from there.
				</p>
				<Button variant="outline" href="/">Back</Button>
			{:else if !hasDidBinding}
				<p
					class="rounded-md border border-amber-200 bg-amber-50 p-3 text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-100"
				>
					This QR code is missing <code class="font-mono">did</code>. Generate a new handoff from
					SYR (Signing → Receive from Syner).
				</p>
				<Button variant="outline" href="/">Back</Button>
			{:else if !instanceUrl}
				<p class="text-destructive">Invalid or untrusted instance URL in this link.</p>
				<Button variant="outline" href="/">Back</Button>
			{:else if loadingList}
				<div class="text-muted-foreground flex items-center gap-2">
					<Loader class="h-4 w-4 animate-spin" />
					Loading personas…
				</div>
			{:else if personas.length === 0}
				<p class="text-muted-foreground">
					No personas found. Create or import a persona in Syner first.
				</p>
				<Button variant="outline" href="/">Back</Button>
			{:else if matchingPersonas.length === 0}
				<p class="text-destructive">
					No Syner persona matches <span class="font-mono">{expectedDid}</span>. Import or create
					the identity for this DID, then try again.
				</p>
				<Button variant="outline" href="/">Back</Button>
			{:else if matchingPersonas.length > 1}
				<p class="text-destructive">
					Multiple local personas share this DID. Remove duplicates in Syner, then retry the
					handoff.
				</p>
				<Button variant="outline" href="/">Back</Button>
			{:else if targetPersona}
				<div class="space-y-3 rounded-md border p-3">
					<p class="text-foreground text-xs font-medium tracking-wide uppercase">Requested DID</p>
					<p class="text-muted-foreground font-mono text-xs break-all">{expectedDid}</p>
					<p class="text-foreground text-xs font-medium tracking-wide uppercase">Sending as</p>
					<div class="flex items-center gap-3">
						<PersonaImage
							personaId={targetPersona.id}
							role="avatar"
							mtime={targetPersona.avatarMtime}
							displayName={targetPersona.displayName}
							variant="avatar"
							class="size-12 shrink-0 rounded-full"
						/>
						<div class="min-w-0">
							<div class="truncate font-medium">{targetPersona.displayName}</div>
							<div class="text-muted-foreground truncate font-mono text-xs">
								{targetPersona.did}
							</div>
						</div>
					</div>
				</div>

				<label class="flex cursor-pointer items-start gap-2 text-sm">
					<input type="checkbox" bind:checked={userConfirmed} class="mt-1" />
					<span>
						I confirm I want to send the encrypted Sigil for this identity to the SYR instance
						above.
					</span>
				</label>

				<Button
					class="w-full"
					disabled={!userConfirmed || sending}
					onclick={() => void sendSigilToBrowser()}
				>
					{#if sending}
						<Loader class="mr-2 h-4 w-4 animate-spin" />
						Sending…
					{:else}
						Send encrypted Sigil
					{/if}
				</Button>
			{/if}
		</CardContent>
	</Card>
</div>
