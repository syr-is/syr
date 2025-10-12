<script lang="ts">
	import { superForm, defaults } from 'sveltekit-superforms';
	import { zod4 } from 'sveltekit-superforms/adapters';
	import { UserRegistrationSchema } from '@syr-is/types';
	import * as Form from '$lib/components/ui/form';
	import { Input } from '$lib/components/ui/input';
	import * as Card from '$lib/components/ui/card';
	import { resolve } from '$app/paths';
	import { goto } from '$app/navigation';
	import { toast } from 'svelte-sonner';

	const form = superForm(defaults(zod4(UserRegistrationSchema)), {
		validators: zod4(UserRegistrationSchema),
		SPA: true,
		resetForm: false,
		onUpdate: async ({ form }) => {
			if (!form.valid) return;

			const { confirmPassword: _, ...registrationData } = form.data;

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
				goto(resolve('/'));
			} catch (_error) {
				toast.error('An unexpected error occurred');
			}
		}
	});

	const { form: formData, enhance, delayed } = form;
</script>

<div class="bg-background flex min-h-screen items-center justify-center p-4">
	<Card.Root class="w-full max-w-md">
		<Card.Header>
			<Card.Title>Create Account</Card.Title>
			<Card.Description>Join SYR - Your sovereign digital presence</Card.Description>
		</Card.Header>
		<form method="POST" use:enhance>
			<Card.Content class="space-y-4">
				<Form.Field {form} name="username">
					<Form.Control>
						{#snippet children({ props })}
							<Form.Label>Username</Form.Label>
							<Input {...props} bind:value={$formData.username} placeholder="alice" />
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
				<p class="text-muted-foreground text-center text-sm">
					Already have an account?
					<a
						href={resolve('/login')}
						data-sveltekit-preload-data
						class="text-primary font-medium underline-offset-4 hover:underline"
					>
						Sign in
					</a>
				</p>
			</Card.Footer>
		</form>
	</Card.Root>
</div>
