<script lang="ts">
	import { page as pageStore } from '$app/state';
	import { goto } from '$app/navigation';
	import * as Table from '@syr-is/ui/table';
	import * as Pagination from '@syr-is/ui/pagination';
	import { Input } from '@syr-is/ui/input';
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
	import type { PageData } from './$types';

	const { data }: { data: PageData } = $props();

	type UserRow = {
		id: string;
		username: string;
		did: string | null;
		role: string;
		created_at: string;
		display_name: string;
		avatar_url: string | null;
	};

	const sizes = $derived(data.sizes ?? [10, 20, 50]);
	let page = $state(1);
	let size = $state(20);
	let pageSizeValue = $state('20');
	let searchQuery = $state('');
	let searchTimeout: ReturnType<typeof setTimeout> | null = null;
	let abortController: AbortController | null = null;

	$effect(() => {
		page = data.page ?? 1;
		size = data.size ?? 20;
		pageSizeValue = String(data.size ?? 20);
		searchQuery = data.search ?? '';
	});

	let rows = $state<UserRow[]>([]);
	let total = $state(0);
	let loading = $state(false);
	let fetchError = $state<string | null>(null);

	$effect(() => {
		const n = parseInt(pageSizeValue, 10);
		if (sizes.includes(n) && n !== size) size = n;
	});

	async function loadUsers(currentPage: number, currentSize: number, search: string) {
		abortController?.abort();
		abortController = new AbortController();
		const signal = abortController.signal;

		loading = true;
		fetchError = null;
		try {
			let qs = `page=${currentPage}&size=${currentSize}`;
			if (search.trim()) qs += `&search=${encodeURIComponent(search.trim())}`;

			const res = await fetch(`/api/admin/users?${qs}`, { signal });
			if (!res.ok) {
				rows = [];
				total = 0;
				fetchError = `Failed to load users (${res.status})`;
				return;
			}
			const json = await res.json();
			if (json.status === 'success') {
				rows = json.data;
				total = json.pagination?.total ?? rows.length;
			} else {
				rows = [];
				total = 0;
				fetchError = 'Unexpected response';
			}
		} catch (e) {
			if (e instanceof DOMException && e.name === 'AbortError') return;
			rows = [];
			total = 0;
			fetchError = e instanceof Error ? e.message : 'Failed to load users';
		} finally {
			if (!signal.aborted) loading = false;
		}
	}

	function updateUrl(currentPage: number, currentSize: number, search: string) {
		const url = new URL(pageStore.url);
		const curPage = Number(url.searchParams.get('page') ?? '1');
		const curSize = Number(url.searchParams.get('size') ?? '20');
		const curSearch = url.searchParams.get('search') ?? '';
		if (curPage === currentPage && curSize === currentSize && curSearch === search) return;
		url.searchParams.set('page', String(currentPage));
		url.searchParams.set('size', String(currentSize));
		if (search.trim()) {
			url.searchParams.set('search', search.trim());
		} else {
			url.searchParams.delete('search');
		}
		// eslint-disable-next-line svelte/no-navigation-without-resolve
		goto(url, { replaceState: true, noScroll: true, keepFocus: true });
	}

	$effect(() => {
		updateUrl(page, size, searchQuery);
		loadUsers(page, size, searchQuery);

		return () => {
			if (searchTimeout) clearTimeout(searchTimeout);
			abortController?.abort();
		};
	});

	function handleSearchInput(e: Event) {
		const value = (e.target as HTMLInputElement).value;
		if (searchTimeout) clearTimeout(searchTimeout);
		searchTimeout = setTimeout(() => {
			searchQuery = value;
			page = 1;
		}, 300);
	}

	function truncateDid(did: string | null): string {
		if (!did) return '—';
		if (did.length <= 24) return did;
		return did.slice(0, 16) + '…' + did.slice(-6);
	}

	function formatDate(iso: string): string {
		return new Date(iso).toLocaleDateString(undefined, {
			year: 'numeric',
			month: 'short',
			day: 'numeric'
		});
	}

	const totalPages = $derived(Math.max(1, Math.ceil(total / size)));
