mod crypto_commands;

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            greet,
            crypto_commands::generate_root_keypair_cmd,
            crypto_commands::generate_device_keypair_cmd,
            crypto_commands::sign_payload,
            crypto_commands::verify_signature,
            crypto_commands::create_sigil_cmd,
            crypto_commands::decrypt_sigil_cmd,
            crypto_commands::create_aegis_bundle_cmd,
            crypto_commands::decrypt_aegis_bundle_cmd,
            crypto_commands::derive_did_cmd,
            crypto_commands::parse_did_cmd,
            crypto_commands::build_did_document_cmd,
            crypto_commands::is_valid_syr_did_cmd,
            crypto_commands::canonicalize_cmd,
            crypto_commands::create_rotation_statement_cmd,
            crypto_commands::verify_rotation_statement_cmd,
            crypto_commands::encode_multibase_cmd,
            crypto_commands::decode_multibase_cmd,
            crypto_commands::decode_public_key_cmd,
            crypto_commands::decode_private_key_cmd,
            crypto_commands::encode_private_key_cmd,
            crypto_commands::constant_time_equal_cmd,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
