<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import * as Card from '$lib/components/ui/card';
	import * as Avatar from '$lib/components/ui/avatar';
	import { resolve } from '$app/paths';

	let { data } = $props();

	async function handleLogout() {
		try {
			const response = await fetch(resolve('/api/auth/logout'), {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json'
				}
			});

			if (response.ok) {
				window.location.reload();
			}
		} catch (error) {
			console.error('Logout error:', error);
		}
	}
</script>

<div class="flex min-h-screen flex-col items-center justify-center bg-background p-4">
	<div class="max-w-3xl space-y-8">
		{#if data.user}
			<!-- Logged In View -->
			<div class="space-y-6 text-center">
				<h1 class="text-4xl font-bold tracking-tight sm:text-6xl">
					Welcome back, <span class="text-primary"
						>{data.user.profile?.display_name ?? data.user.username}</span
					>!
				</h1>
			</div>

			<Card.Root>
				<Card.Content class="pt-6">
					<div class="flex flex-col items-center gap-6">
						<Avatar.Root class="h-24 w-24">
							<Avatar.Image src={data.user.profile?.avatar_url} alt={data.user.username} />
							<Avatar.Fallback class="text-3xl">
								{data.user.profile?.display_name?.charAt(0).toUpperCase() ??
									data.user.username.charAt(0).toUpperCase()}
							</Avatar.Fallback>
						</Avatar.Root>

						<div class="space-y-3 text-center">
							<div>
								<h2 class="text-2xl font-semibold">
									{data.user.profile?.display_name ?? data.user.username}
								</h2>
								<p class="text-muted-foreground">
									@{data.user.username}
									{#if data.user.role === 'ADMIN'}
										<span
											class="ml-2 inline-flex items-center rounded-full bg-primary/10 px-2 py-1 text-xs font-medium text-primary"
										>
											Admin
										</span>
									{/if}
								</p>
							</div>

							{#if data.user.profile?.bio}
								<p class="max-w-md text-sm text-muted-foreground">
									{data.user.profile.bio}
								</p>
							{/if}
						</div>

						<div class="flex w-full gap-3 pt-2">
							<Button class="flex-1" variant="outline" onclick={handleLogout}>Sign Out</Button>
						</div>
					</div>
				</Card.Content>
			</Card.Root>
		{:else}
			<!-- Logged Out View -->
			<div class="space-y-4 text-center">
				<h1 class="text-4xl font-bold tracking-tight sm:text-6xl">
					Welcome to <span class="text-primary">SYR</span>
				</h1>
				<p class="text-xl text-muted-foreground">Self-Yield Representation</p>
				<p class="text-lg text-muted-foreground">
					Your sovereign digital presence. No algorithms, no lock-in, just you.
				</p>
			</div>

			<div class="flex flex-col gap-4 sm:flex-row sm:justify-center">
				<Button size="lg" href="/register">Create Account</Button>
				<Button size="lg" variant="outline" href="/login">Sign In</Button>
			</div>
		{/if}

		<Card.Root class="mt-12 text-left">
			<Card.Header>
				<Card.Title>Built on Open Standards</Card.Title>
			</Card.Header>
			<Card.Content class="grid gap-4 sm:grid-cols-3">
				<div class="space-y-2">
					<h3 class="font-semibold">ActivityPub</h3>
					<p class="text-sm text-muted-foreground">
						Federated social networking with portable identity
					</p>
				</div>
				<div class="space-y-2">
					<h3 class="font-semibold">did:web</h3>
					<p class="text-sm text-muted-foreground">
						DNS-based decentralized identifiers you control
					</p>
				</div>
				<div class="space-y-2">
					<h3 class="font-semibold">W3C VCs</h3>
					<p class="text-sm text-muted-foreground">Verifiable credentials for digital reputation</p>
				</div>
			</Card.Content>
		</Card.Root>
	</div>
</div>
