//! Root key rotation statements and chain verification.
//!
//! A did:syr identifier is derived from the *genesis* root key and never
//! changes. Rotation appends statements to a per-DID chain; the current root
//! key is the `newRoot` of the last valid statement (or the genesis key when
//! the chain is empty).
//!
//! Statement payload v2 (RFC 8785 JCS canonical, then Ed25519):
//! `{ did, seq, prevRoot, newRoot, rotatedAt }`
//! signed by the private key of `prevRoot` (the retiring key authorizes its
//! successor).

use serde::{Deserialize, Serialize};

use crate::canonical::canonicalize;
use crate::encoding::{
    decode_multibase, decode_public_key, encode_multibase, ED25519_MULTICODEC_PREFIX,
};
use crate::keys::{derive_public_key_from_seed, sign, verify};

/// A rotation statement signed by the retiring root key.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RotationStatement {
    pub did: String,
    /// 1-based position in the chain; strictly increasing, no gaps.
    pub seq: u64,
    /// Multibase key being retired. Statement 1's prevRoot MUST be the genesis key.
    #[serde(rename = "prevRoot")]
    pub prev_root: String,
    #[serde(rename = "newRoot")]
    pub new_root: String,
    #[serde(rename = "rotatedAt")]
    pub rotated_at: String,
    pub signature: String,
}

/// Canonical signing payload for a rotation statement (v2).
#[derive(Serialize)]
struct RotationPayload<'a> {
    did: &'a str,
    seq: u64,
    #[serde(rename = "prevRoot")]
    prev_root: &'a str,
    #[serde(rename = "newRoot")]
    new_root: &'a str,
    #[serde(rename = "rotatedAt")]
    rotated_at: &'a str,
}

fn encode_public_key_multibase(public_key: &[u8; 32]) -> String {
    let mut prefixed = Vec::with_capacity(ED25519_MULTICODEC_PREFIX.len() + 32);
    prefixed.extend_from_slice(&ED25519_MULTICODEC_PREFIX);
    prefixed.extend_from_slice(public_key);
    encode_multibase(&prefixed)
}

fn canonical_payload(statement_fields: &RotationPayload<'_>) -> Result<Vec<u8>, String> {
    let payload_str = canonicalize(statement_fields)?;
    Ok(payload_str.into_bytes())
}

/// Extract the genesis Ed25519 public key encoded in a did:syr identifier.
pub fn genesis_key_from_did(did: &str) -> Result<[u8; 32], String> {
    let id = did
        .strip_prefix("did:syr:")
        .ok_or_else(|| "Invalid DID: expected did:syr: prefix".to_string())?;
    decode_public_key(id)
}

/// Create a root key rotation statement.
///
/// `seq` is the 1-based chain position of the new statement. `prev_root` is
/// derived from `current_private_key` (the retiring key), which also signs
/// the canonical payload.
pub fn create_rotation_statement(
    did: &str,
    seq: u64,
    new_public_key: &[u8; 32],
    current_private_key: &[u8; 32],
) -> Result<RotationStatement, String> {
    if seq == 0 {
        return Err("Rotation seq must be >= 1".to_string());
    }
    let prev_public_key = derive_public_key_from_seed(current_private_key);
    let prev_root = encode_public_key_multibase(&prev_public_key);
    let new_root = encode_public_key_multibase(new_public_key);
    // Millisecond-precision UTC "Z" form (matches JS Date#toISOString) so the
    // signed timestamp survives datetime storage roundtrips losslessly.
    let rotated_at = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);

    let payload = RotationPayload {
        did,
        seq,
        prev_root: &prev_root,
        new_root: &new_root,
        rotated_at: &rotated_at,
    };
    let payload_bytes = canonical_payload(&payload)?;

    let signature_bytes = sign(&payload_bytes, current_private_key)?;
    let signature = encode_multibase(&signature_bytes);

    Ok(RotationStatement {
        did: did.to_string(),
        seq,
        prev_root,
        new_root,
        rotated_at,
        signature,
    })
}

/// Verify a single rotation statement's signature under the retiring key.
pub fn verify_rotation_statement(
    statement: &RotationStatement,
    current_public_key: &[u8; 32],
) -> Result<bool, String> {
    let payload = RotationPayload {
        did: &statement.did,
        seq: statement.seq,
        prev_root: &statement.prev_root,
        new_root: &statement.new_root,
        rotated_at: &statement.rotated_at,
    };
    let payload_bytes = canonical_payload(&payload)?;

    let signature_bytes = decode_multibase(&statement.signature)?;
    if signature_bytes.len() != 64 {
        return Err("Invalid signature length".to_string());
    }
    let mut sig = [0u8; 64];
    sig.copy_from_slice(&signature_bytes);

    Ok(verify(&payload_bytes, &sig, current_public_key))
}

