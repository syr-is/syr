//! Tauri commands for persona (local identity) management.

use serde::{Deserialize, Serialize};
use std::fs::File;
use std::io::{Read, Write};
use std::path::{Component, Path, PathBuf};
use tauri::Manager;
use tauri_plugin_dialog::DialogExt;
use zip::write::SimpleFileOptions;
use zip::ZipWriter;

#[cfg(target_os = "android")]
use tauri_plugin_android_fs::{convert_string_to_file_path, AndroidFs, AndroidFsExt};

use syr_crypto_core::{
    encoding::{derive_did, encode_multibase, ED25519_MULTICODEC_PREFIX},
    keys::{derive_public_key_from_seed, generate_root_keypair},
};
use syr_crypto_sigil::{create_sigil, decrypt_sigil, SigilObject};

const CONFIG_FILENAME: &str = "config.json";
const MAX_ARCHIVE_BYTES: usize = 20 * 1024 * 1024; // 20MB
const MAX_ENTRY_BYTES: usize = 5 * 1024 * 1024; // 5MB per file
#[derive(Debug, Serialize, Deserialize)]
struct PersonaConfig {
    personas_base_path: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Persona {
    pub id: String,
    pub did: String,
    pub public_key: String,
    pub display_name: String,
    pub bio: Option<String>,
    pub avatar_url: Option<String>,
    pub banner_url: Option<String>,
    /// Public URL where this identity’s “home” lives (optional).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub identity_host_url: Option<String>,
    pub created_at: String,
    /// File mtime (Unix timestamp) for cache busting; not stored in profile.json
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub avatar_mtime: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub banner_mtime: Option<i64>,
}

/// Default personas storage path. On iOS uses Documents (exposed in Finder/Files); otherwise app data dir.
#[cfg(target_os = "ios")]
fn default_personas_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .document_dir()
        .map_err(|e| e.to_string())
        .map(|p| p.join("syr-personas"))
        .or_else(|_| {
            app.path()
                .app_data_dir()
                .map_err(|e| e.to_string())
                .map(|p| p.join("syr-personas"))
        })
}

#[cfg(not(target_os = "ios"))]
fn default_personas_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map_err(|e| e.to_string())
        .map(|p| p.join("syr-personas"))
}

fn config_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let app_data = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&app_data).map_err(|e| e.to_string())?;
    Ok(app_data.join(CONFIG_FILENAME))
}

fn load_config(app: &tauri::AppHandle) -> Result<PersonaConfig, String> {
    let path = config_path(app)?;
    if path.exists() {
        let content = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
        serde_json::from_str(&content).map_err(|e| e.to_string())
    } else {
        Ok(PersonaConfig {
            personas_base_path: None,
        })
    }
}

fn save_config(app: &tauri::AppHandle, config: &PersonaConfig) -> Result<(), String> {
    let path = config_path(app)?;
    let content = serde_json::to_string_pretty(config).map_err(|e| e.to_string())?;
    std::fs::write(&path, content).map_err(|e| e.to_string())
}

pub fn get_base_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    #[cfg(target_os = "ios")]
    {
        default_personas_path(app)
    }

    #[cfg(not(target_os = "ios"))]
    {
        let config = load_config(app)?;
        match config.personas_base_path {
            Some(ref p) if !p.is_empty() => Ok(PathBuf::from(p)),
            _ => default_personas_path(app),
        }
    }
}

fn base64_encode(bytes: &[u8]) -> String {
    use base64::Engine;
    base64::engine::general_purpose::STANDARD.encode(bytes)
}

fn base64_decode(s: &str) -> Result<Vec<u8>, String> {
    use base64::Engine;
    base64::engine::general_purpose::STANDARD
        .decode(s)
        .map_err(|e| e.to_string())
}

fn validate_identity_host_url(s: &str) -> Result<(), String> {
    if s.len() > 2048 {
        return Err("Identity page URL is too long (max 2048 characters)".to_string());
    }
    let u = url::Url::parse(s).map_err(|_| "Invalid identity page URL".to_string())?;
    match u.scheme() {
        "http" | "https" => Ok(()),
        _ => Err("Identity page URL must use http or https".to_string()),
    }
}

fn validate_persona_id(persona_id: &str) -> Result<(), String> {
    for c in Path::new(persona_id).components() {
        if !matches!(c, Component::Normal(_)) {
            return Err("Invalid persona id: path traversal not allowed".to_string());
        }
    }
    Ok(())
}

/// Derive persona id (folder name) from public key: multibase-encoded with multicodec prefix.
fn persona_id_from_public_key(public_key: &[u8; 32]) -> String {
    let mut prefixed = Vec::with_capacity(ED25519_MULTICODEC_PREFIX.len() + 32);
    prefixed.extend_from_slice(&ED25519_MULTICODEC_PREFIX);
    prefixed.extend_from_slice(public_key);
    encode_multibase(&prefixed)
}

