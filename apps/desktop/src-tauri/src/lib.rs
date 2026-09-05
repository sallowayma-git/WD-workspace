//! Tauri hosts the local SQLite database. Domain behavior remains in the shared web layer.

use tauri_plugin_sql::{Migration, MigrationKind};

mod local_database;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let migrations = vec![
        Migration {
            version: 1,
            description: "create local assistant core schema",
            sql: include_str!("../migrations/0001_local_core.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 2,
            description: "sequence long task schema",
            sql: include_str!("../migrations/0002_sequence_long_task.sql"),
            kind: MigrationKind::Up,
        },
    ];

    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            local_database::execute_local_transaction
        ])
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:assistant.db", migrations)
                .build(),
        )
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
