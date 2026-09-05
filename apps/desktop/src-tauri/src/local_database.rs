use serde::Deserialize;
use serde_json::Value;
use sqlx::{
    sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions},
    SqlitePool,
};
use std::fs;
use tauri::{App, Manager, State};

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

pub fn initialize(app: &App) -> Result<(), Box<dyn std::error::Error>> {
    let app_dir = app.path().app_config_dir()?;
    fs::create_dir_all(&app_dir)?;
    let options = SqliteConnectOptions::new()
        .filename(app_dir.join(DATABASE_FILENAME))
        .create_if_missing(true)
        .foreign_keys(true)
        .journal_mode(SqliteJournalMode::Wal);
    let pool = tauri::async_runtime::block_on(
        SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(options),
    )?;
    app.manage(LocalDatabase { pool });
    Ok(())
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
            query = match value {
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
            };
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
    use super::{execute_transaction, LocalSqlStatement};
    use serde_json::json;
    use sqlx::{sqlite::SqlitePoolOptions, Row};

    #[test]
    fn rolls_back_all_statements_when_one_fails() {
        tauri::async_runtime::block_on(async {
            let pool = SqlitePoolOptions::new()
                .max_connections(1)
                .connect("sqlite::memory:")
                .await
                .expect("open memory database");
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
