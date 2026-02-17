<script lang="ts">
	import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@syr-is/ui/card';
	import { Button } from '@syr-is/ui/button';
	import ExternalLink from '@lucide/svelte/icons/external-link';

	let { data } = $props();
	const did = $derived(data.did);
	const record = $derived(data.record);
	const apiBase = $derived(data.apiBase);
	const apiExample = $derived(`POST ${apiBase}/delete
Content-Type: application/json

{
  "did": "${did}",
  "deletedAt": "ISO-8601 timestamp",
  "signature": "multibase-encoded Ed25519 signature over canonical { did, deletedAt }"
}`);

	function truncate(s: string, len: number): string {
		if (s.length <= len) return s;
		return s.slice(0, len / 2) + '…' + s.slice(-len / 2);
	}

	const wellKnownUrl = $derived(
		record ? `${record.provider.replace(/\/$/, '')}/.well-known/did/${encodeURIComponent(did)}` : ''
	);
</script>

<div class="container mx-auto max-w-2xl px-4 py-8">
	<h1 class="mb-2 text-xl font-semibold text-muted-foreground">🔑 SYR Registry</h1>

	{#if !record}
		<Card>
			<CardHeader>
				<CardTitle>Not Found</CardTitle>
				<CardDescription>
					No hosting record found for <code
						class="break-all rounded bg-muted px-1.5 py-0.5 font-mono text-sm">{did}</code
					>.
				</CardDescription>
			</CardHeader>
			<CardContent>
				<p class="text-sm text-muted-foreground">
					This DID is not currently listed on this registry.
				</p>
			</CardContent>
		</Card>
	{:else}
		<Card class="mb-4">
			<CardHeader>
				<CardTitle>Hosting Record</CardTitle>
				<CardDescription>Current provider for this DID</CardDescription>
			</CardHeader>
			<CardContent class="space-y-3">
				<div class="grid gap-2 text-sm">
					<div>
						<span class="text-muted-foreground">DID</span>
						<code class="ml-2 block break-all rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
							{record.did}
						</code>
					</div>
					<div>
						<span class="text-muted-foreground">Provider</span>
						<a
							href={record.provider}
							target="_blank"
							rel="noopener noreferrer"
							class="ml-2 block break-all text-primary underline-offset-4 hover:underline"
						>
							{record.provider}
						</a>
					</div>
					<div>
						<span class="text-muted-foreground">Last Updated</span>
						<span class="ml-2">{record.updatedAt}</span>
					</div>
					<div>
						<span class="text-muted-foreground">Signature</span>
						<code class="ml-2 block font-mono text-xs text-muted-foreground">
							{truncate(record.signature, 48)}
						</code>
					</div>
				</div>
				<a
					href={wellKnownUrl}
					target="_blank"
					rel="noopener noreferrer"
				>
					<Button variant="outline" size="sm">
						<ExternalLink class="mr-1.5 size-4" />
						View DID Document
					</Button>
				</a>
			</CardContent>
		</Card>

		<Card class="border-destructive/30">
			<CardHeader>
				<CardTitle class="text-destructive">Remove Listing</CardTitle>
				<CardDescription>
					To remove this listing, send a signed <code
						class="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">POST /delete</code
					> request with your DID's private key.
				</CardDescription>
			</CardHeader>
			<CardContent>
				<p class="mb-3 text-sm text-muted-foreground">
					Your SYR provider can do this for you from the Identity Settings page.
				</p>
				<details class="text-sm">
					<summary class="cursor-pointer text-muted-foreground">API Details</summary>
					<pre class="mt-2 overflow-x-auto rounded-lg bg-muted p-4 font-mono text-xs"><code
							>{apiExample}</code
						></pre>
				</details>
			</CardContent>
		</Card>
	{/if}
</div>
