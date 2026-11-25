use crate::commands::SampleBpmKeyPatch;
use crate::db::{
    get_active_profile_id, is_sample_visible_in_profile, sql_in_placeholders,
    visible_sample_ids_in_profile, AppState,
};
use crate::dsp_analysis::normalize_musical_or_camelot_key;
use rusqlite::{params, params_from_iter, Connection};
use std::collections::HashMap;
use tauri::State;

pub(crate) fn toggle_favorite_with_conn(
    conn: &Connection,
    sample_id: i64,
) -> Result<bool, String> {
    let active_id = get_active_profile_id(conn);
    if !is_sample_visible_in_profile(conn, active_id, sample_id) {
        return Err(format!("Sample not found in active profile: {}", sample_id));
    }
    let was_favorite: bool = conn
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM profile_favorites WHERE profile_id = ?1 AND sample_id = ?2)",
            params![active_id, sample_id],
            |r| r.get(0),
        )
        .map_err(|e| format!("Failed to read profile favorite state: {}", e))?;

    if was_favorite {
        conn.execute(
            "DELETE FROM profile_favorites WHERE profile_id = ?1 AND sample_id = ?2",
            params![active_id, sample_id],
        )
        .map_err(|e| format!("Failed to toggle favorite: {}", e))?;
        Ok(false)
    } else {
        conn.execute(
            "INSERT OR IGNORE INTO profile_favorites (profile_id, sample_id) VALUES (?1, ?2)",
            params![active_id, sample_id],
        )
        .map_err(|e| format!("Failed to toggle favorite: {}", e))?;
        Ok(true)
    }
}

