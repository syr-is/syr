/**
 * Copy text to clipboard with fallback for non-secure contexts (HTTP on LAN).
 * navigator.clipboard requires HTTPS; falls back to execCommand('copy').
 */
export async function copyToClipboard(text: string): Promise<void> {
	if (navigator.clipboard?.writeText) {
		try {
			await navigator.clipboard.writeText(text);
			return;
		} catch {
			// Fall through to legacy method
		}
	}

	// Legacy fallback: create a temporary textarea
	const textarea = document.createElement('textarea');
	textarea.value = text;
	textarea.style.position = 'fixed';
	textarea.style.left = '-9999px';
	textarea.style.top = '-9999px';
	document.body.appendChild(textarea);
	textarea.select();
	try {
		document.execCommand('copy');
	} finally {
		document.body.removeChild(textarea);
	}
}
