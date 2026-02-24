//! Tauri commands for Syr crypto.

use serde::{Deserialize, Serialize};

use syr_crypto_core::{
    encoding::{
        decode_multibase, decode_private_key, decode_public_key, derive_did, encode_multibase,
        encode_private_key,
    },
    keys::{generate_device_keypair, generate_root_keypair, sign, verify, constant_time_equal},
    canonical::canonicalize,
    rotation::{create_rotation_statement, verify_rotation_statement, RotationStatement},
};
use syr_crypto_sigil::{create_sigil, decrypt_sigil, SigilObject};
use syr_crypto_aegis::{create_aegis_bundle, decrypt_aegis_bundle, AegisBundle};
use syr_did::{parse_did, build_did_document, is_valid_syr_did, BuildDidDocumentInput};

#[derive(Debug, Serialize, Deserialize)]
pub struct KeypairResult {
    pub public_key: Vec<u8>,
    pub private_key: Vec<u8>,
}

#[tauri::command]
pub fn generate_root_keypair_cmd() -> Result<KeypairResult, String> {
    let (pub_k, priv_k) = generate_root_keypair();
    Ok(KeypairResult {
        public_key: pub_k.to_vec(),
        private_key: priv_k.to_vec(),
    })
}

#[tauri::command]
pub fn generate_device_keypair_cmd() -> Result<KeypairResult, String> {
    let (pub_k, priv_k) = generate_device_keypair();
    Ok(KeypairResult {
        public_key: pub_k.to_vec(),
        private_key: priv_k.to_vec(),
    })
}

#[tauri::command]
pub fn sign_payload(payload: Vec<u8>, private_key_base64: String) -> Result<Vec<u8>, String> {
    let raw = base64_decode(&private_key_base64)?;
    if raw.len() != 32 {
        return Err("Private key must be 32 bytes".to_string());
    }
    let mut pk = [0u8; 32];
    pk.copy_from_slice(&raw);
    sign(&payload, &pk).map(|s| s.to_vec())
}

#[tauri::command]
pub fn verify_signature(
    payload: Vec<u8>,
    signature_base64: String,
    public_key_base64: String,
) -> Result<bool, String> {
    let pk_raw = base64_decode(&public_key_base64)?;
    if pk_raw.len() != 32 {
        return Err("Public key must be 32 bytes".to_string());
    }
    let sig_raw = base64_decode(&signature_base64)?;
    if sig_raw.len() != 64 {
        return Err("Signature must be 64 bytes".to_string());
    }
    let mut pk = [0u8; 32];
    pk.copy_from_slice(&pk_raw);
    let mut sig = [0u8; 64];
    sig.copy_from_slice(&sig_raw);
    Ok(verify(&payload, &sig, &pk))
}

