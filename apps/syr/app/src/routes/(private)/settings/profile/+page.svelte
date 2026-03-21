<script lang="ts">
	import { superForm, defaults } from 'sveltekit-superforms';
	import { zod4 } from 'sveltekit-superforms/adapters';
	import * as Form from '@syr-is/ui/form';
	import { Input } from '@syr-is/ui/input';
	import { Textarea } from '@syr-is/ui/textarea';
	import * as Card from '@syr-is/ui/card';
	import { Button } from '@syr-is/ui/button';
	import { Avatar, AvatarFallback, AvatarImage } from '@syr-is/ui/avatar';
	import { toast } from 'svelte-sonner';
	import { invalidateAll } from '$app/navigation';
	import { ProfileUpdateSchema } from '@syr-is/types';
	import type { PageData } from './$types';
	import SignatureVerification from '$lib/components/fragments/signature-verification.svelte';

	let { data }: { data: PageData } = $props();
	let loading = $state(false);
	let usernameValue = $state('');
	let usernameLoading = $state(false);

	$effect(() => {
		if (data.user?.username) usernameValue = data.user.username;
	});

	async function handleUsernameUpdate() {
		const trimmed = usernameValue.trim();
		if (!trimmed || trimmed === data.user?.username) return;
		usernameLoading = true;
		try {
			const res = await fetch('/api/user/username', {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ username: trimmed })
			});
			const json = await res.json();
			if (!res.ok) {
				toast.error(json.message ?? 'Failed to update username');
				return;
			}
			toast.success('Username updated');
			await invalidateAll();
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Failed to update username');
		} finally {
			usernameLoading = false;
		}
	}
	const form = superForm(defaults(zod4(ProfileUpdateSchema)), {
		validators: zod4(ProfileUpdateSchema),
		SPA: true,
		resetForm: false,
		onUpdate: async ({ form }) => {
			if (!form.valid) return;

			loading = true;
			try {
				const response = await fetch('/api/user/profile', {
					method: 'PATCH',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify(form.data)
				});

				if (!response.ok) {
					const error = await response.json();
					toast.error(error.error?.message || 'Failed to update profile');
					return;
				}

				toast.success('Profile updated successfully');
				await invalidateAll();
			} catch (_error) {
				console.error('Failed to update profile:', _error);
				toast.error('An unexpected error occurred');
			} finally {
				loading = false;
			}
		}
	});

	const { form: formData, enhance } = form;

	// Sync form with current user data when data changes
	$effect(() => {
		const user = data.user?.profile;
		if (user) {
			$formData.display_name = user.display_name || '';
			$formData.bio = user.bio || '';
			$formData.avatar_url = user.avatar_url || '';
			$formData.banner_url = user.banner_url || '';
		}
	});
</script>

