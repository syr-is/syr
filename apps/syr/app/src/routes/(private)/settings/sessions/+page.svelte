<script lang="ts">
	import { onMount } from 'svelte';
	import { page as pageStore } from '$app/state';
	import { goto } from '$app/navigation';
	import * as Table from '@syr-is/ui/table';
	import * as Pagination from '@syr-is/ui/pagination';
	import { buttonVariants } from '@syr-is/ui/button';
	import { cn } from '$lib/utils';
	import {
		DropdownMenu,
		DropdownMenuContent,
		DropdownMenuTrigger,
		DropdownMenuRadioGroup,
		DropdownMenuRadioItem
	} from '@syr-is/ui/dropdown-menu';
	import { resolve } from '$app/paths';
	import { authStore } from '$lib/stores/auth.svelte';

	const { data } = $props<{ data: { page: number; size: number; sizes: number[] } }>();

	type SessionRow = {
		id: string;
		ip?: string;
		user_agent?: string;
		created_at: string;
		last_active?: string;
		expires_at: string;
		is_current: boolean;
	};

	const sizes = $derived(data.sizes ?? [5, 10, 20]);
	let page = $state(1);
	let size = $state(10);
	let pageSizeValue = $state('10');

	$effect(() => {
		page = data.page ?? 1;
		size = data.size ?? 10;
		pageSizeValue = String(data.size ?? 10);
	});

	let rows = $state<SessionRow[]>([]);
	let total = $state(0);
	let loading = $state(false);
	$effect(() => {
		const n = parseInt(pageSizeValue, 10);
		if ([5, 10, 20].includes(n) && n !== size) size = n;
	});

	async function loadSessions(currentPage: number, currentSize: number) {
		loading = true;
		try {
			const res = await fetch(`/api/session?page=${currentPage}&size=${currentSize}`);
			const json = await res.json();
			if (json.status === 'success') {
				rows = json.data;
				total = json.pagination?.total ?? rows.length;
			} else {
				rows = [];
				total = 0;
			}
		} finally {
			loading = false;
		}
	}

	function updateUrl(currentPage: number, currentSize: number) {
		const url = new URL(pageStore.url);
		const curPage = Number(url.searchParams.get('page') ?? '1');
		const curSize = Number(url.searchParams.get('size') ?? '10');
		// Only update the URL if values actually changed to avoid repeated replaceState calls
		if (curPage === currentPage && curSize === currentSize) return;
		url.searchParams.set('page', String(currentPage));
		url.searchParams.set('size', String(currentSize));
		// eslint-disable-next-line svelte/no-navigation-without-resolve
		goto(url, { replaceState: true, noScroll: true, keepFocus: true });
	}

	$effect(() => {
		// react to page/size changes
		updateUrl(page, size);
		loadSessions(page, size);
	});

	onMount(() => {
		loadSessions(page, size);
	});

	async function deleteSession(id: string) {
		if (!id || rows.find((r) => r.id === id)?.is_current) return;
		const res = await fetch(`/api/session/${id}`, { method: 'DELETE' });
		if (res.ok) {
			loadSessions(page, size);
		}
	}

	async function invalidateOthers() {
		const res = await fetch(`/api/session/invalidate-others`, { method: 'POST' });
		if (res.ok) {
			loadSessions(page, size);
		}
	}

	async function logoutCurrent() {
		await fetch('/api/auth/logout', { method: 'POST' });
		authStore.logout();
		goto(resolve('/login'));
	}

	function formatDate(value?: string) {
		if (!value) return '-';
		const d = new Date(value);
		if (Number.isNaN(d.getTime())) return '-';
		return d.toLocaleString();
	}
</script>

<div class="mb-4 flex items-center justify-between gap-2">
	<div class="flex gap-2">
		<button class={cn(buttonVariants({ variant: 'secondary' }))} onclick={invalidateOthers}
			>Invalidate other sessions</button
		>
		<button class={cn(buttonVariants({ variant: 'destructive' }))} onclick={logoutCurrent}
			>Log out current</button
		>
	</div>
	<DropdownMenu>
		<DropdownMenuTrigger>
			{#snippet child({ props })}
				<button class={cn(buttonVariants({ variant: 'outline' }))} {...props}
					>Page size: {size}</button
				>
			{/snippet}
		</DropdownMenuTrigger>
		<DropdownMenuContent align="end">
			<DropdownMenuRadioGroup bind:value={pageSizeValue}>
				{#each sizes as s (s)}
					<DropdownMenuRadioItem value={String(s)}>{s}</DropdownMenuRadioItem>
				{/each}
			</DropdownMenuRadioGroup>
		</DropdownMenuContent>
	</DropdownMenu>
</div>

<Table.Root>
	<Table.Header>
		<Table.Row>
			<Table.Head>Current</Table.Head>
			<Table.Head>IP</Table.Head>
			<Table.Head>User Agent</Table.Head>
			<Table.Head>Created</Table.Head>
			<Table.Head>Last Active</Table.Head>
			<Table.Head>Expires</Table.Head>
			<Table.Head>Actions</Table.Head>
		</Table.Row>
	</Table.Header>
	<Table.Body>
		{#if loading}
			<Table.Row>
				<Table.Cell colspan={7}>Loading...</Table.Cell>
			</Table.Row>
		{:else if rows.length === 0}
			<Table.Row>
				<Table.Cell colspan={7}>No sessions</Table.Cell>
			</Table.Row>
		{:else}
			{#each rows as r (r.id)}
				<Table.Row>
					<Table.Cell>
						{#if r.is_current}
							<span
								class="inline-flex items-center rounded bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700"
								>Current</span
							>
						{/if}
					</Table.Cell>
					<Table.Cell>{r.ip ?? '-'}</Table.Cell>
					<Table.Cell class="max-w-[360px] truncate" title={r.user_agent}
						>{r.user_agent ?? '-'}</Table.Cell
					>
					<Table.Cell>{formatDate(r.created_at)}</Table.Cell>
					<Table.Cell>{formatDate(r.last_active)}</Table.Cell>
					<Table.Cell>{formatDate(r.expires_at)}</Table.Cell>
					<Table.Cell>
						<div class="flex gap-2">
							<button
								class={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}
								onclick={() => deleteSession(r.id)}
								disabled={r.is_current}>Invalidate</button
							>
						</div>
					</Table.Cell>
				</Table.Row>
			{/each}
		{/if}
	</Table.Body>
</Table.Root>

<div class="mt-4 flex items-center justify-center">
	<Pagination.Root count={total} perPage={size} bind:page>
		{#snippet children({ pages, currentPage })}
			<Pagination.Content>
				{#if currentPage > 1}
					<Pagination.Item>
						<Pagination.PrevButton />
					</Pagination.Item>
				{/if}
				{#each pages as page (page.key)}
					{#if page.type === 'ellipsis'}
						<Pagination.Item>
							<Pagination.Ellipsis />
						</Pagination.Item>
					{:else}
						<Pagination.Item>
							<Pagination.Link {page} isActive={currentPage === page.value}>
								{page.value}
							</Pagination.Link>
						</Pagination.Item>
					{/if}
				{/each}
				{#if currentPage < Math.max(1, Math.ceil(total / size))}
					<Pagination.Item>
						<Pagination.NextButton />
					</Pagination.Item>
				{/if}
			</Pagination.Content>
		{/snippet}
	</Pagination.Root>
</div>
