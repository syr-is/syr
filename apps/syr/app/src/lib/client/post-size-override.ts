import { getPostId, type Post } from '@syr-is/types';

const PREFIX = 'syr:post-size-override:';

export function postSizeOverrideKeyForPost(post: Post): string {
	return PREFIX + getPostId(post);
}

/** Remote timeline fetches use canonical API URL as key. */
export function postSizeOverrideKeyForUrl(fullUrl: string): string {
	return PREFIX + 'url:' + fullUrl;
}

export function hasPostSizeOverride(key: string): boolean {
	if (typeof sessionStorage === 'undefined') return false;
	return sessionStorage.getItem(key) === '1';
}

export function setPostSizeOverride(key: string): void {
	if (typeof sessionStorage === 'undefined') return;
	try {
		sessionStorage.setItem(key, '1');
	} catch (e) {
		console.warn('[post-size-override] sessionStorage.setItem failed:', e);
	}
}
