import { writable } from 'svelte/store';

/** Decrypted seed (32 bytes) as base64, kept in memory for signing session. Clear on Lock. */
export const sessionSeed = writable<string | null>(null);

/** Persona selected for signing (from list). Used to decrypt and sign. */
export type SelectedPersona = {
	id: string;
	displayName: string;
	did: string;
	avatarUrl?: string;
	bannerUrl?: string;
	avatarMtime?: number;
	bannerMtime?: number;
};
export const selectedPersona = writable<SelectedPersona | null>(null);
