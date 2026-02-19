<script lang="ts">
	import { superForm, defaults } from 'sveltekit-superforms';
	import { zod4 } from 'sveltekit-superforms/adapters';
	import { UserLoginSchema } from '@syr-is/types';
	import * as Form from '@syr-is/ui/form';
	import { Input } from '@syr-is/ui/input';
	import * as Card from '@syr-is/ui/card';
	import { resolve } from '$app/paths';
	import { toast } from 'svelte-sonner';
	import { goto } from '$app/navigation';
	import { seedHandler } from '$lib/services/seed-handler';

	const form = superForm(defaults(zod4(UserLoginSchema)), {
		validators: zod4(UserLoginSchema),
		SPA: true,
		resetForm: false,
		onUpdate: async ({ form }) => {
			if (!form.valid) return;

			try {
				const response = await fetch('/api/auth/login', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify(form.data)
				});

				if (!response.ok) {
					const error = await response.json();
					toast.error(error.error?.message || 'Login failed');
					return;
				}

				const result = await response.json();
				const aegisBundle = result.data?.aegisBundle;

				// If we got an Aegis bundle, verify the password decrypts correctly (seed is never stored)
				if (aegisBundle && form.data.password) {
					try {
						await seedHandler.run({
							bundle: aegisBundle,
							password: form.data.password,
							action: async () => {}
						});
					} catch (e) {
						console.error('[login] Failed to decrypt Aegis bundle:', e);
						toast.error('Failed to unlock identity');
						return;
					}
				}

				toast.success('Welcome back!');
				await goto(resolve('/'));
				window.location.reload();
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
			<Card.Title>Welcome Back</Card.Title>
			<Card.Description>Sign in to your SYR account</Card.Description>
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
					<Form.FieldErrors />
				</Form.Field>
			</Card.Content>
			<Card.Footer class="flex flex-col gap-2">
				<Form.Button class="w-full" disabled={$delayed}>
					{#if $delayed}
						Signing in...
					{:else}
						Sign In
					{/if}
				</Form.Button>
				<p class="text-center text-sm text-muted-foreground">
					Don't have an account?
					<a
						href={resolve('/register')}
						data-sveltekit-preload-data
						class="font-medium text-primary underline-offset-4 hover:underline"
					>
						Create one
					</a>
				</p>
			</Card.Footer>
		</form>
	</Card.Root>
</div>
