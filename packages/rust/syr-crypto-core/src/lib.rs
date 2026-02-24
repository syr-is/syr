//! Syr crypto core: Ed25519 keys, multibase encoding, signing, canonicalization.

pub mod encoding;
pub mod keys;
pub mod canonical;
pub mod rotation;

pub use encoding::{
    encode_multibase, decode_multibase, decode_public_key, decode_private_key, encode_private_key,
    derive_did, ED25519_MULTICODEC_PREFIX, ED25519_PRIV_MULTICODEC_PREFIX,
};
pub use keys::{generate_root_keypair, generate_device_keypair, sign, verify, constant_time_equal};
pub use canonical::canonicalize;
pub use rotation::{create_rotation_statement, verify_rotation_statement, RotationStatement};
