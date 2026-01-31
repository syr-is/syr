import { writable } from 'svelte/store';

/**
 * Storage events store
 * Used to notify storage-usage components to refresh when uploads/deletions occur
 */
function createStorageEvents() {
	const { subscribe, update } = writable(0);

	return {
		subscribe,
		/**
		 * Trigger a refresh of storage usage displays
		 * Call this after any operation that affects storage (upload, delete, etc.)
		 */
		refresh: () => update((n) => n + 1)
	};
}

export const storageEvents = createStorageEvents();
