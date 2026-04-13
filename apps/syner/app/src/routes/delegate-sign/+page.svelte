<script lang="ts">
	import { page } from '$app/state';
	import { invoke } from '@tauri-apps/api/core';
	import { fetch } from '@tauri-apps/plugin-http';
	import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@syr-is/ui/card';
	import { Button } from '@syr-is/ui/button';
	import { Input } from '@syr-is/ui/input';
	import { Label } from '@syr-is/ui/label';
	import { toast } from 'svelte-sonner';
	import { Loader, ShieldCheck, ExternalLink } from '@lucide/svelte';
	import { validateInstanceUrl } from '$lib/utils/syr-url';
	import { resolveSynerEndpoint } from '$lib/instance-manifest';
	import type { Persona } from '$lib/types';
	import PersonaImage from '$lib/components/persona-image.svelte';

	// Query params from syr://delegate deeplink
	const challengeId = $derived(page.url.searchParams.get('challenge') ?? '');
	const instanceRaw = $derived(page.url.searchParams.get('instance') ?? '');
	const platformName = $derived(page.url.searchParams.get('platform_name') ?? '');
	const platformOrigin = $derived(page.url.searchParams.get('platform_origin') ?? '');
	const expectedDid = $derived(page.url.searchParams.get('did') ?? '');
	const expectedDelegate = $derived(page.url.searchParams.get('delegate') ?? '');

	let instanceUrl = $derived(instanceRaw ? (validateInstanceUrl(instanceRaw) ?? null) : null);

	let personas = $state<Persona[]>([]);
	let loadingList = $state(true);
	let sending = $state(false);
	let passphrase = $state('');

	// Server-fetched payload
	let serverMessage = $state<string | null>(null);
	let serverDelegateKey = $state<string | null>(null);
	let loadError = $state<string | null>(null);

	// Matching persona
	const matchingPersona = $derived(
		expectedDid ? personas.find((p) => p.did === expectedDid) : null
	);

	// Cross-check: delegate key from deeplink matches server
	const delegateKeyMatch = $derived(
		serverDelegateKey != null && expectedDelegate === serverDelegateKey
	);

	// Load personas
	$effect(() => {
		loadingList = true;
		invoke<Persona[]>('list_personas_cmd')
			.then((list) => {
				personas = list;
			})
			.catch(() => {
				personas = [];
			})
			.finally(() => {
				loadingList = false;
			});
	});

	// Fetch delegation payload from server
	$effect(() => {
		if (!instanceUrl || !challengeId) return;
		let cancelled = false;

		(async () => {
			try {
				const payloadUrl = await resolveSynerEndpoint(
					instanceUrl!,
					'delegation_challenge_payload',
					challengeId
				);
				const res = await fetch(payloadUrl, {
					headers: { Accept: 'application/json' }
				});
				if (!res.ok) {
					if (!cancelled) loadError = 'Challenge expired or not found';
					return;
				}
				const data = await res.json();
				if (!cancelled) {
					serverMessage = data.message ?? null;
					serverDelegateKey = data.delegate_public_key ?? null;
				}
			} catch (err) {
				if (!cancelled) loadError = err instanceof Error ? err.message : 'Failed to load challenge';
			}
		})();

		return () => {
			cancelled = true;
		};
	});

	async function handleSign() {
		if (!matchingPersona || !passphrase.trim() || !serverMessage || !instanceUrl) return;
		sending = true;
		try {
			// Decrypt persona sigil
			const sigilJson: string = await invoke('read_persona_encrypted_sigil_json_cmd', {
				personaId: matchingPersona.id
			});
			const seedBytes: number[] = await invoke('decrypt_sigil_cmd', {
				sigilJson,
				passphrase: passphrase.trim()
			});
			const seedBase64 = btoa(String.fromCharCode(...seedBytes));

			// Sign the canonical delegation statement
			const messageBytes = new TextEncoder().encode(serverMessage);
			const sigBytes: number[] = await invoke('sign_payload', {
				payload: Array.from(messageBytes),
				privateKeyBase64: seedBase64
			});

			// Encode signature as multibase
			const signatureMultibase: string = await invoke('encode_multibase_cmd', {
				bytes: sigBytes
			});

			// Post to delegation-verify
			const verifyUrl = await resolveSynerEndpoint(instanceUrl!, 'delegation_verify');
			const res = await fetch(verifyUrl, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					challenge_id: challengeId,
					did: matchingPersona.did,
					signature: signatureMultibase
				})
			});

			if (!res.ok) {
				const err = await res.json().catch(() => ({}));
				throw new Error(err.error_description ?? 'Verification failed');
			}

			// Save delegation to persona file
			try {
				await invoke('add_persona_delegation_cmd', {
					personaId: matchingPersona.id,
					delegationJson: JSON.stringify({
						delegate_public_key: expectedDelegate,
						platform_origin: platformOrigin,
						platform_name: platformName,
						scope: 'platform',
						created_at: new Date().toISOString(),
						instance_url: instanceUrl
					})
				});
			} catch {
				// Non-critical — delegation was created on server, local tracking is best-effort
			}

			toast.success('Delegation authorized');
			// Close or navigate away after short delay
			setTimeout(() => window.close(), 1500);
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Signing failed');
		} finally {
			sending = false;
		}
	}
