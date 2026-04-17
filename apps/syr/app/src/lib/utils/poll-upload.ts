/**
 * Poll for upload completion after the PUT succeeds.
 * The webhook auto-finalizes the upload server-side; this polls for the result.
 * Falls back to PATCH if polling times out.
 */
export async function pollUploadCompletion(
	uploadDid: string,
	uploadLocalId: string,
	opts?: { maxWaitMs?: number; intervalMs?: number }
): Promise<boolean> {
	const maxWait = opts?.maxWaitMs ?? 15000;
	const interval = opts?.intervalMs ?? 500;
	const start = Date.now();

	while (Date.now() - start < maxWait) {
		try {
			const res = await fetch(
				`/api/uploads/${encodeURIComponent(uploadDid)}/${encodeURIComponent(uploadLocalId)}`
			);
			if (res.ok) {
				const data = await res.json();
				if (data.data?.status === 'completed') return true;
			}
		} catch {
			// ignore fetch errors during polling
		}
		await new Promise((r) => setTimeout(r, interval));
	}

	// Fallback: try PATCH directly (has retry logic server-side)
	try {
		const res = await fetch('/api/uploads', {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ did: uploadDid, local_id: uploadLocalId, status: 'completed' })
		});
		return res.ok;
	} catch {
		return false;
	}
}
