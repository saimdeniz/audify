pub mod default_rules;
mod migrations;
mod schema;

pub use default_rules::{
    default_auto_tag_rules, deterministic_color_for_name, STUDIO_COLOR_PALETTE,
};
pub use schema::{ensure_column, init_schema_on_conn, SAMPLE_TAGS_FTS_TRIGGERS_SQL};

use rusqlite::config::DbConfig;
use rusqlite::{params, params_from_iter, Connection, OpenFlags};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::Duration;

#[derive(Clone)]
pub struct AppState {
    pub db: Arc<Mutex<Connection>>,
    pub user_dir: PathBuf,
}

impl AppState {
    pub fn new(conn: Connection, user_dir: PathBuf) -> Self {
        Self {
            db: Arc::new(Mutex::new(conn)),
            user_dir,
        }
    }

    /// Acquires the database connection guard, recovering safely if a previous caller panicked
    /// and rolling back any dangling uncommitted transaction.
    pub fn lock_db(&self) -> MutexGuard<'_, Connection> {
        match self.db.lock() {
            Ok(conn) => conn,
            Err(err) => {
                let conn = err.into_inner();
                if !conn.is_autocommit() {
                    let _ = conn.execute_batch("ROLLBACK;");
                }
                conn
            }
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AutoTagRule {
    pub id: String,
    pub tag_name: String,
    pub tag_color: String,
    pub keywords: Vec<String>,
    pub enabled: bool,
    #[serde(default)]
    pub category: Option<String>,
    #[serde(default)]
    pub include_paths: Option<Vec<String>>,
    #[serde(default)]
    pub exclude_paths: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub rel_include_paths: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub rel_exclude_paths: Vec<String>,
    #[serde(default)]
    pub min_duration_ms: Option<i64>,
    #[serde(default)]
    pub max_duration_ms: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AutoTagCategoryConfig {
    pub name: String,
    #[serde(default)]
    pub include_paths: Vec<String>,
    #[serde(default)]
    pub exclude_paths: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub rel_include_paths: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub rel_exclude_paths: Vec<String>,
}

pub fn resolve_user_dir() -> PathBuf {
    #[cfg(debug_assertions)]
    {
        if let Some(manifest_parent) = Path::new(env!("CARGO_MANIFEST_DIR")).parent() {
            let dev_user = manifest_parent.join("user");
            if dev_user.exists() {
                return dev_user;
            }
        }
    }

    if let Ok(exe_path) = std::env::current_exe() {
        if let Some(exe_dir) = exe_path.parent() {
            let portable_user = exe_dir.join("user");
            if portable_user.exists() {
                return portable_user;
            }
            let exe_dir_str = exe_dir.to_string_lossy().to_lowercase();
            if !exe_dir_str.contains("\\target\\debug") && !exe_dir_str.contains("/target/debug") {
                return portable_user;
            }
        }
    }

    #[cfg(debug_assertions)]
    {
        if let Some(manifest_parent) = Path::new(env!("CARGO_MANIFEST_DIR")).parent() {
            return manifest_parent.join("user");
        }
    }

    PathBuf::from("user")
}

/// Writable per-user fallback used when the portable `user/` folder cannot be created or
/// opened (e.g. app installed under Program Files).
pub fn fallback_user_dir() -> Option<PathBuf> {
    std::env::var_os("APPDATA")
        .or_else(|| std::env::var_os("LOCALAPPDATA"))
        .map(|p| PathBuf::from(p).join("Audify"))
}

/// Opens a concurrent WAL read-only SQLite connection (`SQLITE_OPEN_READ_ONLY | SQLITE_OPEN_NO_MUTEX`
/// with `PRAGMA query_only = ON` and `busy_timeout(5000)`) so UI read queries never contend with
/// background write transactions.
pub fn open_read_conn(user_dir: &Path) -> Result<Connection, String> {
    let db_path = user_dir.join("samples.db");
    let flags = OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX;
    let conn = Connection::open_with_flags(&db_path, flags).map_err(|e| {
        format!(
            "Failed to open read-only SQLite connection: {}",
            crate::security::sanitize_err(user_dir, &e.to_string())
        )
    })?;
    conn.busy_timeout(Duration::from_millis(5000)).map_err(|e| {
        format!(
            "Failed to set read busy_timeout: {}",
            crate::security::sanitize_err(user_dir, &e.to_string())
        )
    })?;
    conn.execute_batch(
        "PRAGMA query_only = ON;
         PRAGMA temp_store = MEMORY;
         PRAGMA mmap_size = 67108864;
         PRAGMA cache_size = -6000;",
    )
    .map_err(|e| {
        format!(
            "Failed to configure read-only PRAGMAs: {}",
            crate::security::sanitize_err(user_dir, &e.to_string())
        )
    })?;
    Ok(conn)
}

/// Executes a read-only database query on Tauri's blocking thread pool using a concurrent WAL
/// read connection (`open_read_conn`), falling back to `state.lock_db()` only if opening a
/// read-only handle fails.
pub async fn run_read_query<T, F>(state: &AppState, f: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce(&Connection) -> Result<T, String> + Send + 'static,
{
    let state_owned = state.clone();
    tauri::async_runtime::spawn_blocking(move || match open_read_conn(&state_owned.user_dir) {
        Ok(read_conn) => f(&read_conn),
        Err(_) => {
            let conn = state_owned.lock_db();
            f(&conn)
        }
    })
    .await
    .map_err(|e| format!("Database read task join error: {}", e))?
}

pub fn init_db(user_dir: &Path) -> Result<Connection, String> {
    fs::create_dir_all(user_dir).map_err(|e| {
        format!(
            "Failed to create AppData directory: {}",
            crate::security::sanitize_err(user_dir, &e.to_string())
        )
    })?;
    let _ = fs::create_dir_all(user_dir.join("backups"));
    let _ = fs::create_dir_all(user_dir.join("images"));
    let _ = fs::create_dir_all(user_dir.join("trash"));
    let _ = fs::create_dir_all(user_dir.join("cache").join("slices"));
    let _ = fs::create_dir_all(user_dir.join("cache").join("playback_fallback"));
    let _ = fs::create_dir_all(user_dir.join("cache").join("webview"));

    let db_path = user_dir.join("samples.db");
    let conn = Connection::open(&db_path).map_err(|e| {
        format!(
            "Failed to open SQLite database: {}",
            crate::security::sanitize_err(user_dir, &e.to_string())
        )
    })?;

    init_schema_on_conn(&conn)?;
    let _ = conn.set_db_config(DbConfig::SQLITE_DBCONFIG_DEFENSIVE, true);
    let _ = conn.execute_batch("PRAGMA trusted_schema = OFF;");
    Ok(conn)
}

pub fn get_active_profile_id(conn: &Connection) -> i64 {
    conn.query_row(
        "SELECT id FROM profiles WHERE is_active = 1 ORDER BY id ASC LIMIT 1",
        [],
        |r| r.get(0),
    )
    .unwrap_or(1)
}

/// Checks whether a single `sample_id` belongs to a library visible in `profile_id`.
pub(crate) fn is_sample_visible_in_profile(
    conn: &Connection,
    profile_id: i64,
    sample_id: i64,
) -> bool {
    conn.query_row(
        "SELECT EXISTS(
            SELECT 1
            FROM samples s
            INNER JOIN libraries l ON l.id = s.library_id
            WHERE s.id = ?1
              AND (l.is_global = 1 OR l.id IN (SELECT pl.library_id FROM profile_libraries pl WHERE pl.profile_id = ?2))
        )",
        params![sample_id, profile_id],
        |r| r.get(0),
    )
    .unwrap_or(false)
}

/// Builds SQLite positional placeholder lists (`?start, ?(start+1), ...`).
pub fn sql_in_placeholders(start_idx: usize, count: usize) -> String {
    (0..count)
        .map(|i| format!("?{}", start_idx + i))
        .collect::<Vec<_>>()
        .join(", ")
}

/// Returns the subset of `sample_ids` belonging to libraries visible in `profile_id` using
/// chunked `IN (?...)` queries (never unbounded full-table scans).
pub(crate) fn visible_sample_ids_in_profile(
    conn: &Connection,
    profile_id: i64,
    sample_ids: &[i64],
) -> Result<HashSet<i64>, String> {
    let mut visible = HashSet::new();
    if sample_ids.is_empty() {
        return Ok(visible);
    }

    for chunk in sample_ids.chunks(400) {
        let placeholders = sql_in_placeholders(2, chunk.len());
        let sql = format!(
            "SELECT s.id
             FROM samples s
             INNER JOIN libraries l ON l.id = s.library_id
             WHERE (l.is_global = 1 OR l.id IN (SELECT pl.library_id FROM profile_libraries pl WHERE pl.profile_id = ?1))
               AND s.id IN ({})",
            placeholders
        );
        let mut param_vals: Vec<rusqlite::types::Value> = Vec::with_capacity(chunk.len() + 1);
        param_vals.push(rusqlite::types::Value::Integer(profile_id));
        for &id in chunk {
            param_vals.push(rusqlite::types::Value::Integer(id));
        }
        let mut stmt = conn
            .prepare(&sql)
            .map_err(|e| format!("Failed checking profile sample visibility: {}", e))?;
        let rows = stmt
            .query_map(params_from_iter(param_vals), |r| r.get::<_, i64>(0))
            .map_err(|e| format!("Failed reading profile sample visibility: {}", e))?;
        for sid in rows.flatten() {
            visible.insert(sid);
        }
    }
    Ok(visible)
}

/// Checks whether a collection belongs to `profile_id`.
pub(crate) fn is_collection_in_profile(
    conn: &Connection,
    profile_id: i64,
    collection_id: i64,
) -> bool {
    conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM collections WHERE id = ?1 AND profile_id = ?2)",
        params![collection_id, profile_id],
        |r| r.get(0),
    )
    .unwrap_or(false)
}
