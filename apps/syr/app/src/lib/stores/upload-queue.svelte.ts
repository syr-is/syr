/**
 * Centralized upload queue with per-file tracking, concurrency control,
 * and individual cancellation. Drives the persistent upload toast UI.
 */

import { computeSha256Hex } from '@syr-is/utils';
import { storageEvents } from './storage-events.svelte';

export type UploadStatus =
	| 'queued'
	| 'hashing'
	| 'presigning'
	| 'uploading'
	| 'finalizing'
	| 'completed'
	| 'failed'
	| 'cancelled';

export interface QueuedUpload {
	id: string;
	filename: string;
	size: number;
	status: UploadStatus;
	progress: number;
	error?: string;
}

interface InternalEntry extends QueuedUpload {
	file: File;
	abort: AbortController;
	opts: EnqueueOptions;
}

export interface EnqueueOptions {
	/** API endpoint for presign + finalize. Default: '/api/uploads' */
	endpoint?: string;
	folderId?: string | null;
	onFileCompleted?: () => void;
}

const MAX_CONCURRENT = 3;

function uid(): string {
	if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
		return crypto.randomUUID();
	}
	return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

let entries = $state<InternalEntry[]>([]);
let activeCount = 0;

function hexToBase64(hex: string): string {
	return btoa(
		hex
			.match(/.{2}/g)!
			.map((b: string) => String.fromCharCode(parseInt(b, 16)))
			.join('')
	);
}

function putWithProgress(
	url: string,
	file: File,
	signal: AbortSignal,
	onProgress: (p: number) => void,
	checksumBase64: string
): Promise<void> {
	return new Promise((resolve, reject) => {
		const xhr = new XMLHttpRequest();
		xhr.open('PUT', url, true);
		xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
		xhr.setRequestHeader('x-amz-checksum-sha256', checksumBase64);
		xhr.upload.onprogress = (e) => {
			if (e.lengthComputable) onProgress(e.loaded / e.total);
		};
		xhr.onload = () => {
			if (xhr.status >= 200 && xhr.status < 300) resolve();
			else reject(new Error(`Upload failed: ${xhr.status}`));
		};
		xhr.onerror = () => reject(new Error('Upload network error'));
		xhr.onabort = () => reject(new Error('Upload cancelled'));
		signal.addEventListener('abort', () => xhr.abort(), { once: true });
		xhr.send(file);
	});
}

async function processEntry(entry: InternalEntry) {
	const { file, abort, opts } = entry;
	const signal = abort.signal;
	const api = opts.endpoint || '/api/uploads';

	try {
		// 1. Hash
		entry.status = 'hashing';
		entries = entries;
		if (signal.aborted) throw new Error('Upload cancelled');
		const buf = await file.arrayBuffer();
		if (signal.aborted) throw new Error('Upload cancelled');
		const sha256 = await computeSha256Hex(buf);
		const checksumBase64 = hexToBase64(sha256);

		// 2. Presign
		entry.status = 'presigning';
		entries = entries;
		const presignRes = await fetch(api, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				filename: file.name,
				mime_type: file.type || 'application/octet-stream',
				size: file.size,
				sha256,
				folder_id: opts.folderId
			}),
			signal
		});
		if (!presignRes.ok) throw new Error(`Failed to get upload URL for ${file.name}`);
		const presignData = (await presignRes.json()).data;
		const { signedUrl, uploadDid, uploadLocalId } = presignData;

		// 3. PUT with progress
		entry.status = 'uploading';
		entry.progress = 0;
		entries = entries;
		await putWithProgress(signedUrl, file, signal, (p) => {
			entry.progress = p;
			entries = entries;
		}, checksumBase64);

		// 4. Finalize + poll
		entry.status = 'finalizing';
		entry.progress = 1;
		entries = entries;
		const completeBody = JSON.stringify({
			did: uploadDid,
			local_id: uploadLocalId,
			status: 'completed'
		});

		let completeRes = await fetch(api, {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: completeBody,
			signal
		});

		if (completeRes.status === 202) {
			const maxPollMs = 5 * 60 * 1000;
			const started = Date.now();
			let delay = 3000;
			while (Date.now() - started < maxPollMs) {
				if (signal.aborted) throw new Error('Upload cancelled');
				await new Promise((r) => setTimeout(r, delay));
				delay = Math.min(delay * 1.3, 10000);
				completeRes = await fetch(api, {
					method: 'PATCH',
					headers: { 'Content-Type': 'application/json' },
					body: completeBody,
					signal
				});
				if (completeRes.status === 200) break;
				if (completeRes.status !== 202) throw new Error(`Finalize failed for ${file.name}`);
			}
			if (completeRes.status === 202) throw new Error(`Finalization timed out for ${file.name}`);
		}

		if (!completeRes.ok) throw new Error(`Failed to complete upload for ${file.name}`);

		entry.status = 'completed';
		entries = entries;
		storageEvents.refresh();
		opts.onFileCompleted?.();
	} catch (err) {
		if (signal.aborted && entry.status !== 'cancelled') {
			entry.status = 'cancelled';
		} else if (entry.status !== 'cancelled') {
			entry.status = 'failed';
			entry.error = err instanceof Error ? err.message : 'Unknown error';
		}
		entries = entries;
	} finally {
		activeCount--;
		drainQueue();
	}
}

function drainQueue() {
	while (activeCount < MAX_CONCURRENT) {
		const next = entries.find((e) => e.status === 'queued');
		if (!next) break;
		activeCount++;
		processEntry(next);
	}
}

// ── Public API ──

export function getUploadQueue() {
	return {
		get list(): QueuedUpload[] {
			return entries;
		},
		get hasActive(): boolean {
			return entries.some(
				(e) =>
					e.status === 'queued' ||
					e.status === 'hashing' ||
					e.status === 'presigning' ||
					e.status === 'uploading' ||
					e.status === 'finalizing'
			);
		}
	};
}

export function enqueueUploads(files: FileList, opts: EnqueueOptions = {}) {
	for (const file of Array.from(files)) {
		const entry: InternalEntry = {
			id: uid(),
			filename: file.name,
			size: file.size,
			status: 'queued',
			progress: 0,
			file,
			abort: new AbortController(),
			opts
		};
		entries = [...entries, entry];
	}
	drainQueue();
}

export function cancelUpload(id: string) {
	const entry = entries.find((e) => e.id === id);
	if (!entry) return;
	entry.status = 'cancelled';
	entry.abort.abort();
	entries = entries;
}

export function dismissUpload(id: string) {
	entries = entries.filter((e) => e.id !== id);
}

export function dismissAll() {
	entries = entries.filter(
		(e) =>
			e.status !== 'completed' &&
			e.status !== 'failed' &&
			e.status !== 'cancelled'
	);
}
