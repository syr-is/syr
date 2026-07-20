import type { RecordId } from 'surrealdb';
import { BaseRepository } from './base.repository';
import { IdentityRotationSchema, stringToRecordId, type IdentityRotation } from '@syr-is/types';
import type { RotationStatement } from '@syr-is/types';

/** Aegis columns re-written when a custodial identity's root key rotates. */
type AegisColumns = {
	salt: string;
	nonce: string;
	ct: string;
	tag: string;
	kdf: { mem: number; it: number; par: number };
};

/**
 * Identity Rotation Repository
 * Append-only root-key rotation chain rows (identity_rotation table).
 * The chain is ordered by seq; the current root key is the last new_root
 * (or the genesis key derived from the DID when no rows exist).
 */
export class IdentityRotationRepository extends BaseRepository<IdentityRotation> {
	protected tableName = 'identity_rotation';
	protected schema = IdentityRotationSchema;

	/**
	 * Find the full rotation chain for a DID, ordered by seq ascending.
	 */
	async findChainByDid(did: string): Promise<IdentityRotation[]> {
		const result = await this.db.query<[IdentityRotation[]]>(
			'SELECT * FROM identity_rotation WHERE did = $did ORDER BY seq ASC',
			{ did }
		);
		const records = result[0] ?? [];
		return records.map((r) => this.validate(r));
	}

	/** Build the `SET` fragment + params that re-wrap the Aegis columns. */
	private aegisSetFragment(aegisBundle: AegisColumns | null | undefined): {
		clause: string;
		params: Record<string, unknown>;
	} {
		if (!aegisBundle) return { clause: '', params: {} };
		return {
			clause: `,
					aegis_salt = $aegisSalt,
					aegis_nonce = $aegisNonce,
					aegis_ct = $aegisCt,
					aegis_tag = $aegisTag,
					aegis_kdf_mem = $aegisKdfMem,
					aegis_kdf_it = $aegisKdfIt,
					aegis_kdf_par = $aegisKdfPar`,
			params: {
				aegisSalt: aegisBundle.salt,
				aegisNonce: aegisBundle.nonce,
				aegisCt: aegisBundle.ct,
				aegisTag: aegisBundle.tag,
				aegisKdfMem: aegisBundle.kdf.mem,
				aegisKdfIt: aegisBundle.kdf.it,
				aegisKdfPar: aegisBundle.kdf.par
			}
		};
	}

	/**
	 * Atomically append a rotation statement to the chain AND advance the
	 * identity's current root key (re-wrapping the Aegis columns for custodial
	 * rotations) in a single transaction. This closes the split-brain window a
	 * crash between two separate writes would leave — a chain tip ahead of the
	 * stored root key, which makes every later rotation fail on the mismatch.
	 * The unique (did, seq) index still rejects concurrent duplicate appends.
	 */
	async appendStatementAndAdvanceRoot(params: {
		statement: RotationStatement;
		identityId: RecordId | string;
		/** New-seed Aegis bundle (custodial rotation); null/omitted for external. */
		aegisBundle?: AegisColumns | null;
	}): Promise<void> {
		const { statement, identityId, aegisBundle } = params;
		const identityRecordId =
			typeof identityId === 'string' ? stringToRecordId.decode(identityId) : identityId;
		const aegis = this.aegisSetFragment(aegisBundle);

		const query = `
			BEGIN TRANSACTION;
			CREATE identity_rotation SET
				did = $did,
				seq = $seq,
				prev_root = $prevRoot,
				new_root = $newRoot,
				rotated_at = $rotatedAt,
				signature = $signature,
				created_at = $now;
			UPDATE $identityId SET public_key = $newRoot${aegis.clause};
			COMMIT TRANSACTION;
		`;

		await this.db.query(query, {
			did: statement.did,
			seq: statement.seq,
			prevRoot: statement.prevRoot,
			newRoot: statement.newRoot,
			rotatedAt: new Date(statement.rotatedAt),
			signature: statement.signature,
			now: new Date(),
			identityId: identityRecordId,
			...aegis.params
		});
	}

	/**
	 * Inverse of {@link appendStatementAndAdvanceRoot}: atomically restore the
	 * identity's previous root key (and prior Aegis columns for custodial) and
	 * delete the appended chain row, in one transaction. Used as the rollback
	 * undo when a later persistence step fails.
	 */
	async revertRootAndDeleteStatement(params: {
		did: string;
		seq: number;
		identityId: RecordId | string;
		/** Root key to restore. */
		publicKey: string;
		/** Prior Aegis bundle to restore (custodial); null/omitted for external. */
		aegisBundle?: AegisColumns | null;
	}): Promise<void> {
		const { did, seq, identityId, publicKey, aegisBundle } = params;
		const identityRecordId =
			typeof identityId === 'string' ? stringToRecordId.decode(identityId) : identityId;
		const aegis = this.aegisSetFragment(aegisBundle);

		const query = `
			BEGIN TRANSACTION;
			UPDATE $identityId SET public_key = $publicKey${aegis.clause};
			DELETE identity_rotation WHERE did = $did AND seq = $seq;
			COMMIT TRANSACTION;
		`;

		await this.db.query(query, {
			did,
			seq,
			identityId: identityRecordId,
			publicKey,
			...aegis.params
		});
	}
}

/**
 * Convert a stored chain row back to the wire-format rotation statement.
 * rotated_at is re-serialized as ISO-8601 (the signature was made over the
 * canonical statement; callers verifying signatures must use the statement
 * fields exactly as signed, so rotated_at is stored losslessly as datetime).
 */
export function rotationRowToStatement(row: IdentityRotation): RotationStatement {
	return {
		did: row.did,
		seq: row.seq,
		prevRoot: row.prev_root,
		newRoot: row.new_root,
		rotatedAt: row.rotated_at.toISOString(),
		signature: row.signature
	};
}

// Export singleton instance
export const identityRotationRepository = new IdentityRotationRepository();
