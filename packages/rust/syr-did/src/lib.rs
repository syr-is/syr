//! did:syr parse, document, validate.

pub mod parse;
pub mod document;
pub mod validate;
pub mod types;

pub use parse::parse_did;
pub use document::{build_did_document, BuildDidDocumentInput};
pub use validate::is_valid_syr_did;
pub use types::{ParsedDid, VerificationMethod, ServiceEndpoint, DidDocument};
