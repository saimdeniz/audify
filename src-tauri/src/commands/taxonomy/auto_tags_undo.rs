use super::auto_tags::{
    compute_auto_tag_plan, read_auto_tag_inputs, ACTIVE_PROFILE_VISIBLE_SAMPLES_SQL,
};
use crate::db::{
    ensure_taxonomy_tag, get_active_profile_id, prune_orphan_auto_tags, AutoTagUndoSnapshot,
    SnapshotTagMeta, AppState, FTS_TAGS_TEXT_SUBQUERY_SQL, SAMPLE_TAGS_FTS_TRIGGERS_SQL,
};
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use tauri::State;

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct AutoTagImpactPreview {
    pub affected_samples: usize,
    pub added_links: usize,
    pub removed_links: usize,
    pub can_undo: bool,
}

pub(crate) fn preview_auto_tag_rules_impact_with_conn(
    conn: &Connection,
    can_undo: bool,
) -> Result<AutoTagImpactPreview, String> {
    let (active_id, settings_json, samples) = read_auto_tag_inputs(conn)?;
    let plan = compute_auto_tag_plan(active_id, &settings_json, samples);

    let mut existing_auto: HashMap<i64, HashSet<String>> = HashMap::new();
    let mut protected_links: HashMap<i64, HashSet<String>> = HashMap::new();

    let links_sql = format!(
        "SELECT st.sample_id, LOWER(t.name), st.is_manual, COALESCE(st.source, 'auto'),
                COALESCE(f.domain, 'tags')
         FROM sample_tags st
         INNER JOIN tags t ON t.id = st.tag_id
         LEFT JOIN tag_facets f ON f.id = t.facet_id
         WHERE st.sample_id IN ({})",
        ACTIVE_PROFILE_VISIBLE_SAMPLES_SQL
    );
    let mut stmt = conn.prepare(&links_sql).map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![active_id], |r| {
            Ok((
                r.get::<_, i64>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, i64>(2)? != 0,
                r.get::<_, String>(3)?,
                r.get::<_, String>(4)?,
            ))
        })
        .map_err(|e| e.to_string())?;

    for row in rows.flatten() {
        let (sid, lower_name, is_manual, source, domain) = row;
        let is_rule_managed =
            !is_manual && domain != "genres" && (source == "auto" || source == "auto_rule");
        if is_rule_managed {
            existing_auto.entry(sid).or_default().insert(lower_name);
        } else {
            protected_links.entry(sid).or_default().insert(lower_name);
        }
    }

    let mut planned_auto: HashMap<i64, HashSet<String>> = HashMap::new();
    for item in &plan.computed {
        if item.tags.is_empty() {
            continue;
        }
        let protected = protected_links.get(&item.sample_id);
        let entry = planned_auto.entry(item.sample_id).or_default();
        for raw_tag in &item.tags {
            let low = raw_tag.trim().to_lowercase();
            if !low.is_empty() && !protected.is_some_and(|p| p.contains(&low)) {
                entry.insert(low);
            }
        }
    }

    let mut all_sids: HashSet<i64> = existing_auto.keys().copied().collect();
    all_sids.extend(planned_auto.keys().copied());

    let mut affected_samples = 0usize;
    let mut added_links = 0usize;
    let mut removed_links = 0usize;

    for sid in all_sids {
        let old_set = existing_auto.get(&sid);
        let new_set = planned_auto.get(&sid);
        let added = match (old_set, new_set) {
            (Some(o), Some(n)) => n.difference(o).count(),
            (None, Some(n)) => n.len(),
            _ => 0,
        };
        let removed = match (old_set, new_set) {
            (Some(o), Some(n)) => o.difference(n).count(),
            (Some(o), None) => o.len(),
            _ => 0,
        };
        if added > 0 || removed > 0 {
            affected_samples += 1;
            added_links += added;
            removed_links += removed;
        }
    }

    Ok(AutoTagImpactPreview {
        affected_samples,
        added_links,
        removed_links,
        can_undo,
    })
}

