use crate::commands::{resolve_or_create_auto_tag, AutoTagPreviewResult};
use crate::db::{
    get_active_profile_id, AppState, AutoTagRule, SAMPLE_TAGS_FTS_TRIGGERS_SQL,
};
use crate::scanner::{detect_is_loop, match_auto_tags, parse_rules_from_settings};
use rusqlite::{params, Connection};
use std::collections::HashMap;
use tauri::State;

pub(super) struct SampleAutoTagInput {
    pub id: i64,
    pub file_path: String,
    pub file_name: String,
    pub duration_ms: i64,
    pub old_is_loop: bool,
    pub loop_is_manual: bool,
}

pub(super) struct ComputedSampleTags {
    pub sample_id: i64,
    pub new_is_loop: Option<bool>,
    pub tags: Vec<String>,
}

pub(super) struct PreparedAutoTagPlan {
    pub active_id: i64,
    pub rules: Vec<AutoTagRule>,
    pub computed: Vec<ComputedSampleTags>,
    pub assigned_count: usize,
}

pub(super) const ACTIVE_PROFILE_VISIBLE_SAMPLES_SQL: &str = "
    SELECT s.id
    FROM samples s
    INNER JOIN libraries l ON l.id = s.library_id
    WHERE COALESCE(s.is_trashed, 0) = 0
      AND (
          l.is_global = 1
          OR EXISTS (
              SELECT 1 FROM profile_libraries pl
              WHERE pl.profile_id = ?1 AND pl.library_id = l.id
          )
      )
";

fn read_active_profile_settings(conn: &Connection) -> (i64, String) {
    let active_id = get_active_profile_id(conn);
    let settings_json: String = conn
        .query_row(
            "SELECT settings_json FROM profiles WHERE id = ?1 LIMIT 1",
            params![active_id],
            |r| r.get(0),
        )
        .unwrap_or_else(|_| "{}".to_string());
    (active_id, settings_json)
}

pub(super) fn read_auto_tag_inputs(
    conn: &Connection,
) -> Result<(i64, String, Vec<SampleAutoTagInput>), String> {
    let (active_id, settings_json) = read_active_profile_settings(conn);
    let mut stmt = conn
        .prepare(
            "SELECT s.id, s.file_path, s.file_name, s.duration_ms, s.is_loop,
                    COALESCE(s.loop_is_manual, 0)
             FROM samples s
             INNER JOIN libraries l ON l.id = s.library_id
             WHERE COALESCE(s.is_trashed, 0) = 0
               AND (
                   l.is_global = 1
                   OR EXISTS (
                       SELECT 1 FROM profile_libraries pl
                       WHERE pl.profile_id = ?1 AND pl.library_id = l.id
                   )
               )",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![active_id], |r| {
            Ok(SampleAutoTagInput {
                id: r.get(0)?,
                file_path: r.get(1)?,
                file_name: r.get(2)?,
                duration_ms: r.get(3)?,
                old_is_loop: r.get(4)?,
                loop_is_manual: r.get(5)?,
            })
        })
        .map_err(|e| e.to_string())?;
    Ok((active_id, settings_json, rows.flatten().collect()))
}

pub(super) fn compute_auto_tag_plan(
    active_id: i64,
    settings_json: &str,
    samples: Vec<SampleAutoTagInput>,
) -> PreparedAutoTagPlan {
    let (rules, categories) = parse_rules_from_settings(settings_json);
    let mut computed = Vec::with_capacity(samples.len());
    let mut assigned_count: usize = 0;

    for sample in samples {
        let (effective_is_loop, new_is_loop) = if sample.loop_is_manual {
            (sample.old_is_loop, None)
        } else {
            let detected = detect_is_loop(&sample.file_name, &sample.file_path, sample.duration_ms);
            let patch = (detected != sample.old_is_loop).then_some(detected);
            (detected, patch)
        };

        let tags = match_auto_tags(
            &sample.file_path,
            &sample.file_name,
            sample.duration_ms,
            effective_is_loop,
            &rules,
            &categories,
        );
        if !tags.is_empty() {
            assigned_count += 1;
        }
        if new_is_loop.is_some() || !tags.is_empty() {
            computed.push(ComputedSampleTags {
                sample_id: sample.id,
                new_is_loop,
                tags,
            });
        }
    }

    PreparedAutoTagPlan {
        active_id,
        rules,
        computed,
        assigned_count,
    }
}

