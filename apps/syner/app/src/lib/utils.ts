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
	const tokens = name.split(/\s+/).filter((s) => s.length > 0);
	const initials = tokens
		.map((s) => s[0])
		.slice(0, 2)
		.join('')
		.toUpperCase();
	return initials || '?';
}
