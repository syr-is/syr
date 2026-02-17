import { writable, type Writable } from 'svelte/store';

export type Serializer<T> = (value: T) => string;
export type Deserializer<T> = (raw: string) => T;

/**
 * Creates a Svelte store persisted to localStorage.
 * - Seeds from localStorage on the client before first subscription
 * - Persists on any change
 * - Uses JSON serialization by default
 */
export function createLocalStorageStore<T>(
	key: string,
	defaultValue: T,
	opts?: {
		serialize?: Serializer<T>;
		deserialize?: Deserializer<T>;
	}
): Writable<T> {
	const serialize: Serializer<T> = opts?.serialize ?? ((v) => JSON.stringify(v));
	const deserialize: Deserializer<T> = opts?.deserialize ?? ((raw) => JSON.parse(raw) as T);

	let initial: T = defaultValue;

	if (typeof window !== 'undefined') {
		try {
			const raw = localStorage.getItem(key);
			if (raw !== null) initial = deserialize(raw);
		} catch {
			// ignore malformed values or private mode
		}
	}

	const store = writable(initial);

	if (typeof window !== 'undefined') {
		store.subscribe((value) => {
			try {
				localStorage.setItem(key, serialize(value));
			} catch {
				// ignore quota errors
			}
		});
	}

	return store;
}
