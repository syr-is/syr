import { zip } from 'fflate';

export type BackupFileAnalysis = {
	hasSigil: boolean | null;
	fileType: 'raw_sigil' | 'zip' | 'persona' | null;
	/** When set, handler should show this error via toast */
	error?: string;
};

/**
 * Analyze a backup file (Sigil or .syr bundle) to determine if it contains
 * identity keys and what type it is.
 */
export async function analyzeBackupFile(file: File): Promise<BackupFileAnalysis> {
	const ext = file.name.toLowerCase().split('.').pop() ?? '';
	if (ext === 'sigil') {
		const text = await file.text();
		let json: unknown;
		try {
			json = JSON.parse(text);
		} catch {
			return { hasSigil: null, fileType: null, error: 'Invalid Sigil file' };
		}
		if (
			json &&
			typeof json === 'object' &&
			'v' in json &&
			'kdf' in json &&
			'enc' in json &&
			'pub' in json
		) {
			return { hasSigil: true, fileType: 'raw_sigil' };
		}
		return { hasSigil: null, fileType: null, error: 'Invalid Sigil file' };
	}
	if (ext === 'json') {
		const text = await file.text();
		try {
			const json = JSON.parse(text);
			if (
				json &&
				typeof json === 'object' &&
				'v' in json &&
				'kdf' in json &&
				'enc' in json &&
				'pub' in json
			) {
				return { hasSigil: true, fileType: 'raw_sigil' };
			}
			return { hasSigil: null, fileType: null, error: 'File is not a Sigil' };
		} catch {
			return { hasSigil: null, fileType: null, error: 'Invalid JSON' };
		}
	}
	try {
		const ab = await file.arrayBuffer();
		const zipBytes = new Uint8Array(ab);
		const { unzipSync } = await import('fflate');
		const files = unzipSync(zipBytes);
		const hasRootSigil = !!files['identity.sigil'];
		const hasSyrStructure =
			!!files['manifest.json'] && !!files['identity.json'] && !!files['posts.json'];
		const personaEntry = Object.keys(files).find((k) => k.endsWith('/identity.sigil'));
		const hasProfileJson = Object.keys(files).some((k) => k.endsWith('/profile.json'));
		const hasPersonaStructure = !!personaEntry && hasProfileJson;
		const hasSigil = hasRootSigil || !!personaEntry;
		if (hasSyrStructure) {
			return { hasSigil, fileType: 'zip' };
		}
		if (hasPersonaStructure) {
			return { hasSigil, fileType: 'persona' };
		}
		return { hasSigil, fileType: hasSigil ? 'zip' : null };
	} catch {
		return { hasSigil: null, fileType: null, error: 'Could not read file' };
	}
}

/**
 * Create a ZIP archive from file entries. Used for synthetic migration/sync bundles.
 */
export function createSyntheticZip(zipFiles: Record<string, Uint8Array>): Promise<Uint8Array> {
	return new Promise((resolve, reject) => {
		zip(zipFiles, { level: 1 }, (err, out) => {
			if (err) reject(err);
			else if (out === undefined) reject(new Error('Zip produced no output'));
			else resolve(out);
		});
	});
}
