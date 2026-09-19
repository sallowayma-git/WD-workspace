//! 前端唯一的 SQLite 入口：读写都 invoke 到这里，共用一个池、一套 PRAGMA。

use serde::Deserialize;
use serde_json::{Map, Value};
use sqlx::{
    migrate::{Migration, MigrationType, Migrator},
    sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions, SqliteValueRef},
    Column, Row, SqlitePool, TypeInfo, Value as _, ValueRef,
};
use std::borrow::Cow;
use std::fs::{self, OpenOptions};
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{App, AppHandle, Manager, State};

const DATABASE_FILENAME: &str = "assistant.db";

pub struct LocalDatabase {
    pool: SqlitePool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalSqlStatement {
    sql: String,
    #[serde(default)]
    values: Vec<Value>,
    expected_rows_affected: Option<u64>,
}

/// SQLite schema changes use SQLx's normal migration ledger.
fn migrator() -> Migrator {
    let migrations = vec![
        migration(
            1,
            "local core",
            include_str!("../migrations/0001_local_core.sql"),
        ),
        migration(
            2,
            "sequence long task",
            include_str!("../migrations/0002_sequence_long_task.sql"),
        ),
        migration(
            3,
            "sequence invariants",
            include_str!("../migrations/0003_sequence_invariants.sql"),
        ),
        migration(
            4,
            "customer feedback round 1",
            include_str!("../migrations/0004_customer_feedback_round1.sql"),
        ),
    ];
    Migrator {
        migrations: Cow::Owned(migrations),
        ignore_missing: false,
        locking: true,
        no_tx: false,
    }
}

fn migration(version: i64, description: &'static str, sql: &'static str) -> Migration {
    Migration::new(
        version,
        Cow::Borrowed(description),
        MigrationType::Simple,
        Cow::Owned(sql.replace("\r\n", "\n")),
        false,
    )
}

pub fn initialize(app: &App) -> Result<(), Box<dyn std::error::Error>> {
    let app_dir = app.path().app_config_dir()?;
    fs::create_dir_all(&app_dir)?;
    let options = SqliteConnectOptions::new()
        .filename(app_dir.join(DATABASE_FILENAME))
        .create_if_missing(true)
        .foreign_keys(true)
        .journal_mode(SqliteJournalMode::Wal);
    // 单连接：单人桌面端的查询都是亚毫秒级，换来的是写入永远撞不上 SQLITE_BUSY。
    let pool = tauri::async_runtime::block_on(async {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(options)
            .await?;
        migrator().run(&pool).await?;
        Ok::<_, Box<dyn std::error::Error>>(pool)
    })?;
    app.manage(LocalDatabase { pool });
    Ok(())
}

#[tauri::command]
pub async fn export_local_database(
    app: AppHandle,
    database: State<'_, LocalDatabase>,
) -> Result<String, String> {
    let directory = app
        .path()
        .document_dir()
        .map_err(|error| error.to_string())?
        .join("AssistantExports");
    fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| error.to_string())?
        .as_nanos();
    let target = directory.join(format!("assistant-{timestamp}.db"));
    export_database(&database.pool, &target).await?;
    Ok(target.to_string_lossy().into_owned())
}

async fn export_database(pool: &SqlitePool, target: &Path) -> Result<(), String> {
    OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(target)
        .map_err(|error| error.to_string())?;
    // VACUUM INTO includes committed WAL content in a standalone SQLite file.
    let result = sqlx::query("VACUUM INTO $1")
        .bind(target.to_string_lossy().as_ref())
        .execute(pool)
        .await
        .map_err(|error| error.to_string());
    if let Err(error) = result {
        let _ = fs::remove_file(target);
        return Err(error);
    }
    OpenOptions::new()
        .read(true)
        .write(true)
        .open(target)
        .and_then(|file| file.sync_all())
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn select_local_rows(
    database: State<'_, LocalDatabase>,
    sql: String,
    values: Vec<Value>,
) -> Result<Vec<Map<String, Value>>, String> {
    let mut query = sqlx::query(&sql);
    for value in &values {
        query = bind(query, value);
    }
    let rows = query
        .fetch_all(&database.pool)
        .await
        .map_err(|error| error.to_string())?;
    rows.iter().map(row_to_json).collect()
}

fn row_to_json(row: &sqlx::sqlite::SqliteRow) -> Result<Map<String, Value>, String> {
    row.columns()
        .iter()
        .map(|column| {
            let raw = row
                .try_get_raw(column.ordinal())
                .map_err(|error| error.to_string())?;
            Ok((column.name().to_owned(), decode(raw)?))
        })
        .collect()
}

/// 列类型按 SQLite 的存储类走。整数保持 i64——绑成 f64 会让 LIMIT 之类的参数变味。
fn decode(value: SqliteValueRef<'_>) -> Result<Value, String> {
    if value.is_null() {
        return Ok(Value::Null);
    }
    let type_name = value.type_info().name().to_owned();
    let owned = value.to_owned();
    let decoded = match type_name.as_str() {
        "TEXT" => owned.try_decode::<String>().map(Value::String),
        "REAL" => owned.try_decode::<f64>().map(Value::from),
        "INTEGER" | "NUMERIC" | "BOOLEAN" => owned.try_decode::<i64>().map(Value::from),
        "BLOB" => owned.try_decode::<Vec<u8>>().map(Value::from),
        other => return Err(format!("不支持的列类型 {other}")),
    };
    decoded.map_err(|error| error.to_string())
}

fn bind<'q>(
    query: sqlx::query::Query<'q, sqlx::Sqlite, sqlx::sqlite::SqliteArguments<'q>>,
    value: &Value,
) -> sqlx::query::Query<'q, sqlx::Sqlite, sqlx::sqlite::SqliteArguments<'q>> {
    match value {
        Value::Null => query.bind(Option::<String>::None),
        Value::Bool(value) => query.bind(if *value { 1_i64 } else { 0_i64 }),
        Value::Number(value) => {
            if let Some(value) = value.as_i64() {
                query.bind(value)
            } else {
                query.bind(value.as_f64().unwrap_or_default())
            }
        }
        Value::String(value) => query.bind(value.clone()),
        Value::Array(_) | Value::Object(_) => query.bind(value.to_string()),
    }
}

