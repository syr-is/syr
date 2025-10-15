<script lang="ts">
	import * as Card from '$lib/components/ui/card';
	import * as Avatar from '$lib/components/ui/avatar';

	let { data } = $props();
</script>

<div class="flex min-h-full flex-col items-center justify-center">
	<div class="max-w-3xl space-y-8 py-8">
		{#if data.user}
			<!-- Logged In View -->
			<div class="space-y-6 text-center">
				<h1 class="text-4xl font-bold tracking-tight sm:text-6xl">
					Welcome back, <span class="text-primary"
						>{data.user.profile?.display_name ?? data.user.username}</span
					>!
				</h1>
			</div>

			<!-- Discord-style Profile Card -->
			<Card.Root class="overflow-hidden">
				<!-- Banner -->
				{#if data.user.profile?.banner_url}
					<div class="relative h-32 bg-gradient-to-r from-blue-500 to-purple-600">
						<img
							src={data.user.profile.banner_url}
							alt="Profile banner"
							class="h-full w-full object-cover"
						/>
					</div>
				{:else}
					<div class="h-32 bg-gradient-to-r from-blue-500 to-purple-600"></div>
				{/if}

				<Card.Content class="relative pb-6 pt-16">
					<!-- Avatar positioned over banner -->
					<div class="absolute -top-12 left-6">
						<Avatar.Root class="border-background h-24 w-24 border-4">
							<Avatar.Image
								src={data.user.profile?.avatar_url}
								alt={data.user.profile?.display_name ?? data.user.username}
							/>
							<Avatar.Fallback class="text-2xl">
								{data.user.profile?.display_name?.charAt(0).toUpperCase() ??
									data.user.username.charAt(0).toUpperCase()}
							</Avatar.Fallback>
						</Avatar.Root>
					</div>

					<!-- Profile Info -->
					<div class="space-y-4">
						<div class="space-y-2">
							<div class="flex items-center gap-2">
								<h2 class="text-2xl font-bold">
									{data.user.profile?.display_name ?? data.user.username}
								</h2>
								{#if data.user.role === 'ADMIN'}
									<span
										class="bg-primary/10 text-primary inline-flex items-center rounded-full px-2 py-1 text-xs font-medium"
									>
										Admin
									</span>
								{/if}
							</div>
							<p class="text-muted-foreground text-lg">@{data.user.username}</p>
						</div>

						{#if data.user.profile?.bio}
							<div class="bg-muted/50 rounded-lg p-4">
								<p class="text-sm leading-relaxed">
									{data.user.profile.bio}
								</p>
							</div>
						{/if}
					</div>
				</Card.Content>
			</Card.Root>
		{:else}
			<!-- Logged Out View -->
			<div class="space-y-4 text-center">
				<h1 class="text-4xl font-bold tracking-tight sm:text-6xl">
					Welcome to <span class="text-primary">SYR</span>
				</h1>
				<p class="text-muted-foreground text-xl">Self-Yield Representation</p>
				<p class="text-muted-foreground text-lg">
					Your sovereign digital presence. No algorithms, no lock-in, just you.
				</p>
			</div>
		{/if}

		<Card.Root class="mt-12 text-left">
			<Card.Header>
				<Card.Title>Built on Open Standards</Card.Title>
			</Card.Header>
			<Card.Content class="grid gap-4 sm:grid-cols-3">
				<div class="space-y-2">
					<h3 class="font-semibold">ActivityPub</h3>
					<p class="text-muted-foreground text-sm">
						Federated social networking with portable identity
					</p>
				</div>
				<div class="space-y-2">
					<h3 class="font-semibold">did:web</h3>
					<p class="text-muted-foreground text-sm">
						DNS-based decentralized identifiers you control
					</p>
				</div>
				<div class="space-y-2">
					<h3 class="font-semibold">W3C VCs</h3>
					<p class="text-muted-foreground text-sm">Verifiable credentials for digital reputation</p>
				</div>
			</Card.Content>
		</Card.Root>
	</div>
</div>
