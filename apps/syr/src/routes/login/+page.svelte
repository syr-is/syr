<script lang="ts">
	import { superForm, defaults } from 'sveltekit-superforms';
	import { zod4 } from 'sveltekit-superforms/adapters';
	import { UserLoginSchema } from '@syr-is/types';
	import * as Form from '$lib/components/ui/form';
	import { Input } from '$lib/components/ui/input';
	import * as Card from '$lib/components/ui/card';
	import { resolve } from '$app/paths';
	import { goto } from '$app/navigation';
	import { toast } from 'svelte-sonner';

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

				toast.success('Welcome back!');
				await goto(resolve('/'));
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
				<p class="text-muted-foreground text-center text-sm">
					Don't have an account?
					<a
						href={resolve('/register')}
						data-sveltekit-preload-data
						class="text-primary font-medium underline-offset-4 hover:underline"
					>
						Create one
					</a>
				</p>
			</Card.Footer>
		</form>
	</Card.Root>
</div>
