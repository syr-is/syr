import { error } from '@sveltejs/kit';

// Relative /api/v1 — proxied via Vite (dev) or reverse proxy (production)
const API_BASE = '';

export interface HostingRecord {
	did: string;
	provider: string;
	updatedAt: string;
	signature: string;
}

export async function load({ params, fetch }) {
	const did = params.did;
	if (!did?.startsWith('did:syr:')) {
		throw error(400, 'DID must start with did:syr:');
	}

	const res = await fetch(`${API_BASE}/api/v1/resolve/${encodeURIComponent(did)}`);

	if (res.status === 404) {
		return { did, record: null };
	}

	if (!res.ok) {
		const err = await res.json().catch(() => ({}));
		throw error(res.status, err.message ?? 'Failed to resolve DID');
	}

	const record: HostingRecord = await res.json();
	return {
		did,
		record,
		apiBase: '/api/v1'
	};
}
