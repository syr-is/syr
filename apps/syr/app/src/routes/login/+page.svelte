<script lang="ts">
	import { onMount } from 'svelte';
	import { superForm, defaults } from 'sveltekit-superforms';
	import { zod4 } from 'sveltekit-superforms/adapters';
	import { UserLoginSchema } from '@syr-is/types';
	import * as Form from '@syr-is/ui/form';
	import { Input } from '@syr-is/ui/input';
	import * as Card from '@syr-is/ui/card';
	import * as Tabs from '@syr-is/ui/tabs';
	import { resolve } from '$app/paths';
	import { toast } from 'svelte-sonner';
	import { goto } from '$app/navigation';
	import { seedHandler } from '$lib/services/seed-handler';
	import QRCode from 'qrcode';
	import { Button } from '@syr-is/ui/button';
	import { LogIn, KeyRound } from '@lucide/svelte';

	let authTab = $state<'custodian' | 'independent'>('custodian');
	let synerChallenge = $state<{
		challenge_id: string;
		deeplink_url: string;
		expires_in: number;
		expiresAt: number; // timestamp when challenge expires (for heartbeat refresh logic)
		qrDataUrl: string;
	} | null>(null);
	let synerLoading = $state(false);
	let synerError = $state<string | null>(null);
	let heartbeatSource: EventSource | null = null;

	async function fetchChallenge(silent = false) {
		if (!silent) {
			synerLoading = true;
			synerError = null;
			synerChallenge = null;
		}
		try {
			const res = await fetch('/api/auth/independent-login/challenge', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ origin: window.location.origin })
			});
			const data = await res.json();
			if (!res.ok) {
				if (!silent) synerError = data.error_description ?? 'Failed to create challenge';
				return;
			}
			const qrDataUrl = await QRCode.toDataURL(data.deeplink_url, { width: 256, margin: 2 });
			synerChallenge = {
				challenge_id: data.challenge_id,
				deeplink_url: data.deeplink_url,
				expires_in: data.expires_in,
				expiresAt: Date.now() + data.expires_in * 1000,
				qrDataUrl
			};
		} catch (e) {
			if (!silent) synerError = e instanceof Error ? e.message : 'An unexpected error occurred';
		} finally {
			if (!silent) synerLoading = false;
		}
	}

	async function startSynerLogin() {
		await fetchChallenge(false);
	}

	function cancelSyner() {
		synerChallenge = null;
		synerError = null;
		disconnectHeartbeat();
	}

	function disconnectHeartbeat() {
		if (heartbeatSource) {
			heartbeatSource.close();
			heartbeatSource = null;
		}
	}

	function connectHeartbeat() {
		if (heartbeatSource || !synerChallenge) return;
		const src = new EventSource(
			`/api/auth/independent-login/heartbeat?challenge_id=${encodeURIComponent(synerChallenge.challenge_id)}`
		);
		heartbeatSource = src;
		src.addEventListener('heartbeat', () => {
			// Only refresh when current challenge expired or about to expire (30s buffer)
			// Avoids dropping an in-progress sign-in when user is scanning/signing
			if (!synerChallenge) return;
			if (Date.now() < synerChallenge.expiresAt - 30_000) return;
			fetchChallenge(true);
		});
		src.addEventListener('verified', (e: MessageEvent) => {
			try {
				const { token } = JSON.parse(e.data || '{}');
				if (token) {
					disconnectHeartbeat();
					window.location.href =
						resolve('/auth/independent-callback') + `?token=${encodeURIComponent(token)}`;
				}
			} catch (_) {
				/* ignore */
			}
		});
		src.onerror = () => {
			disconnectHeartbeat();
		};
	}

	onMount(() => {
		return () => disconnectHeartbeat();
	});

	$effect(() => {
		if (authTab === 'independent' && synerChallenge) {
			// Reconnect when challenge_id changes (e.g. after heartbeat refresh)
			disconnectHeartbeat();
			connectHeartbeat();
		} else {
			disconnectHeartbeat();
		}
	});

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
						await seedHandler.verify({
							bundle: aegisBundle,
							password: form.data.password
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
		<Card.Content class="-mb-4">
			<Tabs.Root bind:value={authTab} class="w-full">
				<Tabs.List class="grid w-full grid-cols-2">
					<Tabs.Trigger value="custodian" class="gap-2">
						<KeyRound class="h-4 w-4" />
						Password
					</Tabs.Trigger>
					<Tabs.Trigger value="independent" class="gap-2">
						<LogIn class="h-4 w-4" />
						Syner
					</Tabs.Trigger>
				</Tabs.List>
				<Tabs.Content value="custodian" class="mt-4 space-y-4">
					<form method="POST" use:enhance>
						<div class="space-y-4">
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
						</div>
						<div class="mt-4 flex flex-col gap-2">
							<Form.Button class="w-full" disabled={$delayed}>
								{#if $delayed}
									Signing in...
								{:else}
									Sign In
								{/if}
							</Form.Button>
						</div>
					</form>
				</Tabs.Content>
				<Tabs.Content value="independent" class="mt-4 space-y-4">
					{#if synerLoading}
						<p class="text-sm text-muted-foreground">Creating challenge…</p>
					{:else if synerError}
						<p class="text-sm text-destructive">{synerError}</p>
						<Button variant="outline" onclick={startSynerLogin}>Retry</Button>
					{:else if synerChallenge}
						<div class="flex flex-col items-center gap-4">
							<p class="text-center text-sm text-muted-foreground">
								Scan the QR code or click the link to sign in with Syner
							</p>
							<img
								src={synerChallenge.qrDataUrl}
								alt="Scan with Syner"
								class="rounded-lg border"
								width="256"
								height="256"
							/>
							<a
								href={synerChallenge.deeplink_url}
								class="text-sm font-medium text-primary hover:underline"
							>
								Open in Syner
							</a>
							<p class="text-xs text-muted-foreground">
								Challenge expires in {synerChallenge.expires_in} seconds
							</p>
							<Button variant="outline" onclick={cancelSyner}>Cancel</Button>
						</div>
					{:else}
						<p class="text-sm text-muted-foreground">
							Sign in using your Syner app. Your key never leaves your device.
						</p>
						<Button class="w-full" onclick={startSynerLogin} disabled={synerLoading}>
							<LogIn class="mr-2 h-4 w-4" />
							Sign in with Syner
						</Button>
					{/if}
				</Tabs.Content>
			</Tabs.Root>
		</Card.Content>
		<Card.Footer>
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
			<p class="text-center text-sm text-muted-foreground">
				<a
					href={resolve('/migrate')}
					data-sveltekit-preload-data
					class="font-medium text-primary underline-offset-4 hover:underline"
				>
					Migrating?
				</a>
			</p>
		</Card.Footer>
	</Card.Root>
</div>