#[tauri::command]
pub fn get_personas_base_path_cmd(app: tauri::AppHandle) -> Result<String, String> {
    let path = get_base_path(&app)?;
    Ok(path.to_string_lossy().to_string())
}

#[tauri::command]
pub fn set_personas_base_path_cmd(app: tauri::AppHandle, path: String) -> Result<(), String> {
    #[cfg(target_os = "ios")]
    {
        let _ = app;
        let _ = path;
        return Err(
            "iOS does not support custom storage paths. Personas are stored in the app's Documents folder."
                .to_string(),
        );
    }

    #[cfg(not(target_os = "ios"))]
    {
        let mut config = load_config(&app)?;
        config.personas_base_path = Some(path);
        save_config(&app, &config)
    }
}

#[tauri::command]
pub fn persona_id_from_public_key_cmd(public_key_base64: String) -> Result<String, String> {
    let bytes = base64_decode(&public_key_base64)?;
    let arr: [u8; 32] = bytes
        .try_into()
        .map_err(|_| "Public key must be 32 bytes".to_string())?;
    Ok(persona_id_from_public_key(&arr))
}

#[tauri::command]
pub fn persona_exists_cmd(app: tauri::AppHandle, persona_id: String) -> Result<bool, String> {
    validate_persona_id(&persona_id)?;
    let base = get_base_path(&app)?;
    let persona_dir = base.join(&persona_id);
    let profile_path = persona_dir.join("profile.json");
    Ok(persona_dir.exists() && profile_path.exists())
}

const IMAGE_EXTENSIONS: &[&str] = &["png", "jpg", "jpeg", "gif", "webp"];

#[allow(dead_code)]
fn extension_from_path(path: &Path) -> String {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_lowercase())
        .filter(|e| IMAGE_EXTENSIONS.iter().any(|&ext| ext == e))
        .unwrap_or_else(|| "png".to_string())
}

/// Extracts image extension from path or content URI. Content URIs (e.g. on Android) don't parse via Path.
fn extension_from_path_or_uri(s: &str) -> String {
    let segments: Vec<_> = s.split(&['/', '\\'][..]).collect();
    let last = segments.last().unwrap_or(&s);
    let ext = last.rsplit('.').next().unwrap_or("").to_lowercase();
    if IMAGE_EXTENSIONS.iter().any(|e| *e == ext) {
        ext
    } else {
        "png".to_string()
    }
}

/// Reads file bytes from source. On Android, source may be a content URI (uses android-fs).
#[allow(dead_code)]
fn read_file_bytes_from_source(
    _app: &tauri::AppHandle,
    source_path: &str,
) -> Result<Vec<u8>, String> {
    #[cfg(target_os = "android")]
    {
        let file_path = convert_string_to_file_path(source_path);
        let mut file = _app
            .android_fs()
            .open_file(&file_path)
            .map_err(|e| format!("Path not found or invalid: {}", e))?;
        let mut buf = Vec::new();
        std::io::Read::read_to_end(&mut file, &mut buf).map_err(|e| e.to_string())?;
        Ok(buf)
    }

    #[cfg(not(target_os = "android"))]
    {
        std::fs::read(source_path).map_err(|e| e.to_string())
    }
}

/// Copies image from source to dest. On Android, source may be a content URI (uses android-fs).
#[allow(unused_variables)]
fn copy_image_from_source(
    app: &tauri::AppHandle,
    source_path: &str,
    dest: &Path,
) -> Result<(), String> {
    #[cfg(target_os = "android")]
    {
        let file_path = convert_string_to_file_path(source_path);
        let mut file = app
            .android_fs()
            .open_file(&file_path)
            .map_err(|e| format!("Path not found or invalid: {}", e))?;
        let mut buf = Vec::new();
        std::io::Read::read_to_end(&mut file, &mut buf).map_err(|e| e.to_string())?;
        let mut f = std::fs::File::create(dest).map_err(|e| e.to_string())?;
        std::io::Write::write_all(&mut f, &buf).map_err(|e| e.to_string())?;
        f.sync_all().map_err(|e| e.to_string())?;
        Ok(())
    }

    #[cfg(not(target_os = "android"))]
    {
        let path = normalize_picker_path(source_path);
        std::fs::copy(&path, dest)
            .map_err(|e| e.to_string())
            .map(|_| ())
    }
}

fn resolve_relative_asset(persona_dir: &Path, url: Option<&String>) -> Option<String> {
    let url = url?;
    let path = url.strip_prefix("./").or_else(|| url.strip_prefix(".\\"))?;
    let full = persona_dir.join(path);
    if full.exists() {
        Some(full.to_string_lossy().to_string())
    } else {
        None
    }
}

fn find_legacy_asset(persona_dir: &Path, prefix: &str) -> Option<String> {
    for ext in IMAGE_EXTENSIONS {
        let p = persona_dir.join(format!("{}.{}", prefix, ext));
        if p.exists() {
            return Some(p.to_string_lossy().to_string());
        }
    }
    None
}

