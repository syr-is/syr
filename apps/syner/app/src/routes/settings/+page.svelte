<script lang="ts">
	import { invoke } from '@tauri-apps/api/core';
	import { open } from '@tauri-apps/plugin-dialog';
	import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@syr-is/ui/card';
	import { Button } from '@syr-is/ui/button';
	import { Input } from '@syr-is/ui/input';
	import { Label } from '@syr-is/ui/label';
	import { toast } from 'svelte-sonner';
	import { Settings, FolderOpen } from '@lucide/svelte';

	let basePath = $state('');
	let loading = $state(true);
	let saving = $state(false);
	let error = $state<string | null>(null);

	async function loadPath() {
		loading = true;
		error = null;
		try {
			basePath = await invoke<string>('get_personas_base_path_cmd');
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			loading = false;
		}
	}

	$effect(() => {
		loadPath();
	});

	async function pickDirectory() {
		const dir = await open({
			directory: true,
			multiple: false,
			title: 'Select personas folder'
		});
		if (dir && typeof dir === 'string') {
			basePath = dir;
		} else if (Array.isArray(dir) && dir.length > 0) {
			basePath = dir[0];
		}
	}

	async function savePath() {
		saving = true;
		error = null;
		try {
			await invoke('set_personas_base_path_cmd', { path: basePath });
			toast.success('Storage path updated');
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
			toast.error(error);
		} finally {
			saving = false;
		}
	}
</script>

<div class="flex flex-col gap-6 p-4 md:p-6">
	<h1 class="text-2xl font-bold">Settings</h1>

	<Card>
		<CardHeader>
			<CardTitle class="flex items-center gap-2">
				<Settings class="h-5 w-5" />
				Persona storage location
			</CardTitle>
			<CardDescription>
				Configure where personas are stored on disk. Default: app data directory (syr-personas)
			</CardDescription>
		</CardHeader>
		<CardContent class="space-y-4">
			{#if loading}
				<p class="text-muted-foreground text-sm">Loading…</p>
			{:else}
				<div class="space-y-2">
					<Label for="base-path">Personas folder</Label>
					<div class="flex gap-2">
						<Input
							id="base-path"
							bind:value={basePath}
							placeholder="Personas folder path…"
							disabled={saving}
						/>
						<Button variant="outline" onclick={pickDirectory} disabled={saving}>
							<FolderOpen class="h-4 w-4" />
							Browse
						</Button>
					</div>
				</div>
				<Button onclick={savePath} disabled={saving}>
					{saving ? 'Saving…' : 'Save'}
				</Button>
				{#if error}
					<p class="text-destructive text-sm">{error}</p>
				{/if}
			{/if}
		</CardContent>
	</Card>
</div>