fn commit_auto_tag_plan(conn: &mut Connection, plan: &PreparedAutoTagPlan) -> Result<usize, String> {
    let tx = conn
        .transaction()
        .map_err(|e| format!("Failed to start database transaction: {}", e))?;

    let mut tag_map: HashMap<String, i64> = HashMap::new();
    {
        let mut stmt = tx
            .prepare("SELECT id, name FROM tags")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?)))
            .map_err(|e| e.to_string())?;
        for r in rows.flatten() {
            tag_map.entry(r.1.to_lowercase()).or_insert(r.0);
        }
    }

    // Temporarily drop per-row sample_tags FTS triggers so bulk tag rebuild runs in O(N)
    // with a single set-based FTS5 update before commit.
    tx.execute_batch(
        "DROP TRIGGER IF EXISTS trg_sample_tags_ai;
         DROP TRIGGER IF EXISTS trg_sample_tags_ad;",
    )
    .map_err(|e| e.to_string())?;

    // Only clear rule-generated tags in the `tags` domain; NEVER touch `genres`-domain links
    // (auto-detected genres, moods, custom genre facets) or AI/manual assignments.
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
    tx.execute(&delete_sql, params![plan.active_id])
        .map_err(|e| e.to_string())?;

    {
        let mut update_loop_stmt = tx
            .prepare("UPDATE samples SET is_loop = ?1 WHERE id = ?2 AND loop_is_manual = 0")
            .map_err(|e| e.to_string())?;
        let mut insert_stmt = tx
            .prepare(
                "INSERT OR IGNORE INTO sample_tags (sample_id, tag_id, is_manual, source)
                 VALUES (?1, ?2, 0, 'auto_rule')",
            )
            .map_err(|e| e.to_string())?;

        for item in &plan.computed {
            if let Some(detected) = item.new_is_loop {
                let _ = update_loop_stmt.execute(params![detected, item.sample_id]);
            }
            for t_name in &item.tags {
                let tag_id = resolve_or_create_auto_tag(&tx, &mut tag_map, &plan.rules, t_name);
                if tag_id > 0 {
                    let _ = insert_stmt.execute(params![item.sample_id, tag_id]);
                }
            }
        }
    }

    // Prune ONLY auto-generated orphan leaf tags (protecting manual tags, system roots, and parents).
    let _ = crate::db::prune_orphan_auto_tags(&tx);

    let fts_sql = format!(
        "UPDATE samples_fts
         SET tags_text = {}
         WHERE rowid IN ({})",
        crate::db::FTS_TAGS_TEXT_SUBQUERY_SQL,
        ACTIVE_PROFILE_VISIBLE_SAMPLES_SQL
    );
    tx.execute(&fts_sql, params![plan.active_id])
        .map_err(|e| format!("Failed to rebuild FTS tags index: {}", e))?;

    tx.execute_batch(SAMPLE_TAGS_FTS_TRIGGERS_SQL)
        .map_err(|e| format!("Failed to restore FTS triggers: {}", e))?;

    tx.commit()
        .map_err(|e| format!("Failed to commit scan transaction: {}", e))?;

    Ok(plan.assigned_count)
}

#[cfg(test)]
pub(crate) fn apply_auto_tag_rules_with_conn(conn: &mut Connection) -> Result<usize, String> {
    let (active_id, settings_json, samples) = read_auto_tag_inputs(conn)?;
    let plan = compute_auto_tag_plan(active_id, &settings_json, samples);
    commit_auto_tag_plan(conn, &plan)
}

