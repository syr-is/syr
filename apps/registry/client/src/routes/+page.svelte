<script lang="ts">
	import { Button } from '@syr-is/ui/button';
	import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@syr-is/ui/card';
</script>

<div class="container mx-auto max-w-2xl px-4 py-16">
	<h1 class="mb-2 text-2xl font-semibold">🔑 SYR Registry</h1>
	<p class="mb-8 text-muted-foreground">
		View hosting records for did:syr identities. Enter a DID to check its registration status.
	</p>

	<Card>
		<CardHeader>
			<CardTitle>Check DID</CardTitle>
			<CardDescription>
				Navigate to <code class="rounded bg-muted px-1.5 py-0.5 font-mono text-sm"
					>/manage/[did]</code
				> to view a hosting record.
			</CardDescription>
		</CardHeader>
		<CardContent>
			<a href="/manage/did:syr:z6Mkt9example">
				<Button variant="outline">Example: did:syr:z6Mkt9...</Button>
			</a>
		</CardContent>
	</Card>
</div>