pub(crate) fn toggle_favorites_batch_with_conn(
    conn: &mut Connection,
    sample_ids: &[i64],
    favorite: bool,
) -> Result<(), String> {
    let valid_ids: Vec<i64> = sample_ids.iter().copied().filter(|&sid| sid > 0).collect();
    if valid_ids.is_empty() {
        return Ok(());
    }
    let active_id = get_active_profile_id(conn);
    let visible_set = visible_sample_ids_in_profile(conn, active_id, &valid_ids)?;
    let valid_ids: Vec<i64> = valid_ids
        .into_iter()
        .filter(|sid| visible_set.contains(sid))
        .collect();
    if valid_ids.is_empty() {
        return Ok(());
    }
    let tx = conn
        .transaction()
        .map_err(|e| format!("Failed to start database transaction: {}", e))?;

    for chunk in valid_ids.chunks(450) {
        let placeholders = sql_in_placeholders(2, chunk.len());
        let sql = if favorite {
            format!(
                "INSERT OR IGNORE INTO profile_favorites (profile_id, sample_id)
                 SELECT ?1, id FROM samples WHERE id IN ({})",
                placeholders
            )
        } else {
            format!(
                "DELETE FROM profile_favorites WHERE profile_id = ?1 AND sample_id IN ({})",
                placeholders
            )
        };
        let mut params_vec: Vec<rusqlite::types::Value> = Vec::with_capacity(chunk.len() + 1);
        params_vec.push(rusqlite::types::Value::Integer(active_id));
        for &sid in chunk {
            params_vec.push(rusqlite::types::Value::Integer(sid));
        }
        tx.execute(&sql, params_from_iter(params_vec))
            .map_err(|e| format!("Failed to update favorite: {}", e))?;
    }

    tx.commit().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn toggle_favorite(
    state: State<'_, AppState>,
    sample_id: i64,
) -> Result<bool, String> {
    crate::db::run_write_op(&state, move |conn| toggle_favorite_with_conn(conn, sample_id)).await
}

#[tauri::command]
pub async fn toggle_favorites_batch(
    state: State<'_, AppState>,
    sample_ids: Option<Vec<i64>>,
    favorite: bool,
) -> Result<(), String> {
    let sample_ids = sample_ids.unwrap_or_default();
    if sample_ids.is_empty() {
        return Ok(());
    }
    crate::db::run_write_op(&state, move |conn| {
        toggle_favorites_batch_with_conn(conn, &sample_ids, favorite)
    })
    .await
}

#[tauri::command]
pub async fn toggle_sample_loop(
    state: State<'_, AppState>,
    sample_id: i64,
) -> Result<bool, String> {
    crate::db::run_write_op(&state, move |conn| {
        let active_id = get_active_profile_id(conn);
        if !is_sample_visible_in_profile(conn, active_id, sample_id) {
            return Err("Sample not found in active profile".to_string());
        }
        conn.execute(
            "UPDATE samples
             SET is_loop = CASE WHEN is_loop = 1 THEN 0 ELSE 1 END,
                 loop_is_manual = 1
             WHERE id = ?1",
            params![sample_id],
        )
        .map_err(|e| format!("Failed to toggle sample class (loop/one-shot): {}", e))?;

        conn.query_row(
            "SELECT is_loop FROM samples WHERE id = ?1",
            params![sample_id],
            |r| r.get(0),
        )
        .map_err(|e| format!("Sample not found: {}", e))
    })
    .await
}

#[tauri::command]
pub async fn set_sample_bpm_key(
    state: State<'_, AppState>,
    sample_ids: Option<Vec<i64>>,
    bpm: Option<f64>,
    clear_bpm: Option<bool>,
    musical_key: Option<String>,
    clear_key: Option<bool>,
) -> Result<Vec<SampleBpmKeyPatch>, String> {
    let sample_ids = sample_ids.unwrap_or_default();
    if sample_ids.is_empty() {
        return Ok(Vec::new());
    }

    let do_clear_bpm = clear_bpm.unwrap_or(false);
    let sanitized_bpm = if do_clear_bpm {
        None
    } else {
        match bpm {
            Some(v) if v.is_finite() && (20.0..=300.0).contains(&v) => {
                Some((v * 10.0).round() / 10.0)
            }
            Some(_) => return Err("BPM must be between 20 and 300".to_string()),
            None => None,
        }
    };

    let do_clear_key = clear_key.unwrap_or(false);
    let normalized_key_pair = if do_clear_key {
        None
    } else if let Some(ref raw_k) = musical_key {
        let trimmed = raw_k.trim();
        if trimmed.is_empty() {
            None
        } else {
            Some(
                normalize_musical_or_camelot_key(trimmed)
                    .ok_or_else(|| format!("Unrecognized musical or Camelot key: '{}'", trimmed))?,
            )
        }
    } else {
        None
    };

    crate::db::run_write_op(&state, move |conn| {
        let active_id = get_active_profile_id(conn);
        let visible_set = visible_sample_ids_in_profile(conn, active_id, &sample_ids)?;
        let sample_ids: Vec<i64> = sample_ids
            .into_iter()
            .filter(|sid| visible_set.contains(sid))
            .collect();
        if sample_ids.is_empty() {
            return Ok(Vec::new());
        }
        let tx = conn
            .transaction()
            .map_err(|e| format!("Failed to start transaction: {}", e))?;

        let mut set_clauses: Vec<String> = Vec::new();
        let mut base_params: Vec<rusqlite::types::Value> = Vec::new();
        if do_clear_bpm {
            set_clauses.push("bpm = NULL".to_string());
            set_clauses.push("bpm_is_manual = 1".to_string());
        } else if let Some(b) = sanitized_bpm {
            base_params.push(rusqlite::types::Value::Real(b));
            set_clauses.push(format!("bpm = ?{}", base_params.len()));
            set_clauses.push("bpm_is_manual = 1".to_string());
        }
        if do_clear_key {
            set_clauses.push("musical_key = ''".to_string());
            set_clauses.push("camelot_key = ''".to_string());
            set_clauses.push("key_is_manual = 1".to_string());
        } else if let Some((ref mkey, ref cam)) = normalized_key_pair {
            base_params.push(rusqlite::types::Value::Text(mkey.clone()));
            set_clauses.push(format!("musical_key = ?{}", base_params.len()));
            base_params.push(rusqlite::types::Value::Text(cam.clone()));
            set_clauses.push(format!("camelot_key = ?{}", base_params.len()));
            set_clauses.push("key_is_manual = 1".to_string());
        }

        if !set_clauses.is_empty() {
            let set_sql = set_clauses.join(", ");
            let base_len = base_params.len();
            for chunk in sample_ids.chunks(450) {
                let placeholders = sql_in_placeholders(base_len + 1, chunk.len());
                let sql = format!("UPDATE samples SET {} WHERE id IN ({})", set_sql, placeholders);
                let mut params_vec = base_params.clone();
                for &sid in chunk {
                    params_vec.push(rusqlite::types::Value::Integer(sid));
                }
                tx.execute(&sql, params_from_iter(params_vec))
                    .map_err(|e| e.to_string())?;
            }
        }

        let mut row_map: HashMap<i64, (Option<f64>, String, String)> =
            HashMap::with_capacity(sample_ids.len());
        for chunk in sample_ids.chunks(450) {
            let placeholders = sql_in_placeholders(1, chunk.len());
            let sql = format!(
                "SELECT id, bpm, COALESCE(musical_key, ''), COALESCE(camelot_key, '')
                 FROM samples WHERE id IN ({})",
                placeholders
            );
            let params_vec: Vec<rusqlite::types::Value> = chunk
                .iter()
                .map(|&sid| rusqlite::types::Value::Integer(sid))
                .collect();
            let mut q_stmt = tx.prepare(&sql).map_err(|e| e.to_string())?;
            let rows = q_stmt
                .query_map(params_from_iter(params_vec), |r| {
                    Ok((
                        r.get::<_, i64>(0)?,
                        r.get::<_, Option<f64>>(1)?,
                        r.get::<_, String>(2)?,
                        r.get::<_, String>(3)?,
                    ))
                })
                .map_err(|e| e.to_string())?;
            for row in rows.flatten() {
                row_map.insert(row.0, (row.1, row.2, row.3));
            }
        }

        let mut patches = Vec::with_capacity(sample_ids.len());
        for &sid in &sample_ids {
            if let Some((b, mk, ck)) = row_map.get(&sid) {
                patches.push(SampleBpmKeyPatch {
                    sample_id: sid,
                    bpm: *b,
                    musical_key: mk.clone(),
                    camelot_key: ck.clone(),
                });
            }
        }

        tx.commit().map_err(|e| e.to_string())?;
        Ok(patches)
    })
    .await
}
