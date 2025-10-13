// Centralized app stores live here.

// Preference stores with localStorage persistence
import { createLocalStorageStore } from '$lib/stores/local-storage';

export const sidebarIsOpenStore = createLocalStorageStore('pref:sidebarIsOpen', false);




