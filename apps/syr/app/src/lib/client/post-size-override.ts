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
	sessionStorage.setItem(key, '1');
}
