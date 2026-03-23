mod crypto_commands;
mod persona_commands;

#[tauri::command]
fn get_platform_cmd() -> &'static str {
    std::env::consts::OS
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = {
        let b = tauri::Builder::default()
            .plugin(
                tauri_plugin_log::Builder::default()
                    .clear_targets()
                    .target(tauri_plugin_log::Target::new(
                        tauri_plugin_log::TargetKind::Stdout,
                    ))
                    .target(tauri_plugin_log::Target::new(
                        tauri_plugin_log::TargetKind::LogDir {
                            file_name: Some("syner.log".to_string()),
                        },
                    ))
                    .level(log::LevelFilter::Info)
                    .build(),
            )
            .plugin(tauri_plugin_fs::init())
            .plugin(tauri_plugin_dialog::init())
            .plugin(tauri_plugin_opener::init())
            .plugin(tauri_plugin_deep_link::init())
            .plugin(tauri_plugin_http::init());
        #[cfg(target_os = "android")]
        let b = b.plugin(tauri_plugin_android_fs::init());
        b
    };

    builder
        .setup(|_app| {
            #[cfg(mobile)]
            {
                _app.handle().plugin(tauri_plugin_barcode_scanner::init())?;
            }
            #[cfg(any(windows, target_os = "linux"))]
            {
                use tauri_plugin_deep_link::DeepLinkExt;
                _app.deep_link().register_all()?;
            }
            Ok::<(), Box<dyn std::error::Error>>(())
        })
        .invoke_handler(tauri::generate_handler![
            get_platform_cmd,
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
            persona_commands::export_persona_as_file_cmd,
            persona_commands::read_file_as_base64_cmd,
            persona_commands::read_persona_asset_cmd,
            persona_commands::read_persona_encrypted_sigil_json_cmd,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