</script>

<div class="container mx-auto max-w-lg space-y-6 p-6">
	<Card>
		<CardHeader>
			<CardTitle class="flex items-center gap-2">
				<ShieldCheck class="h-5 w-5" />
				Platform Delegation
			</CardTitle>
			<CardDescription>Authorize a platform to sign content on your behalf</CardDescription>
		</CardHeader>
		<CardContent class="space-y-4">
			{#if loadError}
				<p class="text-destructive text-sm">{loadError}</p>
			{:else if !serverMessage}
				<div class="text-muted-foreground flex items-center gap-2">
					<Loader class="h-4 w-4 animate-spin" />
					<span class="text-sm">Loading delegation details...</span>
				</div>
			{:else}
				<!-- Platform info -->
				<div class="space-y-2 rounded-md border p-3">
					<div class="flex justify-between text-sm">
						<span class="text-muted-foreground">Platform</span>
						<span class="font-medium">{platformName}</span>
					</div>
					<div class="flex justify-between text-sm">
						<span class="text-muted-foreground">Origin</span>
						<a
							href={platformOrigin}
							target="_blank"
							rel="noopener"
							class="text-primary flex items-center gap-1 font-mono text-xs hover:underline"
						>
							{platformOrigin}
							<ExternalLink class="h-3 w-3" />
						</a>
					</div>
					<div class="text-sm">
						<span class="text-muted-foreground">Delegate key</span>
						<p
							class="text-muted-foreground mt-0.5 font-mono text-[10px] break-all"
							title={expectedDelegate}
						>
							{expectedDelegate}
						</p>
					</div>
					{#if !delegateKeyMatch && serverDelegateKey}
						<p class="text-destructive text-xs font-medium">
							Warning: delegate key from deeplink does not match server. Do not sign.
						</p>
					{/if}
				</div>

				<!-- Persona selection -->
				{#if loadingList}
					<div class="text-muted-foreground flex items-center gap-2">
						<Loader class="h-4 w-4 animate-spin" />
						<span class="text-sm">Loading personas...</span>
					</div>
				{:else if !matchingPersona}
					<p class="text-destructive text-sm">
						No persona found for DID {expectedDid.slice(0, 24)}...
					</p>
				{:else}
					<div class="flex items-center gap-3 rounded-md border p-3">
						<PersonaImage
							personaId={matchingPersona.id}
							role="avatar"
							mtime={matchingPersona.avatarMtime}
							displayName={matchingPersona.displayName}
							class="h-10 w-10 rounded-full"
						/>
						<div>
							<p class="text-sm font-medium">{matchingPersona.displayName}</p>
							<p class="text-muted-foreground font-mono text-[10px]">
								{matchingPersona.did.slice(0, 24)}...
							</p>
						</div>
					</div>

					<div class="space-y-2">
						<Label for="passphrase">Passphrase</Label>
						<Input
							id="passphrase"
							type="password"
							placeholder="Enter your Sigil passphrase"
							bind:value={passphrase}
							onkeydown={(e) =>
								e.key === 'Enter' &&
								!sending &&
								passphrase.trim() &&
								delegateKeyMatch &&
								handleSign()}
						/>
					</div>

					<Button
						class="w-full"
						disabled={sending || !passphrase.trim() || !delegateKeyMatch}
						onclick={handleSign}
					>
						{#if sending}
							<Loader class="mr-2 h-4 w-4 animate-spin" />
							Signing...
						{:else}
							Authorize Delegation
						{/if}
					</Button>
				{/if}
			{/if}
		</CardContent>
	</Card>
</div>