#[tauri::command]
pub async fn execute_local_transaction(
    database: State<'_, LocalDatabase>,
    statements: Vec<LocalSqlStatement>,
) -> Result<Vec<u64>, String> {
    execute_transaction(&database.pool, &statements)
        .await
        .map_err(|error| error.to_string())
}

async fn execute_transaction(
    pool: &SqlitePool,
    statements: &[LocalSqlStatement],
) -> Result<Vec<u64>, sqlx::Error> {
    let mut transaction = pool.begin().await?;
    let mut rows_affected = Vec::with_capacity(statements.len());

    for statement in statements {
        let mut query = sqlx::query(&statement.sql);
        for value in &statement.values {
            query = bind(query, value);
        }
        let result = query.execute(&mut *transaction).await?;
        if let Some(expected) = statement.expected_rows_affected {
            if result.rows_affected() != expected {
                return Err(sqlx::Error::Protocol(format!(
                    "expected {expected} affected rows, got {}",
                    result.rows_affected()
                )));
            }
        }
        rows_affected.push(result.rows_affected());
    }

    transaction.commit().await?;
    Ok(rows_affected)
}

#[cfg(test)]
mod tests {
    use super::{decode, execute_transaction, LocalSqlStatement};
    use serde_json::{json, Value};
    use sqlx::migrate::Migrator;
    use sqlx::{
        sqlite::{SqliteConnectOptions, SqlitePoolOptions},
        Column, Connection, Row, SqliteConnection, SqlitePool,
    };
    use std::borrow::Cow;

    async fn memory_pool() -> SqlitePool {
        SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(
                SqliteConnectOptions::new()
                    .filename(":memory:")
                    .foreign_keys(true),
            )
            .await
            .expect("open memory database")
    }

    /// 读路径的等价物：命令本身要 State，测不了，所以直接测取值与解码。
    async fn select(pool: &SqlitePool, sql: &str, values: Vec<Value>) -> Vec<Value> {
        let mut query = sqlx::query(sql);
        for value in &values {
            query = super::bind(query, value);
        }
        let rows = query.fetch_all(pool).await.expect("fetch rows");
        rows.iter()
            .map(|row| {
                Value::Object(
                    row.columns()
                        .iter()
                        .map(|column| {
                            let raw = row.try_get_raw(column.ordinal()).expect("raw value");
                            (column.name().to_owned(), decode(raw).expect("decode"))
                        })
                        .collect(),
                )
            })
            .collect()
    }

    #[test]
    fn reads_keep_sqlite_storage_classes_and_bind_integers_as_integers() {
        tauri::async_runtime::block_on(async {
            let pool = memory_pool().await;
            sqlx::query("CREATE TABLE sample (id TEXT PRIMARY KEY, ordinal INTEGER, note TEXT)")
                .execute(&pool)
                .await
                .expect("create sample table");
            sqlx::query("INSERT INTO sample VALUES ('a', 7, NULL), ('b', 8, 'kept')")
                .execute(&pool)
                .await
                .expect("seed sample rows");

            // NULL 保持 null、INTEGER 保持整数（绑成 f64 会让 ordinal 变 7.0）。
            let rows = select(
                &pool,
                "SELECT id, ordinal, note FROM sample WHERE ordinal = $1",
                vec![json!(7)],
            )
            .await;
            assert_eq!(rows, vec![json!({"id": "a", "ordinal": 7, "note": null})]);

            // LIMIT 只接受整数参数，绑成浮点会直接报错。
            let rows = select(&pool, "SELECT id FROM sample LIMIT $1", vec![json!(1)]).await;
            assert_eq!(rows, vec![json!({"id": "a"})]);

            let rows = select(&pool, "SELECT COUNT(*) AS count FROM sample", vec![]).await;
            assert_eq!(rows, vec![json!({"count": 2})]);
        });
    }

