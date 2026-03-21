<script lang="ts">
	import { page } from '$app/state';
	import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@syr-is/ui/card';
	import { Button } from '@syr-is/ui/button';

	const origin = $derived(page.url.searchParams.get('origin') ?? '');
</script>

<div class="mx-auto max-w-lg space-y-4 p-4">
	<Card>
		<CardHeader>
			<CardTitle>Export Sigil to browser</CardTitle>
			<CardDescription>
				A web app requested signing material for origin <span class="font-mono"
					>{origin || '—'}</span
				>.
			</CardDescription>
		</CardHeader>
		<CardContent class="space-y-3 text-sm">
			<p class="text-muted-foreground">
				<strong class="text-foreground">Trust warning:</strong> The device and browser where the Sigil
				will be unlocked must be trusted. Anyone with access to that device, malware, or a compromised
				browser profile could sign as you until the session ends or the key is revoked.
			</p>
			<p class="text-muted-foreground">
				Transfer only the <strong class="text-foreground">encrypted Sigil file</strong> (ciphertext).
				Do not send plaintext private keys or session unwrap secrets over the network.
			</p>
			<p class="text-muted-foreground">
				Use your persona’s export flow to produce the encrypted file, then deliver it to the
				requesting app via QR chunking, OS share, or another local channel the browser can read.
			</p>
			<Button variant="outline" href="/">Back</Button>
		</CardContent>
	</Card>
</div>