#[tauri::command]
pub async fn apply_auto_tag_rules_to_library(state: State<'_, AppState>) -> Result<usize, String> {
    let state_cloned = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let (active_id, settings_json, samples) = match state_cloned.acquire_read_conn() {
            Ok(read_conn) => read_auto_tag_inputs(&read_conn)?,
            Err(_) => {
                let conn = state_cloned.lock_db();
                read_auto_tag_inputs(&conn)?
            }
        };
        let plan = compute_auto_tag_plan(active_id, &settings_json, samples);
        let mut conn = state_cloned.lock_db();
        let snapshot =
            super::auto_tags_undo::capture_auto_tag_undo_snapshot(&conn, plan.active_id)?;
        let assigned = commit_auto_tag_plan(&mut conn, &plan)?;
        *state_cloned
            .last_auto_tag_undo
            .lock()
            .unwrap_or_else(|e| e.into_inner()) = Some(snapshot);
        Ok(assigned)
    })
    .await
    .map_err(|e| format!("Auto-tag worker error: {}", e))?
}

fn preview_auto_tag_rule_with_conn(
    conn: &Connection,
    rule: AutoTagRule,
) -> Result<AutoTagPreviewResult, String> {
    let (active_id, settings_json) = read_active_profile_settings(conn);
    let (_, categories) = parse_rules_from_settings(&settings_json);

    let mut stmt = conn
        .prepare(
            "SELECT s.file_path, s.file_name, s.duration_ms, s.is_loop
             FROM samples s
             INNER JOIN libraries l ON l.id = s.library_id
             WHERE COALESCE(s.is_trashed, 0) = 0
               AND (
                   l.is_global = 1
                   OR EXISTS (
                       SELECT 1 FROM profile_libraries pl
                       WHERE pl.profile_id = ?1 AND pl.library_id = l.id
                   )
               )
             LIMIT 20000",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map(params![active_id], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, i64>(2)?,
                r.get::<_, bool>(3)?,
            ))
        })
        .map_err(|e| e.to_string())?;

    let mut match_count = 0;
    let mut sample_names = Vec::new();
    let target_tag_name = rule.tag_name.clone();
    let rules_slice = [rule];

    for item in rows.flatten() {
        let (file_path, file_name, duration_ms, _is_loop) = item;
        let matched = match_auto_tags(
            &file_path,
            &file_name,
            duration_ms,
            false,
            &rules_slice,
            &categories,
        );
        if matched
            .iter()
            .any(|t| t.eq_ignore_ascii_case(target_tag_name.trim()))
        {
            match_count += 1;
            if sample_names.len() < 12 {
                sample_names.push(file_name);
            }
        }
    }

    Ok(AutoTagPreviewResult {
        match_count,
        sample_names,
    })
}