fn file_mtime(path: &Path) -> Option<i64> {
    std::fs::metadata(path)
        .ok()?
        .modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs() as i64)
}

fn resolve_persona_asset_paths(persona_dir: &Path, mut persona: Persona) -> Persona {
    persona.avatar_url = resolve_relative_asset(persona_dir, persona.avatar_url.as_ref())
        .or_else(|| find_legacy_asset(persona_dir, "avatar"));
    persona.avatar_mtime = persona
        .avatar_url
        .as_ref()
        .and_then(|p| file_mtime(Path::new(p)));

    persona.banner_url = resolve_relative_asset(persona_dir, persona.banner_url.as_ref())
        .or_else(|| find_legacy_asset(persona_dir, "banner"));
    persona.banner_mtime = persona
        .banner_url
        .as_ref()
        .and_then(|p| file_mtime(Path::new(p)));
    persona
}

#[tauri::command]
pub fn list_personas_cmd(app: tauri::AppHandle) -> Result<Vec<Persona>, String> {
    let base = get_base_path(&app)?;
    if !base.exists() {
        return Ok(vec![]);
    }
    let mut personas = Vec::new();
    for entry in std::fs::read_dir(&base).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        if path.is_dir() {
            let profile_path = path.join("profile.json");
            if profile_path.exists() {
                let content = std::fs::read_to_string(&profile_path).map_err(|e| e.to_string())?;
                let persona: Persona = serde_json::from_str(&content).map_err(|e| e.to_string())?;
                personas.push(resolve_persona_asset_paths(&path, persona));
            }
        }
    }
    personas.sort_by(|a, b| a.created_at.cmp(&b.created_at));
    Ok(personas)
}

#[tauri::command]
pub fn create_persona_cmd(
    app: tauri::AppHandle,
    display_name: String,
    bio: Option<String>,
    passphrase: String,
) -> Result<Persona, String> {
    let (_pub_k, priv_k) = generate_root_keypair();
    let sigil = create_sigil(&priv_k, &passphrase)?;
    let sigil_json = serde_json::to_string(&sigil).map_err(|e| e.to_string())?;

    let public_key = derive_public_key_from_seed(&priv_k);
    let did = derive_did(&public_key);
    let public_key_b64 = base64_encode(&public_key);
    let id = persona_id_from_public_key(&public_key);
    let created_at = chrono::Utc::now().to_rfc3339();

    let persona = Persona {
        id: id.clone(),
        did: did.clone(),
        public_key: public_key_b64,
        display_name: display_name.clone(),
        bio: bio.clone(),
        avatar_url: None,
        banner_url: None,
        identity_host_url: None,
        created_at: created_at.clone(),
        avatar_mtime: None,
        banner_mtime: None,
    };

    let base = get_base_path(&app)?;
    let persona_dir = base.join(&id);
    std::fs::create_dir_all(&persona_dir).map_err(|e| e.to_string())?;

    let profile_json = serde_json::to_string(&persona).map_err(|e| e.to_string())?;
    std::fs::write(persona_dir.join("profile.json"), &profile_json).map_err(|e| e.to_string())?;
    std::fs::write(persona_dir.join("identity.sigil"), &sigil_json).map_err(|e| e.to_string())?;

    Ok(persona)
}