    #[test]
    fn migration_checksums_do_not_depend_on_line_endings() {
        let lf = super::migration(1, "sample", "SELECT 1;\n");
        let crlf = super::migration(1, "sample", "SELECT 1;\r\n");
        assert_eq!(lf.checksum, crlf.checksum);
    }

    #[test]
    fn upgrades_v1_track_tasks_without_nulling_their_track() {
        tauri::async_runtime::block_on(async {
            let pool = memory_pool().await;
            let v1 = Migrator {
                migrations: Cow::Owned(vec![super::migration(
                    1,
                    "local core",
                    include_str!("../migrations/0001_local_core.sql"),
                )]),
                ignore_missing: false,
                locking: true,
                no_tx: false,
            };
            v1.run(&pool).await.expect("apply v1");

            for sql in [
                "INSERT INTO student(id, student_code, name) VALUES ('student-1', 'S1', 'Student')",
                "INSERT INTO task_template(id, template_code, name, subject_code, status) VALUES ('template-1', 'T1', 'Template', 'EN', 'ACTIVE')",
                "INSERT INTO task_template_version(id, template_id, version_number, status, item_count) VALUES ('version-1', 'template-1', 1, 'PUBLISHED', 1)",
                "INSERT INTO task_template_item(id, template_version_id, ordinal, title) VALUES ('item-1', 'version-1', 1, 'Item 1')",
                "INSERT INTO student_task_track(id, student_id, template_id, template_version_id, start_ordinal, current_ordinal, end_ordinal, start_date) VALUES ('track-1', 'student-1', 'template-1', 'version-1', 1, 1, 1, '2026-09-07')",
                "INSERT INTO task_instance(id, student_id, source_type, track_id, template_version_id, template_item_id, item_ordinal, scheduled_date, status, title_snapshot) VALUES ('task-1', 'student-1', 'TRACK', 'track-1', 'version-1', 'item-1', 1, '2026-09-07', 'PENDING', 'Item 1')",
            ] {
                sqlx::query(sql).execute(&pool).await.expect("seed v1 row");
            }

            super::migrator().run(&pool).await.expect("upgrade to v2");

            let track_id: String =
                sqlx::query_scalar("SELECT track_id FROM task_instance WHERE id = 'task-1'")
                    .fetch_one(&pool)
                    .await
                    .expect("read migrated task");
            assert_eq!(track_id, "track-1");
            let mode: String = sqlx::query_scalar(
                "SELECT generation_mode FROM student_task_track WHERE id = 'track-1'",
            )
            .fetch_one(&pool)
            .await
            .expect("read migrated track");
            assert_eq!(mode, "ITEMIZED");
            let violations: i64 =
                sqlx::query_scalar("SELECT COUNT(*) FROM pragma_foreign_key_check")
                    .fetch_one(&pool)
                    .await
                    .expect("foreign key check");
            assert_eq!(violations, 0);
        });
    }

    #[test]
    fn reopening_does_not_repeat_migrations() {
        tauri::async_runtime::block_on(async {
            let pool = memory_pool().await;
            super::migrator()
                .run(&pool)
                .await
                .expect("initial migrations");
            let ledger = ledger_rows(&pool).await;

            super::migrator().run(&pool).await.expect("reopen");

            // 账本行没被改写，说明真的一条都没重跑。
            assert_eq!(ledger.len(), 4);
            assert_eq!(ledger, ledger_rows(&pool).await);
        });
    }

