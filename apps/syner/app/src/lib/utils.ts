import { convertFileSrc } from '@tauri-apps/api/core';

export function toAvatarSrc(url: string | undefined): string | undefined {
	if (!url) return undefined;
	if (url.startsWith('http://') || url.startsWith('https://')) return url;
	try {
		return convertFileSrc(url);
	} catch {
		return url;
	}
}

export function getInitials(name: string): string {
	return (
		name
			.split(/\s+/)
			.map((s) => s[0])
			.slice(0, 2)
			.join('')
			.toUpperCase() || '?'
	);
}