/// Verify a full rotation chain for `did` and return the current root key.
///
/// Validation rules:
/// - statement `did` must equal `did` (no cross-DID replay)
/// - `seq` is 1-based, strictly increasing, no gaps
/// - statement 1's `prevRoot` must equal the genesis key derived from the DID;
///   statement i's `prevRoot` must equal statement i-1's `newRoot` (no forks)
/// - each signature must verify under that statement's `prevRoot`
/// - `rotatedAt` must be non-decreasing along the chain
///
/// An empty chain is valid; the current root is the genesis key.
pub fn verify_rotation_chain(
    did: &str,
    statements: &[RotationStatement],
) -> Result<[u8; 32], String> {
    let genesis = genesis_key_from_did(did)?;
    let mut current_key = genesis;
    let mut last_rotated_at: Option<chrono::DateTime<chrono::FixedOffset>> = None;

    for (index, statement) in statements.iter().enumerate() {
        let expected_seq = (index as u64) + 1;

        if statement.did != did {
            return Err(format!(
                "Rotation chain invalid at seq {expected_seq}: statement DID does not match chain DID"
            ));
        }
        if statement.seq != expected_seq {
            return Err(format!(
                "Rotation chain invalid: expected seq {expected_seq}, got {}",
                statement.seq
            ));
        }

        let prev_root_key = decode_public_key(&statement.prev_root).map_err(|e| {
            format!("Rotation chain invalid at seq {expected_seq}: bad prevRoot ({e})")
        })?;
        if prev_root_key != current_key {
            return Err(if expected_seq == 1 {
                "Rotation chain invalid: statement 1 prevRoot does not match the genesis key"
                    .to_string()
            } else {
                format!(
                    "Rotation chain invalid at seq {expected_seq}: prevRoot does not match prior newRoot"
                )
            });
        }

        let rotated_at =
            chrono::DateTime::parse_from_rfc3339(&statement.rotated_at).map_err(|e| {
                format!("Rotation chain invalid at seq {expected_seq}: bad rotatedAt ({e})")
            })?;
        if let Some(prev_rotated_at) = last_rotated_at {
            if rotated_at < prev_rotated_at {
                return Err(format!(
                    "Rotation chain invalid at seq {expected_seq}: rotatedAt decreases"
                ));
            }
        }

        let valid = verify_rotation_statement(statement, &prev_root_key)?;
        if !valid {
            return Err(format!(
                "Rotation chain invalid at seq {expected_seq}: signature not made by prevRoot"
            ));
        }

        current_key = decode_public_key(&statement.new_root).map_err(|e| {
            format!("Rotation chain invalid at seq {expected_seq}: bad newRoot ({e})")
        })?;
        last_rotated_at = Some(rotated_at);
    }

    Ok(current_key)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::encoding::derive_did;
    use crate::keys::generate_root_keypair;

    /// (public key, private key) pairs for root0..rootN.
    type ChainKeys = Vec<([u8; 32], [u8; 32])>;

    /// Build a valid chain of `hops` rotations from a fresh genesis key.
    /// Returns (did, statements, private keys root0..rootN).
    fn build_chain(hops: usize) -> (String, Vec<RotationStatement>, ChainKeys) {
        let genesis = generate_root_keypair();
        let did = derive_did(&genesis.0);
        let mut keys = vec![genesis];
        let mut statements = Vec::with_capacity(hops);
        for i in 0..hops {
            let next = generate_root_keypair();
            let (_, current_priv) = keys[i];
            let stmt =
                create_rotation_statement(&did, (i as u64) + 1, &next.0, &current_priv).unwrap();
            statements.push(stmt);
            keys.push(next);
        }
        (did, statements, keys)
    }

    #[test]
    fn create_and_verify_rotation_statement() {
        let (old_pub, old_priv) = generate_root_keypair();
        let (new_pub, _) = generate_root_keypair();
        let did = derive_did(&old_pub);

        let stmt = create_rotation_statement(&did, 1, &new_pub, &old_priv).unwrap();
        assert_eq!(stmt.did, did);
        assert_eq!(stmt.seq, 1);
        // prevRoot is derived from the signing (retiring) key.
        assert_eq!(decode_public_key(&stmt.prev_root).unwrap(), old_pub);
        assert!(!stmt.signature.is_empty());

        let valid = verify_rotation_statement(&stmt, &old_pub).unwrap();
        assert!(valid);
    }

    #[test]
    fn verify_rotation_rejects_wrong_key() {
        let (old_pub, old_priv) = generate_root_keypair();
        let (new_pub, _) = generate_root_keypair();
        let (wrong_pub, _) = generate_root_keypair();
        let did = derive_did(&old_pub);

        let stmt = create_rotation_statement(&did, 1, &new_pub, &old_priv).unwrap();
        let valid = verify_rotation_statement(&stmt, &wrong_pub).unwrap();
        assert!(!valid);
    }

    #[test]
    fn empty_chain_resolves_to_genesis() {
        let (genesis_pub, _) = generate_root_keypair();
        let did = derive_did(&genesis_pub);
        let current = verify_rotation_chain(&did, &[]).unwrap();
        assert_eq!(current, genesis_pub);
    }

    #[test]
    fn happy_chain_of_three_rotations() {
        let (did, statements, keys) = build_chain(3);
        let current = verify_rotation_chain(&did, &statements).unwrap();
        assert_eq!(current, keys.last().unwrap().0);
    }

    #[test]
    fn rejects_seq_gap() {
        let (did, mut statements, keys) = build_chain(1);
        // Second statement claims seq 3 (gap) even though correctly linked + signed.
        let next = generate_root_keypair();
        let stmt = create_rotation_statement(&did, 3, &next.0, &keys[1].1).unwrap();
        statements.push(stmt);
        let err = verify_rotation_chain(&did, &statements).unwrap_err();
        assert!(err.contains("expected seq 2"), "unexpected error: {err}");
    }

    #[test]
    fn rejects_wrong_signer() {
        let (did, mut statements, keys) = build_chain(1);
        // Attacker signs seq 2 with their own key but forges prevRoot to look linked.
        let (attacker_pub, attacker_priv) = generate_root_keypair();
        let _ = attacker_pub;
        let next = generate_root_keypair();
        let mut stmt = create_rotation_statement(&did, 2, &next.0, &attacker_priv).unwrap();
        // Forge the link: claim the legitimate current root as prevRoot.
        stmt.prev_root = statements[0].new_root.clone();
        let _ = keys;
        statements.push(stmt);
        let err = verify_rotation_chain(&did, &statements).unwrap_err();
        assert!(err.contains("signature"), "unexpected error: {err}");
    }

    #[test]
    fn rejects_fork_prev_root_mismatch() {
        let (did, mut statements, keys) = build_chain(2);
        // Fork: a second seq-3 statement whose prevRoot points at root1 instead of root2.
        let next = generate_root_keypair();
        let fork = create_rotation_statement(&did, 3, &next.0, &keys[1].1).unwrap();
        statements.push(fork);
        let err = verify_rotation_chain(&did, &statements).unwrap_err();
        assert!(
            err.contains("prevRoot does not match prior newRoot"),
            "unexpected error: {err}"
        );
    }

    #[test]
    fn rejects_first_statement_prev_root_not_genesis() {
        let (genesis_pub, _) = generate_root_keypair();
        let did = derive_did(&genesis_pub);
        // Statement 1 signed by a non-genesis key (its prevRoot is that key, not genesis).
        let (_, other_priv) = generate_root_keypair();
        let next = generate_root_keypair();
        let stmt = create_rotation_statement(&did, 1, &next.0, &other_priv).unwrap();
        let err = verify_rotation_chain(&did, &[stmt]).unwrap_err();
        assert!(
            err.contains("does not match the genesis key"),
            "unexpected error: {err}"
        );
    }

    #[test]
    fn rejects_cross_did_replay() {
        // A valid chain for DID A replayed against DID B whose genesis is A's genesis?
        // No — cross-DID replay: statements carry DID A but are presented for DID B.
        let (did_a, statements, _) = build_chain(1);
        let (other_pub, _) = generate_root_keypair();
        let did_b = derive_did(&other_pub);
        assert_ne!(did_a, did_b);
        let err = verify_rotation_chain(&did_b, &statements).unwrap_err();
        assert!(
            err.contains("DID does not match"),
            "unexpected error: {err}"
        );
    }

    #[test]
    fn rejects_decreasing_rotated_at() {
        let (did, mut statements, keys) = build_chain(2);
        // Backdate the second statement (re-sign so the signature stays valid).
        let backdated_at = "2000-01-01T00:00:00+00:00".to_string();
        let payload = RotationPayload {
            did: &did,
            seq: 2,
            prev_root: &statements[1].prev_root,
            new_root: &statements[1].new_root,
            rotated_at: &backdated_at,
        };
        let payload_bytes = canonical_payload(&payload).unwrap();
        let sig = sign(&payload_bytes, &keys[1].1).unwrap();
        statements[1].rotated_at = backdated_at;
        statements[1].signature = encode_multibase(&sig);
        let err = verify_rotation_chain(&did, &statements).unwrap_err();
        assert!(
            err.contains("rotatedAt decreases"),
            "unexpected error: {err}"
        );
    }

    #[test]
    fn genesis_key_from_did_roundtrip() {
        let (pub_k, _) = generate_root_keypair();
        let did = derive_did(&pub_k);
        assert_eq!(genesis_key_from_did(&did).unwrap(), pub_k);
        assert!(genesis_key_from_did("did:web:example.com").is_err());
    }
}