    #[test]
    fn upgrades_v3_with_customer_feedback_fields_without_changing_existing_rows() {
        tauri::async_runtime::block_on(async {
            let pool = memory_pool().await;
            let v1 = super::migration(
                1,
                "local core",
                include_str!("../migrations/0001_local_core.sql"),
            );
            let v2 = super::migration(
                2,
                "sequence long task",
                include_str!("../migrations/0002_sequence_long_task.sql"),
            );
            let v3 = super::migration(
                3,
                "sequence invariants",
                include_str!("../migrations/0003_sequence_invariants.sql"),
            );
            Migrator {
                migrations: Cow::Owned(vec![v1, v2, v3]),
                ignore_missing: false,
                locking: true,
                no_tx: false,
            }
            .run(&pool)
            .await
            .expect("apply v3");

            sqlx::query(
                "INSERT INTO student(id, student_code, name, class_type) VALUES ('student-1', 'S1', 'Student', 'Class A')",
            )
            .execute(&pool)
            .await
            .expect("seed v3 student");

            super::migrator().run(&pool).await.expect("upgrade to v4");

            let (class_type, exam_date): (String, Option<String>) =
                sqlx::query_as("SELECT class_type, exam_date FROM student WHERE id = 'student-1'")
                    .fetch_one(&pool)
                    .await
                    .expect("read migrated student");
            assert_eq!(class_type, "Class A");
            assert_eq!(exam_date, None);

            let index_count: i64 = sqlx::query_scalar(
                "SELECT COUNT(*) FROM pragma_index_list('student') WHERE name = 'idx_student_exam_date'",
            )
            .fetch_one(&pool)
            .await
            .expect("read exam date index");
            assert_eq!(index_count, 1);
        });
    }

    #[test]
    fn export_includes_committed_wal_data() {
        tauri::async_runtime::block_on(async {
            let stamp = super::SystemTime::now()
                .duration_since(super::UNIX_EPOCH)
                .expect("timestamp")
                .as_nanos();
            let directory = std::env::temp_dir().join(format!("assistant-export-{stamp}"));
            super::fs::create_dir_all(&directory).expect("create test directory");
            let source = directory.join("source.db");
            let target = directory.join("export.db");
            let pool = SqlitePoolOptions::new()
                .max_connections(1)
                .connect_with(
                    SqliteConnectOptions::new()
                        .filename(&source)
                        .create_if_missing(true)
                        .journal_mode(super::SqliteJournalMode::Wal),
                )
                .await
                .expect("open source");
            sqlx::query("CREATE TABLE sample (value TEXT)")
                .execute(&pool)
                .await
                .expect("create table");
            sqlx::query("INSERT INTO sample VALUES ('saved')")
                .execute(&pool)
                .await
                .expect("save row");
            super::export_database(&pool, &target)
                .await
                .expect("export");
            let mut exported = SqliteConnection::connect_with(
                &SqliteConnectOptions::new()
                    .filename(&target)
                    .read_only(true),
            )
            .await
            .expect("open export");
            let value: String = sqlx::query_scalar("SELECT value FROM sample")
                .fetch_one(&mut exported)
                .await
                .expect("read exported row");
            assert_eq!(value, "saved");
            exported.close().await.expect("close export connection");
            pool.close().await;
            super::fs::remove_file(target).expect("remove export fixture");
            super::fs::remove_file(source).expect("remove source fixture");
            super::fs::remove_dir(directory).expect("remove test directory");
        });
    }

    /// installed_on 是 sqlx 自己写的时间戳，重跑一定会变，所以拿它当"没重跑"的证据。
    async fn ledger_rows(pool: &SqlitePool) -> Vec<String> {
        sqlx::query_scalar(
            "SELECT version || ':' || hex(checksum) || ':' || installed_on
             FROM _sqlx_migrations ORDER BY version",
        )
        .fetch_all(pool)
        .await
        .expect("read migration ledger")
    }

    #[test]
    fn rolls_back_all_statements_when_one_fails() {
        tauri::async_runtime::block_on(async {
            let pool = memory_pool().await;
            sqlx::query("CREATE TABLE sample (id TEXT PRIMARY KEY, value TEXT NOT NULL)")
                .execute(&pool)
                .await
                .expect("create sample table");

            execute_transaction(
                &pool,
                &[LocalSqlStatement {
                    sql: "INSERT INTO sample(id, value) VALUES ($1, $2)".to_owned(),
                    values: vec![json!("existing"), json!("kept")],
                    expected_rows_affected: Some(1),
                }],
            )
            .await
            .expect("seed transaction");

            let result = execute_transaction(
                &pool,
                &[
                    LocalSqlStatement {
                        sql: "INSERT INTO sample(id, value) VALUES ($1, $2)".to_owned(),
                        values: vec![json!("rolled-back"), json!("first")],
                        expected_rows_affected: Some(1),
                    },
                    LocalSqlStatement {
                        sql: "INSERT INTO sample(id, value) VALUES ($1, $2)".to_owned(),
                        values: vec![json!("existing"), json!("duplicate")],
                        expected_rows_affected: Some(1),
                    },
                ],
            )
            .await;

            assert!(result.is_err());
            let count: i64 = sqlx::query("SELECT COUNT(*) AS count FROM sample")
                .fetch_one(&pool)
                .await
                .expect("count sample rows")
                .get("count");
            assert_eq!(count, 1);
        });
    }
}