{#if data.user}
	<div class="mx-auto grid max-w-5xl grid-cols-1 gap-6 md:grid-cols-[1fr_auto]">
		<div class="flex flex-col gap-6">
			<Card.Root>
				<Card.Header>
					<Card.Title>Username</Card.Title>
					<Card.Description>
						Your handle on this instance. You can change it at most once every
						{data.usernameChangeCooldownDays} day{data.usernameChangeCooldownDays === 1 ? '' : 's'}.
					</Card.Description>
				</Card.Header>
				<Card.Content class="space-y-4">
					{#if data.canChangeUsername}
						<div class="flex gap-2">
							<Input
								bind:value={usernameValue}
								placeholder="username"
								class="font-mono"
								pattern="[a-zA-Z0-9_-]+"
								title="Letters, numbers, underscores, and hyphens only (3–30 chars)"
							/>
							<Button
								onclick={handleUsernameUpdate}
								disabled={usernameLoading || usernameValue.trim() === data.user?.username}
							>
								{usernameLoading ? 'Updating…' : 'Update'}
							</Button>
						</div>
						<p class="text-sm text-muted-foreground">
							Letters, numbers, underscores, and hyphens. 3–30 characters.
						</p>
					{:else}
						<p class="text-sm text-muted-foreground">
							@{data.user.username}. You can change your username again on
							{data.nextUsernameChangeAt
								? new Date(data.nextUsernameChangeAt).toLocaleDateString(undefined, {
										year: 'numeric',
										month: 'short',
										day: 'numeric'
									})
								: '—'}
						</p>
					{/if}
				</Card.Content>
			</Card.Root>

			<Card.Root>
				<Card.Header>
					<Card.Title>Profile Information</Card.Title>
					<Card.Description>Update your profile information and preferences.</Card.Description>
					{#if data.user?.did && data.user.profile}
						<div class="pt-2">
							<SignatureVerification
								did={data.user.did}
								signedPayloadJson={data.user.profile.signed_payload_json}
								signatureMultibase={data.user.profile.content_signature}
								signingPublicKeyMultibase={data.user.profile.signing_device_public_key}
							/>
						</div>
					{/if}
				</Card.Header>
				<form method="POST" use:enhance>
					<Card.Content class="space-y-4">
						<Form.Field {form} name="display_name">
							<Form.Control>
								{#snippet children({ props })}
									<Form.Label>Display Name</Form.Label>
									<Input
										{...props}
										bind:value={$formData.display_name}
										placeholder="Your display name"
									/>
								{/snippet}
							</Form.Control>
							<Form.Description>This is your public display name.</Form.Description>
							<Form.FieldErrors />
						</Form.Field>

						<Form.Field {form} name="bio">
							<Form.Control>
								{#snippet children({ props })}
									<Form.Label>Bio</Form.Label>
									<Textarea
										{...props}
										bind:value={$formData.bio}
										placeholder="Tell us about yourself..."
										rows={3}
									/>
								{/snippet}
							</Form.Control>
							<Form.Description>Tell us a little bit about yourself.</Form.Description>
							<Form.FieldErrors />
						</Form.Field>

						<Form.Field {form} name="avatar_url">
							<Form.Control>
								{#snippet children({ props })}
									<Form.Label>Avatar URL</Form.Label>
									<Input
										{...props}
										bind:value={$formData.avatar_url}
										type="url"
										placeholder="https://example.com/avatar.jpg"
									/>
								{/snippet}
							</Form.Control>
							<Form.Description>URL to your profile picture.</Form.Description>
							<Form.FieldErrors />
						</Form.Field>

						<Form.Field {form} name="banner_url">
							<Form.Control>
								{#snippet children({ props })}
									<Form.Label>Banner URL</Form.Label>
									<Input
										{...props}
										bind:value={$formData.banner_url}
										type="url"
										placeholder="https://example.com/banner.jpg"
									/>
								{/snippet}
							</Form.Control>
							<Form.Description>URL to your profile banner image.</Form.Description>
							<Form.FieldErrors />
						</Form.Field>
					</Card.Content>
					<Card.Footer>
						<Form.Button class="w-full" disabled={loading}>
							{#if loading}
								Updating profile...
							{:else}
								Update Profile
							{/if}
						</Form.Button>
					</Card.Footer>
				</form>
			</Card.Root>
		</div>

		<!-- Profile preview card with banner and avatar -->
		<Card.Root class="shrink-0 overflow-hidden md:w-80 md:self-start">
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
			<Card.Content class="relative pt-16 pb-6">
				<div class="absolute -top-12 left-6">
					<Avatar class="h-24 w-24 border-4 border-background">
						<AvatarImage
							src={data.user.profile?.avatar_url}
							alt={data.user.profile?.display_name || data.user.username}
						/>
						<AvatarFallback class="text-2xl">
							{(data.user.profile?.display_name || data.user.username).charAt(0).toUpperCase()}
						</AvatarFallback>
					</Avatar>
				</div>
				<div class="space-y-2">
					<h2 class="text-2xl font-bold">
						{data.user.profile?.display_name || data.user.username}
					</h2>
					<p class="text-muted-foreground">@{data.user.username}</p>
				</div>
				{#if data.user.profile?.bio}
					<div class="mt-4 rounded-lg bg-muted/50 p-4">
						<p class="text-sm leading-relaxed">{data.user.profile.bio}</p>
					</div>
				{/if}
			</Card.Content>
		</Card.Root>
	</div>
{/if}