#[tauri::command]
pub fn import_persona_from_sigil_cmd(
    app: tauri::AppHandle,
    sigil_json: String,
    passphrase: String,
    display_name: String,
    bio: Option<String>,
) -> Result<Persona, String> {
    let obj: SigilObject = serde_json::from_str(&sigil_json).map_err(|e| e.to_string())?;
    let seed = decrypt_sigil(&obj, &passphrase)?;
    let sigil_json = serde_json::to_string(&obj).map_err(|e| e.to_string())?;

    let public_key = derive_public_key_from_seed(&seed);
    let did = derive_did(&public_key);
    let public_key_b64 = base64_encode(&public_key);
    let id = persona_id_from_public_key(&public_key);
    let created_at = chrono::Utc::now().to_rfc3339();

    let persona = Persona {
        id: id.clone(),
        did: did.clone(),
        public_key: public_key_b64,
        display_name: display_name.clone(),
        bio: bio.clone(),
        avatar_url: None,
        banner_url: None,
        identity_host_url: None,
        created_at: created_at.clone(),
        avatar_mtime: None,
        banner_mtime: None,
    };

    let base = get_base_path(&app)?;
    let persona_dir = base.join(&id);
    std::fs::create_dir_all(&persona_dir).map_err(|e| e.to_string())?;

    // When replacing an existing persona, clear avatar and banner so old assets don't persist
    if persona_dir.exists() {
        remove_asset_files(&persona_dir, "avatar");
        remove_asset_files(&persona_dir, "banner");
    }

    std::fs::write(
        persona_dir.join("profile.json"),
        serde_json::to_string(&persona).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    std::fs::write(persona_dir.join("identity.sigil"), &sigil_json).map_err(|e| e.to_string())?;

    Ok(resolve_persona_asset_paths(&persona_dir, persona))
}

/// Normalizes paths from the file picker. On iOS, the dialog may return file:// URLs.
/// Detects file:// URIs, parses them via Url::parse, and converts to PathBuf via to_file_path().
/// Falls back to percent-decoding the remainder if parsing fails, so returned PathBufs are valid for canonicalize/open.
fn normalize_picker_path(s: &str) -> PathBuf {
    let s = s.trim();
    if s.starts_with("file://") {
        if let Ok(url) = url::Url::parse(s) {
            if let Ok(path) = url.to_file_path() {
                return path;
            }
        }
        let remainder = s.trim_start_matches("file://");
        let decoded = percent_encoding::percent_decode_str(remainder).decode_utf8_lossy();
        return PathBuf::from(decoded.as_ref());
    }
    let decoded = percent_encoding::percent_decode_str(s).decode_utf8_lossy();
    PathBuf::from(decoded.as_ref())
}

fn validate_persona_bundle_path(app: &tauri::AppHandle, path: &str) -> Result<PathBuf, String> {
    let path_buf = normalize_picker_path(path);
    let canonical = path_buf
        .canonicalize()
        .map_err(|e| format!("Path not found or invalid: {}", e))?;

    if !canonical.metadata().map_err(|e| e.to_string())?.is_file() {
        return Err("Path is not a regular file".to_string());
    }

    // Accept .persona extension or validate by content (handles renamed files, filenames with spaces)
    if let Some(ext) = canonical.extension().and_then(|e| e.to_str()) {
        if !ext.eq_ignore_ascii_case("persona") && !ext.eq_ignore_ascii_case("zip") {
            return Err("File must be a .persona bundle or .zip archive".to_string());
        }
    }

    let app_data = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let config_dir = app.path().config_dir().map_err(|e| e.to_string())?;
    let personas_base = get_base_path(app)?;

    let mut allowed_roots: Vec<PathBuf> = vec![app_data, config_dir, personas_base];
    // iOS: dialog Copy mode may put files in tmp or cache
    if let Ok(tmp) = app.path().temp_dir() {
        allowed_roots.push(tmp);
    }
    if let Ok(cache) = app.path().cache_dir() {
        allowed_roots.push(cache);
    }
    if let Some(doc) = dirs::document_dir() {
        allowed_roots.push(doc);
    }
    // iOS: dirs::document_dir() is None; use Tauri's document_dir for app Documents
    if let Ok(doc) = app.path().document_dir() {
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

    Ok(canonical)
}

/// Opens a persona bundle file. On Android uses content URIs via android-fs; on desktop uses path validation.
fn open_persona_bundle_file(app: &tauri::AppHandle, path: &str) -> Result<File, String> {
    #[cfg(target_os = "android")]
    {
        let file_path = convert_string_to_file_path(path);
        app.android_fs()
            .open_file(&file_path)
            .map_err(|e| format!("Path not found or invalid: {}", e))
    }

    #[cfg(not(target_os = "android"))]
    {
        let path_buf = validate_persona_bundle_path(app, path)?;
        File::open(&path_buf).map_err(|e| e.to_string())
    }
}

#[tauri::command]
pub fn import_persona_from_bundle_cmd(
    app: tauri::AppHandle,
    path: String,
    replace_if_exists: bool,
) -> Result<Persona, String> {
    let file = open_persona_bundle_file(&app, &path)?;
    let mut archive = zip::ZipArchive::new(file).map_err(|e| format!("Invalid zip: {}", e))?;

    let mut persona_id: Option<String> = None;
    let mut has_sigil = false;
    let mut has_profile = false;
    let mut entries_to_extract: Vec<(String, Vec<u8>)> = Vec::new();
    let mut cumulative_total_bytes: usize = 0;

    for i in 0..archive.len() {
        let entry = archive.by_index(i).map_err(|e| e.to_string())?;

        let enclosed = entry
            .enclosed_name()
            .ok_or("Invalid persona bundle: path traversal detected")?;

        let comps: Vec<_> = enclosed.components().collect();
        if comps.iter().any(|c| !matches!(c, Component::Normal(_))) {
            return Err("Invalid persona bundle: path traversal detected".to_string());
        }
        if comps.is_empty() {
            continue;
        }
        let first = comps[0].as_os_str().to_string_lossy().into_owned();
        if persona_id.is_none() {
            persona_id = Some(first.clone());
        }
        let pid = persona_id.as_ref().unwrap();
        if first != *pid {
            return Err("Invalid persona bundle: inconsistent folder structure".to_string());
        }
        if comps.len() < 2 {
            continue;
        }
        let suffix_path: PathBuf = comps[1..].iter().fold(PathBuf::new(), |mut p, c| {
            p.push(c.as_os_str());
            p
        });
        let suffix = suffix_path.to_string_lossy().into_owned();
        if suffix == "identity.sigil" {
            has_sigil = true;
        } else if suffix == "profile.json" {
            has_profile = true;
        }

        if entry.is_file() {
            let mut buf = Vec::with_capacity((MAX_ENTRY_BYTES + 1).min(4096));
            entry
                .take((MAX_ENTRY_BYTES + 1) as u64)
                .read_to_end(&mut buf)
                .map_err(|e| e.to_string())?;
            if buf.len() > MAX_ENTRY_BYTES {
                return Err("Archive entry exceeds maximum size".to_string());
            }
            if cumulative_total_bytes + buf.len() > MAX_ARCHIVE_BYTES {
                return Err("Archive exceeds maximum size".to_string());
            }
            cumulative_total_bytes += buf.len();
            entries_to_extract.push((suffix, buf));
        }
    }

    let persona_id = persona_id.ok_or("Persona bundle is empty".to_string())?;
    validate_persona_id(&persona_id)?;

    if !has_sigil {
        return Err("Persona bundle must contain identity.sigil".to_string());
    }
    if !has_profile {
        return Err("Persona bundle must contain profile.json".to_string());
    }

    let base = get_base_path(&app)?;
    let persona_dir = base.join(&persona_id);
    let staging_dir = base.join(format!("{}.tmp", persona_id));
    let profile_path = staging_dir.join("profile.json");

    // Match persona_exists_cmd: persona "exists" only when dir + profile.json present.
    let persona_exists = persona_dir.exists() && persona_dir.join("profile.json").exists();

    if persona_exists && !replace_if_exists {
        return Err("Persona already exists".to_string());
    }

    // Extract to staging dir first; validate before replacing existing persona.
    if staging_dir.exists() {
        std::fs::remove_dir_all(&staging_dir).map_err(|e| e.to_string())?;
    }
    std::fs::create_dir_all(&staging_dir).map_err(|e| e.to_string())?;

    for (suffix, data) in entries_to_extract {
        let dest = staging_dir.join(&suffix);
        if !dest.starts_with(&staging_dir) {
            let _ = std::fs::remove_dir_all(&staging_dir);
            return Err("Invalid persona bundle: path escape detected".to_string());
        }
        if let Some(parent) = dest.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        std::fs::write(&dest, data).map_err(|e| e.to_string())?;
    }

    let content = std::fs::read_to_string(&profile_path).map_err(|e| {
        let _ = std::fs::remove_dir_all(&staging_dir);
        format!("Invalid profile: {}", e)
    })?;
    let persona: Persona = serde_json::from_str(&content).map_err(|e| {
        let _ = std::fs::remove_dir_all(&staging_dir);
        format!("Invalid profile: {}", e)
    })?;

    let backup_dir = base.join(format!("{}.old", persona_id));
    if persona_dir.exists() {
        if backup_dir.exists() {
            std::fs::remove_dir_all(&backup_dir).map_err(|e| e.to_string())?;
        }
        std::fs::rename(&persona_dir, &backup_dir).map_err(|e| e.to_string())?;
    }
    if let Err(e) = std::fs::rename(&staging_dir, &persona_dir) {
        if backup_dir.exists() {
            let _ = std::fs::rename(&backup_dir, &persona_dir);
        }
        return Err(e.to_string());
    }
    if backup_dir.exists() {
        std::fs::remove_dir_all(&backup_dir).map_err(|e| e.to_string())?;
    }

    Ok(resolve_persona_asset_paths(&persona_dir, persona))
}

#[tauri::command]
pub fn update_persona_profile_cmd(
    app: tauri::AppHandle,
    persona_id: String,
    display_name: Option<String>,
    bio: Option<String>,
    avatar_url: Option<String>,
    banner_url: Option<String>,
    identity_host_url: Option<String>,
) -> Result<Persona, String> {
    validate_persona_id(&persona_id)?;
    let base = get_base_path(&app)?;
    let profile_path = base.join(&persona_id).join("profile.json");
    if !profile_path.exists() {
        return Err("Persona not found".to_string());
    }
    let content = std::fs::read_to_string(&profile_path).map_err(|e| e.to_string())?;
    let mut persona: Persona = serde_json::from_str(&content).map_err(|e| e.to_string())?;

    if let Some(n) = display_name {
        persona.display_name = n;
    }
    if let Some(b) = bio {
        persona.bio = Some(b);
    }
    if let Some(a) = avatar_url {
        persona.avatar_url = Some(a);
    }
    if let Some(b) = banner_url {
        persona.banner_url = Some(b);
    }
    if let Some(h) = identity_host_url {
        let t = h.trim();
        if t.is_empty() {
            persona.identity_host_url = None;
        } else {
            validate_identity_host_url(t)?;
            persona.identity_host_url = Some(t.to_string());
        }
    }

    let updated = serde_json::to_string_pretty(&persona).map_err(|e| e.to_string())?;
    std::fs::write(&profile_path, updated).map_err(|e| e.to_string())?;

    let persona_dir = base.join(&persona_id);
    Ok(resolve_persona_asset_paths(&persona_dir, persona))
}

fn remove_asset_files(persona_dir: &Path, prefix: &str) {
    for ext in IMAGE_EXTENSIONS {
        let p = persona_dir.join(format!("{}.{}", prefix, ext));
        let _ = std::fs::remove_file(&p);
    }
}

#[tauri::command]
pub fn save_persona_avatar_cmd(
    app: tauri::AppHandle,
    persona_id: String,
    source_path: String,
) -> Result<Persona, String> {
    validate_persona_id(&persona_id)?;
    let base = get_base_path(&app)?;
    let persona_dir = base.join(&persona_id);
    if !persona_dir.exists() {
        return Err("Persona not found".to_string());
    }
    let ext = extension_from_path_or_uri(&source_path);
    let filename = format!("avatar.{}", ext);
    let relative_url = format!("./{}", filename);

    remove_asset_files(&persona_dir, "avatar");
    let dest = persona_dir.join(&filename);
    copy_image_from_source(&app, &source_path, &dest)?;

    let profile_path = persona_dir.join("profile.json");
    let content = std::fs::read_to_string(&profile_path).map_err(|e| e.to_string())?;
    let mut persona: Persona = serde_json::from_str(&content).map_err(|e| e.to_string())?;
    persona.avatar_url = Some(relative_url);
    let updated = serde_json::to_string_pretty(&persona).map_err(|e| e.to_string())?;
    std::fs::write(&profile_path, updated).map_err(|e| e.to_string())?;
    Ok(resolve_persona_asset_paths(&persona_dir, persona))
}

#[tauri::command]
pub fn save_persona_banner_cmd(
    app: tauri::AppHandle,
    persona_id: String,
    source_path: String,
) -> Result<Persona, String> {
    validate_persona_id(&persona_id)?;
    let base = get_base_path(&app)?;
    let persona_dir = base.join(&persona_id);
    if !persona_dir.exists() {
        return Err("Persona not found".to_string());
    }
    let ext = extension_from_path_or_uri(&source_path);
    let filename = format!("banner.{}", ext);
    let relative_url = format!("./{}", filename);

    remove_asset_files(&persona_dir, "banner");
    let dest = persona_dir.join(&filename);
    copy_image_from_source(&app, &source_path, &dest)?;

    let profile_path = persona_dir.join("profile.json");
    let content = std::fs::read_to_string(&profile_path).map_err(|e| e.to_string())?;
    let mut persona: Persona = serde_json::from_str(&content).map_err(|e| e.to_string())?;
    persona.banner_url = Some(relative_url);
    let updated = serde_json::to_string_pretty(&persona).map_err(|e| e.to_string())?;
    std::fs::write(&profile_path, updated).map_err(|e| e.to_string())?;
    Ok(resolve_persona_asset_paths(&persona_dir, persona))
}

/// Short suffix for filenames from DID (last 8 chars of multibase id).
/// Sanitizes to [A-Za-z0-9_-] to avoid path separators and invalid fs chars.
fn did_short_for_filename(did: &str) -> String {
    let raw: String = did
        .trim_start_matches("did:syr:")
        .chars()
        .rev()
        .take(8)
        .collect::<String>()
        .chars()
        .rev()
        .collect();
    raw.chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '_' || *c == '-')
        .take(8)
        .collect()
}

/// Encrypted Sigil JSON only (for browser signing handoff — no plaintext keys on the wire).
#[tauri::command]
pub fn read_persona_encrypted_sigil_json_cmd(
    app: tauri::AppHandle,
    persona_id: String,
) -> Result<String, String> {
    validate_persona_id(&persona_id)?;
    let base = get_base_path(&app)?;
    let sigil_path = base.join(&persona_id).join("identity.sigil");
    if !sigil_path.exists() {
        return Err("This persona has no encrypted Sigil file.".to_string());
    }
    std::fs::read_to_string(&sigil_path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn export_persona_as_file_cmd(
    app: tauri::AppHandle,
    persona_id: String,
    format: String,
) -> Result<String, String> {
    validate_persona_id(&persona_id)?;
    let base = get_base_path(&app)?;
    let persona_dir = base.join(&persona_id);
    if !persona_dir.exists() {
        return Err("Persona not found".to_string());
    }
    let profile_path = persona_dir.join("profile.json");
    let sigil_path = persona_dir.join("identity.sigil");
    if !profile_path.exists() || !sigil_path.exists() {
        return Err("Persona data incomplete".to_string());
    }
    let content = std::fs::read_to_string(&profile_path).map_err(|e| e.to_string())?;
    let persona: Persona = serde_json::from_str(&content).map_err(|e| e.to_string())?;
    let did_short = did_short_for_filename(&persona.did);
    let timestamp = chrono::Utc::now().format("%Y%m%d-%H%M%S").to_string();

    let (_ext, default_name) = match format.as_str() {
        "sigil" => (
            "sigil",
            format!("syr-sigil-{}-{}.sigil", did_short, timestamp),
        ),
        "persona" => (
            "persona",
            format!("syr-persona-{}-{}.persona", did_short, timestamp),
        ),
        other => {
            return Err(format!(
                "Unknown export format: {:?}. Expected \"sigil\" or \"persona\".",
                other
            ));
        }
    };

    let dest_path: PathBuf = {
        #[cfg(target_os = "ios")]
        {
            let doc_dir = app.path().document_dir().map_err(|e| e.to_string())?;
            let mut dest_path = doc_dir.join(&default_name);
            let mut n = 2u32;
            while dest_path.exists() {
                let stem = dest_path
                    .file_stem()
                    .and_then(|s| s.to_str())
                    .unwrap_or("export");
                let ext = dest_path.extension().and_then(|e| e.to_str()).unwrap_or("");
                let new_name = if ext.is_empty() {
                    format!("{}-{}", stem, n)
                } else {
                    format!("{}-{}.{}", stem, n, ext)
                };
                dest_path = doc_dir.join(new_name);
                n += 1;
            }
            dest_path
        }

        #[cfg(not(target_os = "ios"))]
        {
            let (filter_name, filter_exts): (&str, &[&str]) = if format == "sigil" {
                ("Sigil files", &["sigil"])
            } else {
                ("Persona files", &["persona"])
            };
            let path = app
                .dialog()
                .file()
                .set_file_name(&default_name)
                .add_filter(filter_name, filter_exts)
                .blocking_save_file();
            let fp = path.ok_or("Save cancelled".to_string())?;
            fp.into_path().map_err(|e| e.to_string())?
        }
    };

    if format == "sigil" {
        let sigil_content = std::fs::read_to_string(&sigil_path).map_err(|e| e.to_string())?;
        std::fs::write(&dest_path, sigil_content).map_err(|e| e.to_string())?;
    } else {
        let file = File::create(&dest_path).map_err(|e| e.to_string())?;
        let mut zip = ZipWriter::new(file);
        let opts =
            SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
        let prefix = format!("{}/", persona_id);

        let mut files_to_add: Vec<(String, PathBuf)> = vec![
            ("profile.json".into(), persona_dir.join("profile.json")),
            ("identity.sigil".into(), persona_dir.join("identity.sigil")),
        ];
        for ext in IMAGE_EXTENSIONS {
            for (name, path) in [
                ("avatar", persona_dir.join(format!("avatar.{}", ext))),
                ("banner", persona_dir.join(format!("banner.{}", ext))),
            ] {
                if path.exists() {
                    files_to_add.push((format!("{}.{}", name, ext), path));
                }
            }
        }

        for (arc_name, src_path) in files_to_add {
            if !src_path.exists() {
                continue;
            }
            let data = std::fs::read(&src_path).map_err(|e| e.to_string())?;
            if data.len() > MAX_ENTRY_BYTES {
                return Err(format!("File {} exceeds maximum size", arc_name));
            }
            let entry_name = format!("{}{}", prefix, arc_name);
            zip.start_file(entry_name, opts)
                .map_err(|e| format!("ZIP error: {}", e))?;
            zip.write_all(&data).map_err(|e| e.to_string())?;
        }

        zip.finish().map_err(|e| e.to_string())?;
    }

    Ok(dest_path.to_string_lossy().to_string())
}

#[tauri::command]
pub fn delete_persona_cmd(app: tauri::AppHandle, persona_id: String) -> Result<(), String> {
    validate_persona_id(&persona_id)?;
    let base = get_base_path(&app)?;
    let persona_dir = base.join(&persona_id);
    if !persona_dir.exists() {
        return Err("Persona not found".to_string());
    }
    std::fs::remove_dir_all(&persona_dir).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn read_file_as_base64_cmd(
    _app: tauri::AppHandle,
    source_path: String,
) -> Result<Option<(String, String)>, String> {
    const MAX_ASSET_SIZE: usize = 5 * 1024 * 1024; // 5 MB
    let bytes = {
        #[cfg(target_os = "android")]
        {
            let file_path = convert_string_to_file_path(&source_path);
            let mut file = _app
                .android_fs()
                .open_file(&file_path)
                .map_err(|e| format!("Path not found or invalid: {}", e))?;
            let mut buf = Vec::new();
            let mut chunk = [0u8; 64 * 1024]; // 64 KB
            loop {
                let n = std::io::Read::read(&mut file, &mut chunk).map_err(|e| e.to_string())?;
                if n == 0 {
                    break;
                }
                buf.extend_from_slice(&chunk[..n]);
                if buf.len() > MAX_ASSET_SIZE {
                    return Err(format!(
                        "File exceeds maximum size of {} bytes",
                        MAX_ASSET_SIZE
                    ));
                }
            }
            buf
        }

        #[cfg(not(target_os = "android"))]
        {
            // iOS: dialog may return file:// URLs
            let path_buf = normalize_picker_path(&source_path);
            let mut file = std::fs::File::open(&path_buf).map_err(|e| e.to_string())?;
            let meta = file.metadata().map_err(|e| e.to_string())?;
            if meta.len() > MAX_ASSET_SIZE as u64 {
                return Err(format!(
                    "File exceeds maximum size of {} bytes",
                    MAX_ASSET_SIZE
                ));
            }
            let mut buf = Vec::new();
            let n = std::io::Read::take(&mut file, MAX_ASSET_SIZE as u64 + 1)
                .read_to_end(&mut buf)
                .map_err(|e| e.to_string())?;
            if n > MAX_ASSET_SIZE {
                return Err(format!(
                    "File exceeds maximum size of {} bytes",
                    MAX_ASSET_SIZE
                ));
            }
            buf
        }
    };
    let ext = extension_from_path_or_uri(&source_path);
    let mime = match ext.as_str() {
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        _ => "image/png",
    };
    use base64::Engine;
    let base64_str = base64::engine::general_purpose::STANDARD.encode(&bytes);
    Ok(Some((base64_str, mime.to_string())))
}

#[tauri::command]
pub fn read_persona_asset_cmd(
    app: tauri::AppHandle,
    persona_id: String,
    role: String,
) -> Result<Option<(String, String)>, String> {
    if role != "avatar" && role != "banner" {
        return Err("role must be 'avatar' or 'banner'".to_string());
    }
    validate_persona_id(&persona_id)?;
    let base = get_base_path(&app)?;
    let persona_dir = base.join(&persona_id);
    if !persona_dir.exists() {
        return Err("Persona not found".to_string());
    }
    let profile_path = persona_dir.join("profile.json");
    let content = std::fs::read_to_string(&profile_path).map_err(|e| e.to_string())?;
    let persona: Persona = serde_json::from_str(&content).map_err(|e| e.to_string())?;
    let resolved = resolve_persona_asset_paths(&persona_dir, persona);
    let path = if role == "avatar" {
        resolved.avatar_url
    } else {
        resolved.banner_url
    };
    let path = match path {
        Some(p) => std::path::PathBuf::from(p),
        None => return Ok(None),
    };
    // Prevent path traversal: canonicalize and ensure path stays inside persona_dir
    let canonical_persona_dir =
        std::fs::canonicalize(&persona_dir).map_err(|e| format!("Invalid persona dir: {}", e))?;
    let canonical_path =
        std::fs::canonicalize(&path).map_err(|e| format!("Invalid asset path: {}", e))?;
    if !canonical_path.starts_with(&canonical_persona_dir) {
        return Ok(None);
    }
    const MAX_ASSET_SIZE: u64 = 5 * 1024 * 1024; // 5 MB
    let meta = std::fs::metadata(&canonical_path)
        .map_err(|e| format!("Failed to read asset metadata: {}", e))?;
    if meta.len() > MAX_ASSET_SIZE {
        return Err(format!(
            "Asset exceeds maximum size of {} bytes",
            MAX_ASSET_SIZE
        ));
    }
    // Persona assets are always in app dir (filesystem path), not content URIs
    let bytes =
        std::fs::read(&canonical_path).map_err(|e| format!("Failed to read asset: {}", e))?;
    use base64::Engine;
    let base64_str = base64::engine::general_purpose::STANDARD.encode(&bytes);
    let ext = extension_from_path_or_uri(&canonical_path.to_string_lossy());
    let mime = match ext.as_str() {
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        _ => "image/png",
    };
    Ok(Some((base64_str, mime.to_string())))
}

#[tauri::command]
pub async fn decrypt_persona_sigil_cmd(
    app: tauri::AppHandle,
    persona_id: String,
    passphrase: String,
) -> Result<Vec<u8>, String> {
    validate_persona_id(&persona_id)?;
    let base = get_base_path(&app)?;
    let sigil_path = base.join(&persona_id).join("identity.sigil");
    if !sigil_path.exists() {
        return Err("Persona not found".to_string());
    }
    let path = sigil_path.clone();
    let pass = passphrase.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let content = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
        let obj: SigilObject = serde_json::from_str(&content).map_err(|e| e.to_string())?;
        let seed = decrypt_sigil(&obj, &pass)?;
        Ok(seed.as_ref().to_vec())
    })
    .await
    .map_err(|e| e.to_string())
    .and_then(std::convert::identity)
}
