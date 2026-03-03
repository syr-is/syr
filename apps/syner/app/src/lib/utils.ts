export function getInitials(name: string): string {
	const tokens = name.split(/\s+/).filter((s) => s.length > 0);
	const initials = tokens
		.map((s) => s[0])
		.slice(0, 2)
		.join('')
		.toUpperCase();
	return initials || '?';
}
