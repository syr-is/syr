<script lang="ts">
	import { superForm, defaults } from 'sveltekit-superforms';
	import { zod4 } from 'sveltekit-superforms/adapters';
	import { UserRegistrationSchema } from '@syr-is/types';
	import * as Form from '@syr-is/ui/form';
	import { Input } from '@syr-is/ui/input';
	import * as Card from '@syr-is/ui/card';
	import { resolve } from '$app/paths';
	import { toast } from 'svelte-sonner';
	import type { PageData } from './$types';
	import { page } from '$app/state';
	import { safePostLoginRedirectPath } from '$lib/post-login-redirect-path';

	let { data }: { data: PageData } = $props();
	const inviteOnly = $derived(data.registrationMode === 'invite_only');

	// Invite code preview — prefill + lock username if reserved
	let reservedUsername = $state<string | null>(null);
	let inviteValid = $state<boolean | null>(null);
	let checkingInvite = $state(false);

	async function checkInviteCode(code: string) {
		if (!code.trim()) {
			reservedUsername = null;
			inviteValid = null;
			return;
		}
		checkingInvite = true;
		try {
			const res = await fetch(`/api/invite-codes/${encodeURIComponent(code.trim())}/preview`);
			if (!res.ok) {
				inviteValid = false;
				reservedUsername = null;
				return;
			}
			const json = await res.json();
			inviteValid = json.data.valid;
			reservedUsername = json.data.reserved_username ?? null;
			if (reservedUsername) {
				$formData.username = reservedUsername;
			}
		} catch {
			inviteValid = null;
			reservedUsername = null;
		} finally {
			checkingInvite = false;
		}
	}

	// Check invite from URL param on load
	const urlInvite = page.url.searchParams.get('invite');
	if (urlInvite) {
		// Will run once on mount
		$effect(() => {
			if (urlInvite && !checkingInvite && inviteValid === null) {
				$formData.invite_code = urlInvite;
				checkInviteCode(urlInvite);
			}
		});
	}

	const form = superForm(defaults(zod4(UserRegistrationSchema)), {
		validators: zod4(UserRegistrationSchema),
		SPA: true,
		resetForm: false,
		onUpdate: async ({ form }) => {
			if (!form.valid) return;

			const { confirmPassword: _, ...registrationData } = form.data;

			if (inviteOnly && !registrationData.invite_code?.trim()) {
				toast.error('An invite code is required to register');
				return;
			}

			try {
				const response = await fetch('/api/auth/register', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify(registrationData)
				});

				if (!response.ok) {
					const error = await response.json();
					toast.error(error.error?.message || 'Registration failed');
					return;
				}

				toast.success('Account created successfully!');
				const redirectTo = safePostLoginRedirectPath(page.url.searchParams.get('redirectTo'));
				window.location.href = redirectTo ?? '/';
			} catch (_error) {
				toast.error('An unexpected error occurred');
			}
		}
	});

	const { form: formData, enhance, delayed } = form;
</script>

<div class="flex min-h-full items-center justify-center p-4">
	<Card.Root class="w-full max-w-md">
		<Card.Header>
			<Card.Title>Create Account</Card.Title>
			<Card.Description>Join SYR - Your sovereign digital presence</Card.Description>
		</Card.Header>
		<form method="POST" use:enhance>
			<Card.Content class="space-y-4">
				{#if inviteOnly}
					<Form.Field {form} name="invite_code">
						<Form.Control>
							{#snippet children({ props })}
								<Form.Label>Invite Code</Form.Label>
								<Input
									{...props}
									bind:value={$formData.invite_code}
									placeholder="Enter your invite code"
									required
									onblur={() => checkInviteCode($formData.invite_code ?? '')}
								/>
								{#if checkingInvite}
									<p class="text-xs text-muted-foreground">Checking invite code…</p>
								{:else if inviteValid === false}
									<p class="text-xs text-destructive">Invalid or exhausted invite code</p>
								{:else if inviteValid && reservedUsername}
									<p class="text-xs text-muted-foreground">
										Username reserved: <strong>{reservedUsername}</strong>
									</p>
								{/if}
							{/snippet}
						</Form.Control>
						<Form.Description>This instance requires an invite code to register.</Form.Description>
						<Form.FieldErrors />
					</Form.Field>
				{/if}

				<Form.Field {form} name="username">
					<Form.Control>
						{#snippet children({ props })}
							<Form.Label>Username</Form.Label>
							<Input
								{...props}
								bind:value={$formData.username}
								placeholder="alice"
								disabled={!!reservedUsername}
							/>
						{/snippet}
					</Form.Control>
					<Form.FieldErrors />
				</Form.Field>

				<Form.Field {form} name="display_name">
					<Form.Control>
						{#snippet children({ props })}
							<Form.Label>Display Name</Form.Label>
							<Input {...props} bind:value={$formData.display_name} placeholder="Alice" />
						{/snippet}
					</Form.Control>
					<Form.FieldErrors />
				</Form.Field>

				<Form.Field {form} name="password">
					<Form.Control>
						{#snippet children({ props })}
							<Form.Label>Password</Form.Label>
							<Input
								{...props}
								type="password"
								bind:value={$formData.password}
								placeholder="••••••••"
							/>
						{/snippet}
					</Form.Control>
					<Form.Description>
						Minimum 8 characters with uppercase, lowercase, and number
					</Form.Description>
					<Form.FieldErrors />
				</Form.Field>

				<Form.Field {form} name="confirmPassword">
					<Form.Control>
						{#snippet children({ props })}
							<Form.Label>Confirm Password</Form.Label>
							<Input
								{...props}
								type="password"
								bind:value={$formData.confirmPassword}
								placeholder="••••••••"
							/>
						{/snippet}
					</Form.Control>
					<Form.FieldErrors />
				</Form.Field>
			</Card.Content>
			<Card.Footer class="flex flex-col gap-2">
				<Form.Button class="w-full" variant="secondary" disabled={$delayed}>
					{#if $delayed}
						Creating account...
					{:else}
						Create Account
					{/if}
				</Form.Button>
				<p class="text-center text-sm text-muted-foreground">
					Already have an account?
					<a
						href={resolve('/login')}
						data-sveltekit-preload-data
						class="font-medium text-primary underline-offset-4 hover:underline"
					>
						Sign in
					</a>
				</p>
				<p class="mt-2 text-center text-sm text-muted-foreground">
					<a
						href={resolve('/migrate')}
						data-sveltekit-preload-data
						class="font-medium text-primary underline-offset-4 hover:underline"
						aria-label="Migrate an existing account"
					>
						Migrate an existing account
					</a>
				</p>
			</Card.Footer>
		</form>
	</Card.Root>
</div>