#[tauri::command]
pub async fn preview_auto_tag_rule(
    state: State<'_, AppState>,
    rule: AutoTagRule,
) -> Result<AutoTagPreviewResult, String> {
    crate::db::run_read_query(&state, move |conn| {
        preview_auto_tag_rule_with_conn(conn, rule)
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::init_schema_on_conn;

    #[test]
    fn apply_auto_tags_preserves_ai_auto_inactive_profiles_and_manual_colors() {
        let mut conn = Connection::open_in_memory().expect("open in-memory db");
        init_schema_on_conn(&conn).expect("init schema");

        conn.execute(
            "INSERT INTO profiles (id, name, is_active, settings_json) VALUES (2, 'Other', 0, '{}')",
            [],
        )
        .unwrap();

        let rules_json = serde_json::json!({
            "autoTagCategories": [],
            "autoTagRules": [
                {
                    "id": "r-kick",
                    "tag_name": "kick",
                    "tag_color": "#ABCDEF",
                    "keywords": ["kick"],
                    "enabled": true,
                    "include_paths": [],
                    "exclude_paths": []
                },
                {
                    "id": "r-snare",
                    "tag_name": "SnareTest",
                    "tag_color": "javascript:alert(1)",
                    "keywords": ["snare"],
                    "enabled": true,
                    "include_paths": [],
                    "exclude_paths": []
                }
            ]
        })
        .to_string();
        conn.execute(
            "UPDATE profiles SET settings_json = ?1 WHERE id = 1",
            params![rules_json],
        )
        .unwrap();

        conn.execute(
            "INSERT INTO libraries (id, path, name, is_global) VALUES (1, 'C:/LibA', 'LibA', 0), (2, 'C:/LibB', 'LibB', 0)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO profile_libraries (profile_id, library_id) VALUES (1, 1), (2, 2)",
            [],
        )
        .unwrap();

        conn.execute(
            "INSERT INTO samples (id, library_id, file_path, file_name, extension, duration_ms)
             VALUES
               (1, 1, 'C:/LibA/kick_01.wav', 'kick_01.wav', 'wav', 250),
               (2, 2, 'C:/LibB/other_kick.wav', 'other_kick.wav', 'wav', 250),
               (3, 1, 'C:/LibA/snare_01.wav', 'snare_01.wav', 'wav', 250)",
            [],
        )
        .unwrap();

        // Pre-existing manual color tag with uppercase variant should keep its color,
        // AI auto tag on active sample must survive, and inactive profile's auto_rule tag must survive.
        conn.execute(
            "INSERT INTO tags (id, name, color, is_manual)
             VALUES (10, 'Kick', '#112233', 1), (11, 'Warm', '#445566', 0), (12, 'OtherProfileAuto', '#778899', 0)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO sample_tags (sample_id, tag_id, is_manual, source)
             VALUES (1, 11, 0, 'ai_auto'), (2, 12, 0, 'auto_rule')",
            [],
        )
        .unwrap();

        apply_auto_tag_rules_with_conn(&mut conn).expect("apply auto tags");

        let ai_auto_kept: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sample_tags WHERE sample_id = 1 AND tag_id = 11 AND source = 'ai_auto'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(ai_auto_kept, 1, "ai_auto tag must be preserved");

        let other_profile_kept: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sample_tags WHERE sample_id = 2 AND tag_id = 12 AND source = 'auto_rule'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(other_profile_kept, 1, "inactive profile tag must be preserved");

        let kick_tag_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM tags WHERE LOWER(name) = 'kick'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(kick_tag_count, 1, "case duplicate tag must not be created");

        let kick_color: String = conn
            .query_row("SELECT color FROM tags WHERE id = 10", [], |r| r.get(0))
            .unwrap();
        assert_eq!(kick_color, "#112233", "manual tag color must not be overwritten");

        let assigned_source: String = conn
            .query_row(
                "SELECT source FROM sample_tags WHERE sample_id = 1 AND tag_id = 10",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(assigned_source, "auto_rule");

        let snare_color: String = conn
            .query_row(
                "SELECT color FROM tags WHERE name = 'SnareTest'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert!(
            crate::security::validate_hex_color(&snare_color).is_ok(),
            "invalid rule tag color must fall back to valid hex"
        );
    }

    #[test]
    fn preview_auto_tag_rule_ignores_is_loop_false_positives_and_caps_at_12() {
        let conn = Connection::open_in_memory().expect("open in-memory db");
        init_schema_on_conn(&conn).expect("init schema");
        conn.execute(
            "INSERT INTO libraries (id, path, name, is_global) VALUES (1, 'C:/SFX', 'SFX', 1)",
            [],
        )
        .unwrap();

        for i in 1..=15 {
            conn.execute(
                "INSERT INTO samples (library_id, file_path, file_name, extension, duration_ms, is_loop)
                 VALUES (1, ?1, ?2, 'mp3', 1200, 1)",
                params![
                    format!("C:/SFX/mc/berry_bush_break_{}.mp3", i),
                    format!("berry_bush_break_{}.mp3", i)
                ],
            )
            .unwrap();
        }
        for i in 1..=15 {
            conn.execute(
                "INSERT INTO samples (library_id, file_path, file_name, extension, duration_ms, is_loop)
                 VALUES (1, ?1, ?2, 'wav', 450, 0)",
                params![
                    format!("C:/SFX/weapons/sword_slash_{}.wav", i),
                    format!("sword_slash_{}.wav", i)
                ],
            )
            .unwrap();
        }

        let rule = AutoTagRule {
            id: "r-sword".to_string(),
            tag_name: "Melee".to_string(),
            tag_color: "#EF4444".to_string(),
            keywords: vec!["sword".to_string(), "slash".to_string()],
            enabled: true,
            include_paths: Some(Vec::new()),
            exclude_paths: Some(Vec::new()),
            rel_include_paths: Vec::new(),
            rel_exclude_paths: Vec::new(),
            category: None,
            min_duration_ms: None,
            max_duration_ms: None,
            facet_slug: Some("category".to_string()),
            parent_tag_name: Some("Action & Combat".to_string()),
        };

        let preview = super::preview_auto_tag_rule_with_conn(&conn, rule).expect("preview");
        assert_eq!(preview.match_count, 15, "is_loop non-matching files must never be counted");
        assert_eq!(preview.sample_names.len(), 12, "preview list should show up to 12 names");
        assert!(
            preview
                .sample_names
                .iter()
                .all(|n| n.starts_with("sword_slash_")),
            "unexpected non-matching sample in preview: {:?}",
            preview.sample_names
        );
    }

    #[test]
    fn apply_auto_tags_preserves_genres_domain_tags_and_never_prunes_them() {
        let mut conn = Connection::open_in_memory().expect("open in-memory db");
        init_schema_on_conn(&conn).expect("init schema");

        conn.execute(
            "INSERT INTO libraries (id, path, name, is_global) VALUES (1, 'C:/Music', 'Music', 1)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO samples (id, library_id, file_path, file_name, extension, duration_ms, genre)
             VALUES (1, 1, 'C:/Music/acoustic_theme.mp3', 'acoustic_theme.mp3', 'mp3', 12000, 'Acoustic')",
            [],
        )
        .unwrap();

        // Seed both a legacy 'auto' Genre tag and a new 'auto_genre' Mood tag in genres-domain facets.
        conn.execute(
            "INSERT INTO tags (id, name, color, is_manual, facet_id, path)
             VALUES
               (201, 'Acoustic', '#3B82F6', 0, 2, '/201/'),
               (202, 'Chill', '#EC4899', 0, 3, '/202/')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO sample_tags (sample_id, tag_id, is_manual, source)
             VALUES
               (1, 201, 0, 'auto'),
               (1, 202, 0, 'auto_genre')",
            [],
        )
        .unwrap();

        apply_auto_tag_rules_with_conn(&mut conn).expect("apply auto tags");

        let surviving_links: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sample_tags WHERE sample_id = 1 AND tag_id IN (201, 202)",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(
            surviving_links, 2,
            "Apply rules must never delete genres-domain sample_tags links"
        );

        let surviving_tags: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM tags WHERE id IN (201, 202)",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(
            surviving_tags, 2,
            "Apply rules must never prune auto-detected Genre or Mood tags"
        );
    }

    #[test]
    fn preview_impact_and_atomic_undo_restore_auto_tags_and_pruned_rows() {
        use crate::commands::taxonomy::auto_tags_undo::{
            capture_auto_tag_undo_snapshot, preview_auto_tag_rules_impact_with_conn,
            restore_auto_tag_undo_snapshot_with_conn,
        };
        use crate::db::ensure_taxonomy_tag;

        let mut conn = Connection::open_in_memory().expect("open in-memory db");
        init_schema_on_conn(&conn).expect("init schema");

        conn.execute(
            "INSERT INTO libraries (id, path, name, is_global) VALUES (1, 'C:/SFX', 'SFX', 1)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO samples (id, library_id, file_path, file_name, extension, duration_ms)
             VALUES
               (1, 1, 'C:/SFX/kick_heavy.wav', 'kick_heavy.wav', 'wav', 300),
               (2, 1, 'C:/SFX/snare_tight.wav', 'snare_tight.wav', 'wav', 300)",
            [],
        )
        .unwrap();

        // Seed initial rule matching sample 1 ("TempKickAuto") + a manual tag on sample 1 that must never be touched
        let initial_rules = serde_json::json!({
            "autoTagCategories": [],
            "autoTagRules": [
                {
                    "id": "r-kick",
                    "tag_name": "TempKickAuto",
                    "tag_color": "#EF4444",
                    "keywords": ["kick"],
                    "enabled": true,
                    "facet_slug": "category"
                }
            ]
        })
        .to_string();
        conn.execute(
            "UPDATE profiles SET settings_json = ?1 WHERE id = 1",
            params![initial_rules],
        )
        .unwrap();

        let manual_tag = ensure_taxonomy_tag(&conn, "KeepManual", Some("category"), None, None, true).unwrap();
        conn.execute(
            "INSERT INTO sample_tags (sample_id, tag_id, is_manual, source) VALUES (1, ?1, 1, 'manual')",
            params![manual_tag],
        )
        .unwrap();

        apply_auto_tag_rules_with_conn(&mut conn).expect("initial apply");

        // Now change rules: disable/remove TempKickAuto, enable TempSnareAuto
        let next_rules = serde_json::json!({
            "autoTagCategories": [],
            "autoTagRules": [
                {
                    "id": "r-snare",
                    "tag_name": "TempSnareAuto",
                    "tag_color": "#3B82F6",
                    "keywords": ["snare"],
                    "enabled": true,
                    "facet_slug": "category"
                }
            ]
        })
        .to_string();
        conn.execute(
            "UPDATE profiles SET settings_json = ?1 WHERE id = 1",
            params![next_rules],
        )
        .unwrap();

        let impact = preview_auto_tag_rules_impact_with_conn(&conn, false).expect("preview impact");
        assert_eq!(impact.added_links, 1, "should preview +1 link on snare_tight.wav");
        assert_eq!(impact.removed_links, 1, "should preview -1 link on kick_heavy.wav");
        assert_eq!(impact.affected_samples, 2, "2 distinct samples affected");

        // Capture undo snapshot right before applying new rules (which prunes orphan TempKickAuto!)
        let snapshot = capture_auto_tag_undo_snapshot(&conn, 1).expect("capture snapshot");
        apply_auto_tag_rules_with_conn(&mut conn).expect("apply updated rules");

        let kick_after_apply: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM tags WHERE name = 'TempKickAuto'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(kick_after_apply, 0, "orphan auto tag TempKickAuto was pruned on apply");

        // Undo restores pruned TempKickAuto + link on sample 1, removes TempSnareAuto, preserves KeepManual
        restore_auto_tag_undo_snapshot_with_conn(&mut conn, &snapshot).expect("undo apply");

        let restored_kick_link: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sample_tags st
                 INNER JOIN tags t ON t.id = st.tag_id
                 WHERE st.sample_id = 1 AND t.name = 'TempKickAuto' AND st.source = 'auto_rule'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(restored_kick_link, 1, "TempKickAuto tag & sample link restored");

        let snare_link_after_undo: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sample_tags st
                 INNER JOIN tags t ON t.id = st.tag_id
                 WHERE t.name = 'TempSnareAuto'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(snare_link_after_undo, 0, "TempSnareAuto link removed on undo");

        let manual_preserved: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sample_tags WHERE sample_id = 1 AND tag_id = ?1 AND is_manual = 1",
                params![manual_tag],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(manual_preserved, 1, "manual tag untouched across apply & undo");
    }
}
