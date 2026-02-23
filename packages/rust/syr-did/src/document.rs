//! Build DID documents.

use crate::types::{DidDocument, ServiceEndpoint, VerificationMethod};

/// Build a DID Document for a did:syr identity.
pub fn build_did_document(input: BuildDidDocumentInput<'_>) -> DidDocument {
    let verification_method = vec![VerificationMethod {
        id: "#root".to_string(),
        key_type: "Ed25519VerificationKey2020".to_string(),
        controller: input.did.to_string(),
        public_key_multibase: input.public_key_multibase.to_string(),
    }];

    let service = input.service_endpoint.map(|url| {
        vec![ServiceEndpoint {
            id: "#provider".to_string(),
            service_type: "SyrIdentityProvider".to_string(),
            service_endpoint: url.to_string(),
        }]
    });

    DidDocument {
        context: serde_json::json!([
            "https://www.w3.org/ns/did/v1",
            "https://w3id.org/security/suites/ed25519-2020/v1"
        ]),
        id: input.did.to_string(),
        verification_method,
        authentication: vec!["#root".to_string()],
        assertion_method: vec!["#root".to_string()],
        service,
    }
}

pub struct BuildDidDocumentInput<'a> {
    pub did: &'a str,
    pub public_key_multibase: &'a str,
    pub service_endpoint: Option<&'a str>,
}
