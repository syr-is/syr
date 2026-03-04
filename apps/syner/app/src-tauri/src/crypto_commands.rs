//! Tauri commands for Syr crypto.

use std::path::{Path, PathBuf};

use crate::persona_commands;
use tauri::Manager;

#[cfg(target_os = "android")]
use tauri_plugin_android_fs::{convert_string_to_file_path, AndroidFs, AndroidFsExt};

use syr_crypto_core::{
    canonical::canonicalize,
    encoding::{derive_did, encode_multibase},
    keys::{derive_public_key_from_seed, sign},
};
use syr_crypto_sigil::{decrypt_sigil, SigilObject};

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
pub async fn decrypt_sigil_cmd(sigil_json: String, passphrase: String) -> Result<Vec<u8>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let obj: SigilObject = serde_json::from_str(&sigil_json).map_err(|e| e.to_string())?;
        let seed = decrypt_sigil(&obj, &passphrase)?;
        Ok(seed.as_ref().to_vec())
    })
    .await
    .map_err(|e| e.to_string())
    .and_then(std::convert::identity)
}

#[tauri::command]
pub fn derive_public_key_from_seed_cmd(seed_base64: String) -> Result<Vec<u8>, String> {
    let raw = base64_decode(&seed_base64)?;
    if raw.len() != 32 {
        return Err("Seed must be 32 bytes".to_string());
    }
    let mut s = [0u8; 32];
    s.copy_from_slice(&raw);
    Ok(derive_public_key_from_seed(&s).to_vec())
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
pub fn canonicalize_cmd(obj_json: String) -> Result<String, String> {
    let obj: serde_json::Value = serde_json::from_str(&obj_json).map_err(|e| e.to_string())?;
    let map = obj.as_object().ok_or("Expected JSON object")?;
    let mut rust_map = serde_json::Map::new();
    for (k, v) in map {
        rust_map.insert(k.clone(), v.clone());
    }
    canonicalize(&rust_map)
}

#[tauri::command]
pub fn encode_multibase_cmd(bytes: Vec<u8>) -> String {
    encode_multibase(&bytes)
}

/// Reads file content at the given path. Used for sigil import when user selects a file via dialog.
/// Restricts to regular .sigil files within app-owned directories.
/// On Android, uses content URIs from the document picker (via tauri-plugin-android-fs).
#[tauri::command]
pub fn read_file_content_cmd(app: tauri::AppHandle, path: String) -> Result<String, String> {
    #[cfg(target_os = "android")]
    {
        read_file_content_android(&app, &path)
    }

    #[cfg(not(target_os = "android"))]
    {
        read_file_content_desktop(&app, &path)
    }
}

#[cfg(target_os = "android")]
fn read_file_content_android(app: &tauri::AppHandle, path: &str) -> Result<String, String> {
    let file_path = convert_string_to_file_path(path);
    let content = app
        .android_fs()
        .read_to_string(&file_path)
        .map_err(|e| format!("Path not found or invalid: {}", e))?;

    // Accept .sigil or .json (extension check from filename in URI/path)
    let filename = path.rsplit('/').next().unwrap_or(path);
    if let Some(ext) = filename.rfind('.').map(|i| &filename[i + 1..]) {
        if !ext.eq_ignore_ascii_case("sigil") && !ext.eq_ignore_ascii_case("json") {
            return Err("File must have .sigil or .json extension".to_string());
        }
    }
    Ok(content)
}

#[cfg(not(target_os = "android"))]
fn read_file_content_desktop(app: &tauri::AppHandle, path: &str) -> Result<String, String> {
    let path_buf = Path::new(path);
    let canonical = path_buf
        .canonicalize()
        .map_err(|e| format!("Path not found or invalid: {}", e))?;

    if !canonical.metadata().map_err(|e| e.to_string())?.is_file() {
        return Err("Path is not a regular file".to_string());
    }

    if let Some(ext) = canonical.extension().and_then(|e| e.to_str()) {
        if !ext.eq_ignore_ascii_case("sigil") && !ext.eq_ignore_ascii_case("json") {
            return Err("File must have .sigil or .json extension".to_string());
        }
    }

    let app_data = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let config_dir = app.path().config_dir().map_err(|e| e.to_string())?;
    let personas_base = persona_commands::get_base_path(app)?;

    let mut allowed_roots: Vec<PathBuf> = vec![app_data, config_dir, personas_base];
    if let Some(doc) = dirs::document_dir() {
        allowed_roots.push(doc);
    }
    if let Some(home) = dirs::home_dir() {
        allowed_roots.push(home);
    }

    let canonical_roots: Vec<PathBuf> = allowed_roots
        .iter()
        .map(|root| root.canonicalize().unwrap_or_else(|_| root.clone()))
        .collect();
    let in_allowed = canonical_roots
        .iter()
        .any(|root| canonical.starts_with(root));

    if !in_allowed {
        return Err("Path not in allowed directory".to_string());
    }

    std::fs::read_to_string(&canonical).map_err(|e| e.to_string())
}

fn base64_decode(s: &str) -> Result<Vec<u8>, String> {
    use base64::Engine;
    base64::engine::general_purpose::STANDARD
        .decode(s)
        .map_err(|e| e.to_string())
}
