//! Validate did:syr identifiers.

use crate::parse::parse_did;

/// Check if a string is a valid did:syr identifier.
pub fn is_valid_syr_did(did: &str) -> bool {
    parse_did(did).is_ok()
}
