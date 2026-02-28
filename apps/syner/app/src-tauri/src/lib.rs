mod crypto_commands;
mod persona_commands;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            crypto_commands::sign_payload,
            crypto_commands::decrypt_sigil_cmd,
            crypto_commands::derive_public_key_from_seed_cmd,
            crypto_commands::derive_did_cmd,
            crypto_commands::canonicalize_cmd,
            crypto_commands::encode_multibase_cmd,
            crypto_commands::read_file_content_cmd,
            persona_commands::get_personas_base_path_cmd,
            persona_commands::set_personas_base_path_cmd,
            persona_commands::persona_id_from_public_key_cmd,
            persona_commands::persona_exists_cmd,
            persona_commands::list_personas_cmd,
            persona_commands::create_persona_cmd,
            persona_commands::import_persona_from_sigil_cmd,
            persona_commands::import_persona_from_bundle_cmd,
            persona_commands::update_persona_profile_cmd,
            persona_commands::delete_persona_cmd,
            persona_commands::decrypt_persona_sigil_cmd,
            persona_commands::save_persona_avatar_cmd,
            persona_commands::save_persona_banner_cmd,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