#[tauri::command]
pub fn create_sigil_cmd(seed_base64: String, passphrase: String) -> Result<String, String> {
    let seed = base64_decode(&seed_base64)?;
    if seed.len() != 32 {
        return Err("Seed must be 32 bytes".to_string());
    }
    let mut s = [0u8; 32];
    s.copy_from_slice(&seed);
    let obj = create_sigil(&s, &passphrase)?;
    serde_json::to_string(&obj).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn decrypt_sigil_cmd(sigil_json: String, passphrase: String) -> Result<Vec<u8>, String> {
    let obj: SigilObject =
        serde_json::from_str(&sigil_json).map_err(|e| e.to_string())?;
    let seed = decrypt_sigil(&obj, &passphrase)?;
    Ok(seed.to_vec())
}

#[tauri::command]
pub fn create_aegis_bundle_cmd(seed_base64: String, password: String) -> Result<String, String> {
    let seed = base64_decode(&seed_base64)?;
    if seed.len() != 32 {
        return Err("Seed must be 32 bytes".to_string());
    }
    let mut s = [0u8; 32];
    s.copy_from_slice(&seed);
    let bundle = create_aegis_bundle(&s, &password)?;
    serde_json::to_string(&bundle).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn decrypt_aegis_bundle_cmd(bundle_json: String, password: String) -> Result<Vec<u8>, String> {
    let bundle: AegisBundle =
        serde_json::from_str(&bundle_json).map_err(|e| e.to_string())?;
    let seed = decrypt_aegis_bundle(&bundle, &password)?;
    Ok(seed.to_vec())
}

#[tauri::command]
pub fn derive_did_cmd(public_key_base64: String) -> Result<String, String> {
    let raw = base64_decode(&public_key_base64)?;
    if raw.len() != 32 {
        return Err("Public key must be 32 bytes".to_string());
    }
    let mut pk = [0u8; 32];
    pk.copy_from_slice(&raw);
    Ok(derive_did(&pk))
}

#[tauri::command]
pub fn parse_did_cmd(did: String) -> Result<serde_json::Value, String> {
    let parsed = parse_did(&did)?;
    Ok(serde_json::json!({
        "method": parsed.method,
        "id": parsed.id,
        "publicKey": parsed.public_key.to_vec()
    }))
}

#[tauri::command]
pub fn build_did_document_cmd(
    did: String,
    public_key_multibase: String,
    service_endpoint: Option<String>,
) -> Result<String, String> {
    let input = BuildDidDocumentInput {
        did: &did,
        public_key_multibase: &public_key_multibase,
        service_endpoint: service_endpoint.as_deref(),
    };
    let doc = build_did_document(input);
    serde_json::to_string(&doc).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn is_valid_syr_did_cmd(did: String) -> bool {
    is_valid_syr_did(&did)
}

#[tauri::command]
pub fn canonicalize_cmd(obj_json: String) -> Result<String, String> {
    let obj: serde_json::Value =
        serde_json::from_str(&obj_json).map_err(|e| e.to_string())?;
    let map = obj.as_object().ok_or("Expected JSON object")?;
    let mut rust_map = serde_json::Map::new();
    for (k, v) in map {
        rust_map.insert(k.clone(), v.clone());
    }
    canonicalize(&rust_map)
}

#[tauri::command]
pub fn create_rotation_statement_cmd(
    did: String,
    new_public_key_base64: String,
    current_private_key_base64: String,
) -> Result<String, String> {
    let new_pk_raw = base64_decode(&new_public_key_base64)?;
    if new_pk_raw.len() != 32 {
        return Err("New public key must be 32 bytes".to_string());
    }
    let priv_raw = base64_decode(&current_private_key_base64)?;
    if priv_raw.len() != 32 {
        return Err("Current private key must be 32 bytes".to_string());
    }
    let mut pk = [0u8; 32];
    pk.copy_from_slice(&new_pk_raw);
    let mut priv_k = [0u8; 32];
    priv_k.copy_from_slice(&priv_raw);
    let stmt = create_rotation_statement(&did, &pk, &priv_k)?;
    serde_json::to_string(&stmt).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn verify_rotation_statement_cmd(
    statement_json: String,
    current_public_key_base64: String,
) -> Result<bool, String> {
    let stmt: RotationStatement =
        serde_json::from_str(&statement_json).map_err(|e| e.to_string())?;
    let raw = base64_decode(&current_public_key_base64)?;
    if raw.len() != 32 {
        return Err("Current public key must be 32 bytes".to_string());
    }
    let mut pk = [0u8; 32];
    pk.copy_from_slice(&raw);
    verify_rotation_statement(&stmt, &pk)
}

#[tauri::command]
pub fn encode_multibase_cmd(bytes: Vec<u8>) -> String {
    encode_multibase(&bytes)
}

#[tauri::command]
pub fn decode_multibase_cmd(encoded: String) -> Result<Vec<u8>, String> {
    decode_multibase(&encoded)
}

#[tauri::command]
pub fn decode_public_key_cmd(encoded: String) -> Result<Vec<u8>, String> {
    decode_public_key(&encoded).map(|a| a.to_vec())
}

#[tauri::command]
pub fn decode_private_key_cmd(encoded: String) -> Result<Vec<u8>, String> {
    decode_private_key(&encoded).map(|a| a.to_vec())
}

#[tauri::command]
pub fn encode_private_key_cmd(raw: Vec<u8>) -> Result<String, String> {
    if raw.len() != 32 {
        return Err("Expected 32-byte key".to_string());
    }
    let mut arr = [0u8; 32];
    arr.copy_from_slice(&raw);
    Ok(encode_private_key(&arr))
}

#[tauri::command]
pub fn constant_time_equal_cmd(a: Vec<u8>, b: Vec<u8>) -> bool {
    constant_time_equal(&a, &b)
}

fn base64_decode(s: &str) -> Result<Vec<u8>, String> {
    use base64::Engine;
    base64::engine::general_purpose::STANDARD
        .decode(s)
        .map_err(|e| e.to_string())
}