#[tauri::command]
pub async fn preview_auto_tag_rules_impact(
    state: State<'_, AppState>,
) -> Result<AutoTagImpactPreview, String> {
    let can_undo = {
        let guard = state
            .last_auto_tag_undo
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        guard.is_some()
    };
    crate::db::run_read_query(&state, move |conn| {
        preview_auto_tag_rules_impact_with_conn(conn, can_undo)
    })
    .await
}

pub(crate) fn capture_auto_tag_undo_snapshot(
    conn: &Connection,
    active_profile_id: i64,
) -> Result<AutoTagUndoSnapshot, String> {
    let mut tag_meta_by_id: HashMap<i64, SnapshotTagMeta> = HashMap::new();
    {
        let mut t_stmt = conn
            .prepare(
                "SELECT t.id, t.name, t.color, COALESCE(f.slug, 'category'), p.name
                 FROM tags t
                 LEFT JOIN tag_facets f ON f.id = t.facet_id
                 LEFT JOIN tags p ON p.id = t.parent_id",
            )
            .map_err(|e| e.to_string())?;
        let t_rows = t_stmt
            .query_map([], |r| {
                Ok((
                    r.get::<_, i64>(0)?,
                    SnapshotTagMeta {
                        name: r.get(1)?,
                        color: r.get(2)?,
                        facet_slug: r.get(3)?,
                        parent_name: r.get(4)?,
                    },
                ))
            })
            .map_err(|e| e.to_string())?;
        for (tid, meta) in t_rows.flatten() {
            tag_meta_by_id.insert(tid, meta);
        }
    }

    let prev_links_sql = format!(
        "SELECT st.sample_id, st.tag_id, COALESCE(st.source, 'auto_rule')
         FROM sample_tags st
         WHERE st.is_manual = 0
           AND COALESCE(st.source, 'auto') IN ('auto', 'auto_rule')
           AND st.tag_id NOT IN (
               SELECT t.id FROM tags t
               INNER JOIN tag_facets f ON f.id = t.facet_id
               WHERE f.domain = 'genres'
           )
           AND st.sample_id IN ({})",
        ACTIVE_PROFILE_VISIBLE_SAMPLES_SQL
    );
    let mut prev_sample_tags = Vec::new();
    {
        let mut st_stmt = conn.prepare(&prev_links_sql).map_err(|e| e.to_string())?;
        let rows = st_stmt
            .query_map(params![active_profile_id], |r| {
                Ok((
                    r.get::<_, i64>(0)?,
                    r.get::<_, i64>(1)?,
                    r.get::<_, String>(2)?,
                ))
            })
            .map_err(|e| e.to_string())?;
        prev_sample_tags.extend(rows.flatten());
    }

    let loop_sql = format!(
        "SELECT s.id, s.is_loop
         FROM samples s
         WHERE COALESCE(s.loop_is_manual, 0) = 0
           AND s.id IN ({})",
        ACTIVE_PROFILE_VISIBLE_SAMPLES_SQL
    );
    let mut prev_loop_flags = Vec::new();
    {
        let mut l_stmt = conn.prepare(&loop_sql).map_err(|e| e.to_string())?;
        let rows = l_stmt
            .query_map(params![active_profile_id], |r| {
                Ok((r.get::<_, i64>(0)?, r.get::<_, bool>(1)?))
            })
            .map_err(|e| e.to_string())?;
        prev_loop_flags.extend(rows.flatten());
    }

    Ok(AutoTagUndoSnapshot {
        profile_id: active_profile_id,
        tag_meta_by_id,
        prev_sample_tags,
        prev_loop_flags,
    })
}

