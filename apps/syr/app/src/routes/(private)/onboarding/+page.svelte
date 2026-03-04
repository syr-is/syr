<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@syr-is/ui/card';
	import { Button } from '@syr-is/ui/button';
	import { CheckCircle } from 'lucide-svelte';
	import type { PageData } from './$types';

	let { data: _data }: { data: PageData } = $props();

	async function continueHome() {
		await goto(resolve('/'));
	}
</script>

<svelte:head>
	<title>Complete your profile | SYR</title>
</svelte:head>

<div class="mx-auto max-w-md space-y-6 p-4">
	<Card>
		<CardHeader>
			<CardTitle class="flex items-center gap-2">
				<CheckCircle class="h-5 w-5 text-green-600" />
				Profile complete
			</CardTitle>
			<CardDescription>Your profile is set up. Continue to your dashboard.</CardDescription>
		</CardHeader>
		<CardContent>
			<Button onclick={continueHome} class="w-full">Continue to home</Button>
		</CardContent>
	</Card>
</div>
