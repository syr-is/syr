<script lang="ts">
	import * as Card from '@syr-is/ui/card';
	import { Input } from '@syr-is/ui/input';
	import { Button } from '@syr-is/ui/button';
	import { toast } from 'svelte-sonner';
	import { invalidateAll } from '$app/navigation';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	let profileSyncAssetPath = $state('');
	let usernameCooldownDays = $state('');
	let pathLoading = $state(false);
	let cooldownLoading = $state(false);

	$effect(() => {
		profileSyncAssetPath = data.profileSyncAssetPath;
		usernameCooldownDays = data.usernameCooldownDays;
	});

	async function saveProfileSyncPath() {
		pathLoading = true;
		try {
			const res = await fetch('/api/instance-config/default_profile_sync_asset_upload_path', {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ value: profileSyncAssetPath.trim() || 'me/profile/public' })
			});
			const json = await res.json();
			if (!res.ok) {
				toast.error(json.message ?? 'Failed to update');
				return;
			}
			toast.success('Profile sync asset path updated');
			await invalidateAll();
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Failed to update');
		} finally {
			pathLoading = false;
		}
	}

	async function saveUsernameCooldown() {
		const n = parseInt(usernameCooldownDays, 10);
		if (isNaN(n) || n < 1 || n > 365) {
			toast.error('Enter a number between 1 and 365');
			return;
		}
		cooldownLoading = true;
		try {
			const res = await fetch('/api/instance-config/username_change_cooldown_days', {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ value: String(n) })
			});
			const json = await res.json();
			if (!res.ok) {
				toast.error(json.message ?? 'Failed to update');
				return;
			}
			toast.success('Username cooldown updated');
			await invalidateAll();
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Failed to update');
		} finally {
			cooldownLoading = false;
		}
	}
</script>

<svelte:head>
	<title>Instance config | Settings | SYR</title>
</svelte:head>

<div class="mx-auto max-w-2xl space-y-6">
	<Card.Root>
		<Card.Header>
			<Card.Title>Default profile sync asset upload path</Card.Title>
			<Card.Description>
				Path relative to each user's uploads folder for Syner profile asset uploads. Use
				slash-separated segments; alphanumeric, hyphen, and underscore only (e.g.
				me/profile/public).
			</Card.Description>
		</Card.Header>
		<Card.Content class="space-y-4">
			<div class="flex gap-2">
				<Input
					id="profile-sync-asset-path"
					aria-label="Profile sync asset path"
					bind:value={profileSyncAssetPath}
					placeholder="me/profile/public"
					class="font-mono"
				/>
				<Button onclick={saveProfileSyncPath} disabled={pathLoading}>
					{pathLoading ? 'Saving…' : 'Save'}
				</Button>
			</div>
		</Card.Content>
	</Card.Root>

	<Card.Root>
		<Card.Header>
			<Card.Title>Username change cooldown (days)</Card.Title>
			<Card.Description>Minimum days between allowed username changes per user.</Card.Description>
		</Card.Header>
		<Card.Content class="space-y-4">
			<div class="flex gap-2">
				<Input
					id="username-cooldown-days"
					aria-label="Username change cooldown days"
					bind:value={usernameCooldownDays}
					type="number"
					min={1}
					max={365}
					placeholder="7"
				/>
				<Button onclick={saveUsernameCooldown} disabled={cooldownLoading}>
					{cooldownLoading ? 'Saving…' : 'Save'}
				</Button>
			</div>
		</Card.Content>
	</Card.Root>
</div>
