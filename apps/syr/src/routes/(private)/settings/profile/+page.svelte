<script lang="ts">
	import { superForm, defaults } from 'sveltekit-superforms';
	import { zod4 } from 'sveltekit-superforms/adapters';
	import * as Form from '$lib/components/ui/form';
	import { Input } from '$lib/components/ui/input';
	import { Textarea } from '$lib/components/ui/textarea';
	import * as Card from '$lib/components/ui/card';
	import { Avatar, AvatarFallback, AvatarImage } from '$lib/components/ui/avatar';
	import { toast } from 'svelte-sonner';
	import { ProfileUpdateSchema } from '@syr-is/types';

	export let data;
	const form = superForm(defaults(zod4(ProfileUpdateSchema)), {
		validators: zod4(ProfileUpdateSchema),
		SPA: true,
		resetForm: false,
		onUpdate: async ({ form }) => {
			if (!form.valid) return;

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
				window.location.reload();
			} catch (_error) {
				toast.error('An unexpected error occurred');
			}
		}
	});

	const { form: formData, enhance, delayed } = form;

	// Initialize form with current user data
	$formData.display_name = data.user.profile?.display_name || '';
	$formData.bio = data.user.profile?.bio || '';
	$formData.avatar_url = data.user.profile?.avatar_url || '';
	$formData.banner_url = data.user.profile?.banner_url || '';
</script>

<div class="max-w-2xl space-y-6">
	<div class="flex items-center gap-4">
		<Avatar class="h-20 w-20">
			<AvatarImage
				src={data.user.profile?.avatar_url}
				alt={data.user.profile?.display_name || data.user.username}
			/>
			<AvatarFallback class="text-lg">
				{(data.user.profile?.display_name || data.user.username).charAt(0).toUpperCase()}
			</AvatarFallback>
		</Avatar>
		<div>
			<h1 class="text-2xl font-bold">{data.user.profile?.display_name || data.user.username}</h1>
			<p class="text-muted-foreground">@{data.user.username}</p>
		</div>
	</div>

	<Card.Root>
		<Card.Header>
			<Card.Title>Profile Information</Card.Title>
			<Card.Description>Update your profile information and preferences.</Card.Description>
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
				<Form.Button class="w-full" disabled={$delayed}>
					{#if $delayed}
						Updating profile...
					{:else}
						Update Profile
					{/if}
				</Form.Button>
			</Card.Footer>
		</form>
	</Card.Root>
</div>
