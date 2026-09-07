//! Tauri hosts the local SQLite database. Domain behavior remains in the shared web layer.

mod local_database;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            local_database::select_local_rows,
            local_database::execute_local_transaction,
            local_database::export_local_database
        ])
        .setup(|app| {
            local_database::initialize(app)?;
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
