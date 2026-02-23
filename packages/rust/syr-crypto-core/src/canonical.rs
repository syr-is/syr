//! RFC 8785 JSON Canonicalization Scheme (JCS).

use serde::Serialize;
use serde_jcs;

/// Canonicalize a JSON-serializable object using RFC 8785 JCS.
pub fn canonicalize<T: Serialize>(obj: &T) -> Result<String, String> {
    serde_jcs::to_string(obj).map_err(|e| e.to_string())
}