pub(crate) fn restore_auto_tag_undo_snapshot_with_conn(
    conn: &mut Connection,
    snapshot: &AutoTagUndoSnapshot,
) -> Result<usize, String> {
    let active_id = get_active_profile_id(conn);
    if active_id != snapshot.profile_id {
        return Err("Active profile changed since last Apply Rules.".to_string());
    }

    let tx = conn
        .transaction()
        .map_err(|e| format!("Failed starting auto-tag undo transaction: {}", e))?;

    tx.execute_batch(
        "DROP TRIGGER IF EXISTS trg_sample_tags_ai;
         DROP TRIGGER IF EXISTS trg_sample_tags_ad;",
    )
    .map_err(|e| e.to_string())?;

    let delete_sql = format!(
        "DELETE FROM sample_tags
         WHERE is_manual = 0
           AND COALESCE(source, 'auto') IN ('auto', 'auto_rule')
           AND tag_id NOT IN (
               SELECT t.id FROM tags t
               INNER JOIN tag_facets f ON f.id = t.facet_id
               WHERE f.domain = 'genres'
           )
           AND sample_id IN ({})",
        ACTIVE_PROFILE_VISIBLE_SAMPLES_SQL
    );
    tx.execute(&delete_sql, params![active_id])
        .map_err(|e| e.to_string())?;

    {
        let mut loop_stmt = tx
            .prepare("UPDATE samples SET is_loop = ?1 WHERE id = ?2 AND loop_is_manual = 0")
            .map_err(|e| e.to_string())?;
        for &(sid, was_loop) in &snapshot.prev_loop_flags {
            let _ = loop_stmt.execute(params![was_loop, sid]);
        }
    }

    let mut resolved_tag_ids: HashMap<i64, i64> = HashMap::new();
    for (&orig_tid, meta) in &snapshot.tag_meta_by_id {
        let existing: Option<i64> = tx
            .query_row(
                "SELECT id FROM tags WHERE id = ?1 OR LOWER(name) = LOWER(?2) LIMIT 1",
                params![orig_tid, meta.name],
                |r| r.get(0),
            )
            .ok();
        let tid = match existing {
            Some(id) => id,
            None => ensure_taxonomy_tag(
                &tx,
                &meta.name,
                Some(&meta.facet_slug),
                meta.parent_name.as_deref(),
                Some(&meta.color),
                false,
            )
            .unwrap_or(0),
        };
        if tid > 0 {
            resolved_tag_ids.insert(orig_tid, tid);
        }
    }

    let mut restored_links = 0usize;
    {
        let mut ins_stmt = tx
            .prepare(
                "INSERT OR IGNORE INTO sample_tags (sample_id, tag_id, is_manual, source)
                 VALUES (?1, ?2, 0, ?3)",
            )
            .map_err(|e| e.to_string())?;
        for (sid, orig_tid, src) in &snapshot.prev_sample_tags {
            if let Some(&tid) = resolved_tag_ids.get(orig_tid) {
                if ins_stmt.execute(params![sid, tid, src]).unwrap_or(0) > 0 {
                    restored_links += 1;
                }
            }
        }
    }

    let _ = prune_orphan_auto_tags(&tx);

    let fts_sql = format!(
        "UPDATE samples_fts
         SET tags_text = {}
         WHERE rowid IN ({})",
        FTS_TAGS_TEXT_SUBQUERY_SQL, ACTIVE_PROFILE_VISIBLE_SAMPLES_SQL
    );
    tx.execute(&fts_sql, params![active_id])
        .map_err(|e| format!("Failed rebuilding FTS tags on undo: {}", e))?;

    tx.execute_batch(SAMPLE_TAGS_FTS_TRIGGERS_SQL)
        .map_err(|e| format!("Failed restoring FTS triggers on undo: {}", e))?;

    tx.commit()
        .map_err(|e| format!("Failed committing auto-tag undo: {}", e))?;

    Ok(restored_links)
}

#[tauri::command]
pub async fn undo_last_auto_tag_apply(state: State<'_, AppState>) -> Result<usize, String> {
    let state_cloned = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let snapshot = {
            let guard = state_cloned
                .last_auto_tag_undo
                .lock()
                .unwrap_or_else(|e| e.into_inner());
            guard
                .clone()
                .ok_or_else(|| "No recent Apply Rules operation available to undo.".to_string())?
        };
        let mut conn = state_cloned.lock_db();
        let restored = restore_auto_tag_undo_snapshot_with_conn(&mut conn, &snapshot)?;
        // Atomic Undo: clear snapshot ONLY after the underlying DB restore transaction commits!
        *state_cloned
            .last_auto_tag_undo
            .lock()
            .unwrap_or_else(|e| e.into_inner()) = None;
        Ok(restored)
    })
    .await
    .map_err(|e| format!("Auto-tag undo worker error: {}", e))?
}
