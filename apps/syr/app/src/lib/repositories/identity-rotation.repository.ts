import { BaseRepository } from './base.repository';
import { IdentityRotationSchema, type IdentityRotation } from '@syr-is/types';
import type { RotationStatement } from '@syr-is/types';

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

	/**
	 * Append a rotation statement to the chain. The unique (did, seq) index
	 * rejects concurrent duplicate appends.
	 */
	async appendStatement(statement: RotationStatement): Promise<IdentityRotation> {
		const result = await this.db.query<[IdentityRotation[]]>(
			`CREATE identity_rotation SET
				did = $did,
				seq = $seq,
				prev_root = $prevRoot,
				new_root = $newRoot,
				rotated_at = $rotatedAt,
				signature = $signature,
				created_at = $now;`,
			{
				did: statement.did,
				seq: statement.seq,
				prevRoot: statement.prevRoot,
				newRoot: statement.newRoot,
				rotatedAt: new Date(statement.rotatedAt),
				signature: statement.signature,
				now: new Date()
			}
		);
		const record = result[0]?.[0];
		if (!record) throw new Error('Failed to append rotation statement.');
		return this.validate(record);
	}

	/**
	 * Remove a single chain row (rollback of a failed rotation flow only —
	 * the chain is otherwise append-only).
	 */
	async deleteByDidAndSeq(did: string, seq: number): Promise<void> {
		await this.db.query('DELETE identity_rotation WHERE did = $did AND seq = $seq', { did, seq });
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
