<script lang="ts">
	import { superForm, defaults } from 'sveltekit-superforms';
	import { zod4 } from 'sveltekit-superforms/adapters';
	import * as Form from '@syr-is/ui/form';
	import { Input } from '@syr-is/ui/input';
	import { Textarea } from '@syr-is/ui/textarea';
	import * as Card from '@syr-is/ui/card';
	import { Button } from '@syr-is/ui/button';
	import { toast } from 'svelte-sonner';
	import { invalidateAll } from '$app/navigation';
	import { ProfileUpdateSchema, type ProfileUpdate } from '@syr-is/types';
	import type { SignedMutationEnvelope } from '@syr-is/types';
	import type { PageData } from './$types';
	import ProfileCard from '$lib/components/fragments/profile-card.svelte';
	import ProfileUpdateSignDialog from '$lib/components/fragments/profile-update-sign-dialog.svelte';
	import { getIdentityStore } from '$lib/stores/identity.svelte';
	import type { ProfileSignSnapshot } from '$lib/client/profile-signed-payload';

	let { data }: { data: PageData } = $props();
	const identityStore = getIdentityStore();
	let loading = $state(false);
	let usernameValue = $state('');
	let usernameLoading = $state(false);
	let signDialogOpen = $state(false);
	let pendingProfileFields = $state<ProfileUpdate | null>(null);
	let pendingSignSnapshot = $state<ProfileSignSnapshot | null>(null);

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

			const fields = form.data as ProfileUpdate;
			const ctx = identityStore.identityContext;
			if (ctx?.did?.startsWith('did:syr:')) {
				if (!fields.display_name?.trim()) {
					toast.error('Display name is required to save your profile.');
					return;
				}
				pendingProfileFields = fields;
				pendingSignSnapshot = {
					display_name: fields.display_name.trim(),
					bio: fields.bio,
					avatar_url: fields.avatar_url,
					banner_url: fields.banner_url,
					metadata: fields.metadata
				};
				signDialogOpen = true;
				return;
			}

			await submitProfile(fields, undefined);
		}
	});

	const { form: formData, enhance } = form;

	async function submitProfile(
		fields: ProfileUpdate,
		envelope: SignedMutationEnvelope | undefined
	) {
		loading = true;
		try {
			const body = envelope !== undefined ? { ...fields, signed_mutation: envelope } : fields;
			const response = await fetch('/api/user/profile', {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(body)
			});

			if (!response.ok) {
				const errBody = await response.json().catch(() => ({}));
				toast.error(
					(errBody as { error?: { message?: string } }).error?.message || 'Failed to update profile'
				);
				return;
			}

			toast.success('Profile updated successfully');
			pendingProfileFields = null;
			pendingSignSnapshot = null;
			await invalidateAll();
		} catch (_error) {
			console.error('Failed to update profile:', _error);
			toast.error('An unexpected error occurred');
		} finally {
			loading = false;
		}
	}

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
					<Card.Description>
						Update your profile information and preferences. If your account has a DID, saving runs
						through signing (Sigil, Aegis, or Syner) so verification can succeed.
					</Card.Description>
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

		<ProfileCard
			class="shrink-0 md:w-80 md:self-start"
			profile={{
				username: data.user.username,
				display_name:
					($formData.display_name || '').trim() ||
					data.user.profile?.display_name ||
					data.user.username,
				bio: ($formData.bio ?? data.user.profile?.bio ?? '').trim() || null,
				avatar_url: ($formData.avatar_url || '').trim() || data.user.profile?.avatar_url || null,
				banner_url: ($formData.banner_url || '').trim() || data.user.profile?.banner_url || null,
				did: data.user.did ?? null,
				signed_payload_json: data.user.profile?.signed_payload_json,
				content_signature: data.user.profile?.content_signature,
				signing_device_public_key: data.user.profile?.signing_device_public_key
			}}
			showFollow={false}
			bioVariant="muted"
		/>
	</div>

	{#if pendingSignSnapshot}
		<ProfileUpdateSignDialog
			bind:open={signDialogOpen}
			snapshot={pendingSignSnapshot}
			onSigned={async (envelope) => {
				if (!pendingProfileFields) return;
				await submitProfile(pendingProfileFields, envelope);
			}}
			onUnsigned={async () => {
				if (!pendingProfileFields) return;
				await submitProfile(pendingProfileFields, undefined);
			}}
			onDefer={() => {
				signDialogOpen = false;
				pendingProfileFields = null;
				pendingSignSnapshot = null;
			}}
		/>
	{/if}
{/if}
