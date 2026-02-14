
// this file is generated — do not edit it


declare module "svelte/elements" {
	export interface HTMLAttributes<T> {
		'data-sveltekit-keepfocus'?: true | '' | 'off' | undefined | null;
		'data-sveltekit-noscroll'?: true | '' | 'off' | undefined | null;
		'data-sveltekit-preload-code'?:
			| true
			| ''
			| 'eager'
			| 'viewport'
			| 'hover'
			| 'tap'
			| 'off'
			| undefined
			| null;
		'data-sveltekit-preload-data'?: true | '' | 'hover' | 'tap' | 'off' | undefined | null;
		'data-sveltekit-reload'?: true | '' | 'off' | undefined | null;
		'data-sveltekit-replacestate'?: true | '' | 'off' | undefined | null;
	}
}

export {};


declare module "$app/types" {
	export interface AppTypes {
		RouteId(): "/" | "/architecture" | "/architecture/did-method" | "/architecture/identity-model" | "/architecture/key-hierarchy-delegation" | "/architecture/provider-service" | "/architecture/recovery-rotation" | "/architecture/registry-protocol" | "/implementation" | "/implementation/phase-0-blueprint";
		RouteParams(): {
			
		};
		LayoutParams(): {
			"/": Record<string, never>;
			"/architecture": Record<string, never>;
			"/architecture/did-method": Record<string, never>;
			"/architecture/identity-model": Record<string, never>;
			"/architecture/key-hierarchy-delegation": Record<string, never>;
			"/architecture/provider-service": Record<string, never>;
			"/architecture/recovery-rotation": Record<string, never>;
			"/architecture/registry-protocol": Record<string, never>;
			"/implementation": Record<string, never>;
			"/implementation/phase-0-blueprint": Record<string, never>
		};
		Pathname(): "/" | "/architecture" | "/architecture/" | "/architecture/did-method" | "/architecture/did-method/" | "/architecture/identity-model" | "/architecture/identity-model/" | "/architecture/key-hierarchy-delegation" | "/architecture/key-hierarchy-delegation/" | "/architecture/provider-service" | "/architecture/provider-service/" | "/architecture/recovery-rotation" | "/architecture/recovery-rotation/" | "/architecture/registry-protocol" | "/architecture/registry-protocol/" | "/implementation" | "/implementation/" | "/implementation/phase-0-blueprint" | "/implementation/phase-0-blueprint/";
		ResolvedPathname(): `${"" | `/${string}`}${ReturnType<AppTypes['Pathname']>}`;
		Asset(): "/sveltepress.svg" | "/sveltepress@3x.png" | string & {};
	}
}