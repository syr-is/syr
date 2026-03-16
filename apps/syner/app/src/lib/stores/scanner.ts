import { writable } from 'svelte/store';

export type ScanOutcome =
	| { status: 'result'; content: string }
	| { status: 'cancelled' }
	| { status: 'permission_denied' };

/** Set by the scanner when scan completes. null = still scanning. */
export const scanOutcome = writable<ScanOutcome | null>(null);
