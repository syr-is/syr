//! Ed25519 key generation, signing, and verification.

use ed25519_dalek::ed25519::signature::{Signer, Verifier};
use ed25519_dalek::{Signature, SigningKey, VerifyingKey};
use rand::rngs::OsRng;

/// Constant-time comparison of two byte arrays.
/// Use for comparing keys or tokens to avoid timing side channels.
pub fn constant_time_equal(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    let mut diff = 0u8;
    for (x, y) in a.iter().zip(b.iter()) {
        diff |= x ^ y;
    }
    diff == 0
}

/// Generate an Ed25519 root keypair.
pub fn generate_root_keypair() -> ([u8; 32], [u8; 32]) {
    generate_keypair()
}

/// Generate an Ed25519 device keypair.
pub fn generate_device_keypair() -> ([u8; 32], [u8; 32]) {
    generate_keypair()
}

fn generate_keypair() -> ([u8; 32], [u8; 32]) {
    let signing_key = SigningKey::generate(&mut OsRng);
    let public_key = signing_key.verifying_key();
    (
        public_key.as_bytes().to_owned(),
        signing_key.as_bytes().to_owned(),
    )
}

/// Sign a payload with an Ed25519 private key.
pub fn sign(payload: &[u8], private_key: &[u8; 32]) -> Result<[u8; 64], String> {
    let signing_key = SigningKey::from_bytes(private_key);
    let sig: Signature = signing_key.sign(payload);
    let mut arr = [0u8; 64];
    arr.copy_from_slice(sig.to_bytes().as_ref());
    Ok(arr)
}

/// Verify an Ed25519 signature.
pub fn verify(payload: &[u8], signature: &[u8], public_key: &[u8; 32]) -> bool {
    let key = match VerifyingKey::from_bytes(public_key) {
        Ok(k) => k,
        Err(_) => return false,
    };
    if signature.len() != 64 {
        return false;
    }
    let mut sig_bytes = [0u8; 64];
    sig_bytes.copy_from_slice(signature);
    let sig = Signature::from_bytes(&sig_bytes);
    key.verify(payload, &sig).is_ok()
}