</script>

<svelte:head>
	<title>Users | Settings | SYR</title>
</svelte:head>

<div class="mx-auto max-w-4xl space-y-4">
	<div class="flex items-center justify-between gap-4">
		<h2 class="text-lg font-semibold">Users</h2>
		<Input
			type="search"
			placeholder="Search by username or DID…"
			class="max-w-xs"
			value={searchQuery}
			oninput={handleSearchInput}
		/>
	</div>

	<Table.Root>
		<Table.Header>
			<Table.Row>
				<Table.Head>Username</Table.Head>
				<Table.Head>DID</Table.Head>
				<Table.Head>Role</Table.Head>
				<Table.Head>Created</Table.Head>
				<Table.Head class="text-right">Actions</Table.Head>
			</Table.Row>
		</Table.Header>
		<Table.Body>
			{#if loading}
				<Table.Row>
					<Table.Cell colspan={5} class="py-8 text-center text-muted-foreground">
						Loading…
					</Table.Cell>
				</Table.Row>
			{:else if fetchError}
				<Table.Row>
					<Table.Cell colspan={5} class="py-8 text-center text-destructive">
						{fetchError}
					</Table.Cell>
				</Table.Row>
			{:else if rows.length === 0}
				<Table.Row>
					<Table.Cell colspan={5} class="py-8 text-center text-muted-foreground">
						No users found.
					</Table.Cell>
				</Table.Row>
			{:else}
				{#each rows as user (user.id)}
					<Table.Row>
						<Table.Cell class="font-medium">
							{user.display_name}
							<span class="ml-1 text-xs text-muted-foreground">@{user.username}</span>
						</Table.Cell>
						<Table.Cell>
							<code class="text-xs">{truncateDid(user.did)}</code>
						</Table.Cell>
						<Table.Cell>
							<span
								class={cn(
									'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
									user.role === 'ADMIN'
										? 'bg-primary/10 text-primary'
										: 'bg-muted text-muted-foreground'
								)}
							>
								{user.role}
							</span>
						</Table.Cell>
						<Table.Cell class="text-sm text-muted-foreground">
							{formatDate(user.created_at)}
						</Table.Cell>
						<Table.Cell class="text-right">
							<a
								href={resolve(`/settings/users/${encodeURIComponent(user.id)}`)}
								class={buttonVariants({ variant: 'outline', size: 'sm' })}
							>
								Manage
							</a>
						</Table.Cell>
					</Table.Row>
				{/each}
			{/if}
		</Table.Body>
	</Table.Root>

	<div class="flex items-center justify-between">
		<DropdownMenu>
			<DropdownMenuTrigger class={buttonVariants({ variant: 'outline', size: 'sm' })}>
				{size} per page
			</DropdownMenuTrigger>
			<DropdownMenuContent>
				<DropdownMenuRadioGroup bind:value={pageSizeValue}>
					{#each sizes as s (s)}
						<DropdownMenuRadioItem value={String(s)}>{s}</DropdownMenuRadioItem>
					{/each}
				</DropdownMenuRadioGroup>
			</DropdownMenuContent>
		</DropdownMenu>

		{#if totalPages > 1}
			<Pagination.Root count={total} perPage={size} bind:page>
				{#snippet children({ pages, currentPage })}
					<Pagination.Content>
						{#if currentPage > 1}
							<Pagination.Item>
								<Pagination.PrevButton />
							</Pagination.Item>
						{/if}
						{#each pages as p (p.key)}
							{#if p.type === 'ellipsis'}
								<Pagination.Item>
									<Pagination.Ellipsis />
								</Pagination.Item>
							{:else}
								<Pagination.Item>
									<Pagination.Link page={p} isActive={currentPage === p.value}>
										{p.value}
									</Pagination.Link>
								</Pagination.Item>
							{/if}
						{/each}
						{#if currentPage < totalPages}
							<Pagination.Item>
								<Pagination.NextButton />
							</Pagination.Item>
						{/if}
					</Pagination.Content>
				{/snippet}
			</Pagination.Root>
		{/if}
	</div>
</div>
