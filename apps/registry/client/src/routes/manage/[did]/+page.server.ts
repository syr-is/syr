import { error } from '@sveltejs/kit';

const API_BASE = process.env.PUBLIC_REGISTRY_API_URL || 'http://localhost:3100';

export interface HostingRecord {
	did: string;
	provider: string;
	updatedAt: string;
	signature: string;
}

export async function load({ params }) {
	const did = params.did;
	if (!did?.startsWith('did:syr:')) {
		throw error(400, 'DID must start with did:syr:');
	}

	const res = await fetch(`${API_BASE}/resolve/${encodeURIComponent(did)}`);

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
		apiBase: API_BASE
	};
}
