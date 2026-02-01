/**
 * Storage events store
 * Used to notify storage-usage components to refresh when uploads/deletions occur
 * 
 * Uses Svelte 5 $state rune for proper reactivity with $effect
 */

let counter = $state(0);

export const storageEvents = {
	/**
	 * Get the current trigger value (for tracking in $effect)
	 */
	get value() {
		return counter;
	},
	/**
	 * Trigger a refresh of storage usage displays
	 * Call this after any operation that affects storage (upload, delete, etc.)
	 */
	refresh: () => {
		counter += 1;
	}
};
