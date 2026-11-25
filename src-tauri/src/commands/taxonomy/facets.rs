use crate::commands::TagFacet;
use crate::db::taxonomy::{rebuild_subtree_paths, sync_primary_genre_for_samples};
use crate::db::AppState;
use crate::security::validate_hex_color;
use crate::taxonomy_catalog::{
    deterministic_full_spectrum_color, FACET_CATEGORY_ID, FACET_GENRE_ID,
};
use rusqlite::{params, Connection};
use tauri::State;

const RESERVED_FACET_SLUGS: &[&str] = &[
    "category",
    "genre",
    "mood",
    "source",
    "all",
    "tag",
    "tags",
    "genres",
    "facet",
    "folder",
    "collection",
];

fn normalize_domain(raw: &str) -> Result<&'static str, String> {
    match raw.trim().to_ascii_lowercase().as_str() {
        "tags" => Ok("tags"),
        "genres" => Ok("genres"),
        _ => Err("Facet domain must be either 'tags' or 'genres'.".to_string()),
    }
}

fn clean_facet_name(raw: &str) -> Result<String, String> {
    let trimmed: String = raw
        .chars()
        .filter(|c| !c.is_control())
        .collect::<String>()
        .trim()
        .to_string();
    if trimmed.is_empty() {
        return Err("Facet name cannot be empty.".to_string());
    }
    if trimmed.chars().count() > 40 {
        return Err("Facet name is too long (maximum 40 characters).".to_string());
    }
    Ok(trimmed)
}

pub(crate) fn slugify_facet_name(name: &str) -> String {
    let folded = crate::scanner::fold_turkish_to_ascii(name.trim());
    let mut out = String::new();
    let mut prev_sep = false;
    for ch in folded.chars() {
        if ch.is_ascii_alphanumeric() {
            out.push(ch.to_ascii_lowercase());
            prev_sep = false;
        } else if !prev_sep && !out.is_empty() {
            out.push('_');
            prev_sep = true;
        }
    }
    let trimmed = out.trim_matches('_').to_string();
    let base = if trimmed.is_empty() {
        "custom_facet".to_string()
    } else if trimmed.chars().count() > 32 {
        trimmed.chars().take(32).collect::<String>().trim_end_matches('_').to_string()
    } else {
        trimmed
    };
    if RESERVED_FACET_SLUGS.contains(&base.as_str()) {
        format!("custom_{}", base)
    } else {
        base
    }
}

fn generate_unique_facet_slug(conn: &Connection, name: &str) -> String {
    let base = slugify_facet_name(name);
    let mut candidate = base.clone();
    let mut suffix = 2usize;
    loop {
        let exists: bool = conn
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM tag_facets WHERE LOWER(slug) = LOWER(?1))",
                params![candidate],
                |r| r.get(0),
            )
            .unwrap_or(false);
        if !exists && !RESERVED_FACET_SLUGS.contains(&candidate.as_str()) {
            return candidate;
        }
        candidate = format!("{}_{}", base, suffix);
        suffix += 1;
    }
}

pub(crate) fn query_facet_by_id(conn: &Connection, facet_id: i64) -> Result<TagFacet, String> {
    conn.query_row(
        "SELECT id, slug, name, color, sort_order, is_system,
                COALESCE(domain, 'tags'), COALESCE(allow_nesting, 0)
         FROM tag_facets
         WHERE id = ?1",
        params![facet_id],
        |r| {
            Ok(TagFacet {
                id: r.get(0)?,
                slug: r.get(1)?,
                name: r.get(2)?,
                color: r.get(3)?,
                sort_order: r.get(4)?,
                is_system: r.get::<_, i64>(5)? != 0,
                domain: r.get(6)?,
                allow_nesting: r.get::<_, i64>(7)? != 0,
            })
        },
    )
    .map_err(|_| format!("Taxonomy facet {} not found.", facet_id))
}

pub(crate) fn create_tag_facet_with_conn(
    conn: &Connection,
    name: &str,
    domain: &str,
    color: &str,
    allow_nesting: bool,
) -> Result<TagFacet, String> {
    let clean_name = clean_facet_name(name)?;
    let clean_domain = normalize_domain(domain)?;
    let clean_color = if color.trim().is_empty() {
        deterministic_full_spectrum_color(&clean_name)
    } else {
        validate_hex_color(color)?
    };

    let dup_name: bool = conn
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM tag_facets WHERE LOWER(name) = LOWER(?1))",
            params![clean_name],
            |r| r.get(0),
        )
        .unwrap_or(false);
    if dup_name {
        return Err("A facet with that name already exists.".to_string());
    }

    let slug = generate_unique_facet_slug(conn, &clean_name);
    let next_sort: i64 = conn
        .query_row(
            "SELECT COALESCE(MAX(sort_order), 10) + 1 FROM tag_facets",
            [],
            |r| r.get(0),
        )
        .unwrap_or(11);

    conn.execute(
        "INSERT INTO tag_facets (slug, name, color, sort_order, is_system, domain, allow_nesting)
         VALUES (?1, ?2, ?3, ?4, 0, ?5, ?6)",
        params![
            slug,
            clean_name,
            clean_color,
            next_sort,
            clean_domain,
            i64::from(allow_nesting)
        ],
    )
    .map_err(|e| format!("Failed creating custom facet: {}", e))?;

    let new_id = conn.last_insert_rowid();
    query_facet_by_id(conn, new_id)
}

#[tauri::command]
pub async fn create_tag_facet(
    state: State<'_, AppState>,
    name: String,
    domain: String,
    color: String,
    allow_nesting: bool,
) -> Result<TagFacet, String> {
    crate::db::run_write_op(&state, move |conn| {
        create_tag_facet_with_conn(conn, &name, &domain, &color, allow_nesting)
    })
    .await
}

pub(crate) fn update_tag_facet_with_conn(
    conn: &mut Connection,
    facet_id: i64,
    name: Option<String>,
    color: Option<String>,
    allow_nesting: Option<bool>,
) -> Result<TagFacet, String> {
    let existing = query_facet_by_id(conn, facet_id)?;
    if existing.is_system {
        return Err("Built-in system facets cannot be modified.".to_string());
    }

    let next_name = match name {
        Some(raw) => {
            let cleaned = clean_facet_name(&raw)?;
            let conflict: bool = conn
                .query_row(
                    "SELECT EXISTS(SELECT 1 FROM tag_facets WHERE id != ?1 AND LOWER(name) = LOWER(?2))",
                    params![facet_id, cleaned],
                    |r| r.get(0),
                )
                .unwrap_or(false);
            if conflict {
                return Err("Another facet with that name already exists.".to_string());
            }
            cleaned
        }
        None => existing.name.clone(),
    };

    let next_color = match color {
        Some(raw) if !raw.trim().is_empty() => validate_hex_color(&raw)?,
        _ => existing.color.clone(),
    };
    let next_nesting = allow_nesting.unwrap_or(existing.allow_nesting);

    let tx = conn
        .transaction()
        .map_err(|e| format!("Failed starting facet update transaction: {}", e))?;

    tx.execute(
        "UPDATE tag_facets SET name = ?1, color = ?2, allow_nesting = ?3 WHERE id = ?4",
        params![next_name, next_color, i64::from(next_nesting), facet_id],
    )
    .map_err(|e| format!("Failed updating custom facet: {}", e))?;

    // When switching from nested tree -> flat, safely promote nested children to top-level roots.
    if existing.allow_nesting && !next_nesting {
        let nested_ids: Vec<i64> = {
            let mut stmt = tx
                .prepare("SELECT id FROM tags WHERE facet_id = ?1 AND parent_id IS NOT NULL")
                .map_err(|e| e.to_string())?;
            let rows = stmt
                .query_map(params![facet_id], |r| r.get::<_, i64>(0))
                .map_err(|e| e.to_string())?;
            rows.flatten().collect()
        };
        if !nested_ids.is_empty() {
            tx.execute(
                "UPDATE tags SET parent_id = NULL WHERE facet_id = ?1 AND parent_id IS NOT NULL",
                params![facet_id],
            )
            .map_err(|e| format!("Failed flattening facet sub-items: {}", e))?;
            for tid in nested_ids {
                rebuild_subtree_paths(&tx, tid)?;
            }
        }
    }

    tx.commit()
        .map_err(|e| format!("Failed committing facet update: {}", e))?;

    query_facet_by_id(conn, facet_id)
}

#[tauri::command]
pub async fn update_tag_facet(
    state: State<'_, AppState>,
    facet_id: i64,
    name: Option<String>,
    color: Option<String>,
    allow_nesting: Option<bool>,
) -> Result<TagFacet, String> {
    crate::db::run_write_op(&state, move |conn| {
        update_tag_facet_with_conn(conn, facet_id, name, color, allow_nesting)
    })
    .await
}

pub(crate) fn delete_tag_facet_with_conn(
    conn: &mut Connection,
    facet_id: i64,
) -> Result<i64, String> {
    let existing = query_facet_by_id(conn, facet_id)?;
    if existing.is_system {
        return Err("Built-in system facets cannot be deleted.".to_string());
    }

    let fallback_facet_id = if existing.domain == "genres" {
        FACET_GENRE_ID
    } else {
        FACET_CATEGORY_ID
    };

    let tx = conn
        .transaction()
        .map_err(|e| format!("Failed starting facet deletion transaction: {}", e))?;

    let root_ids: Vec<i64> = {
        let mut stmt = tx
            .prepare("SELECT id FROM tags WHERE facet_id = ?1 AND parent_id IS NULL")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![facet_id], |r| r.get::<_, i64>(0))
            .map_err(|e| e.to_string())?;
        rows.flatten().collect()
    };

    let affected_samples: Vec<i64> = if existing.domain == "genres" {
        let mut stmt = tx
            .prepare(
                "SELECT DISTINCT st.sample_id
                 FROM sample_tags st
                 INNER JOIN tags t ON t.id = st.tag_id
                 WHERE t.facet_id = ?1",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![facet_id], |r| r.get::<_, i64>(0))
            .map_err(|e| e.to_string())?;
        rows.flatten().collect()
    } else {
        Vec::new()
    };

    let migrated = tx
        .execute(
            "UPDATE tags SET facet_id = ?1 WHERE facet_id = ?2",
            params![fallback_facet_id, facet_id],
        )
        .map_err(|e| format!("Failed re-homing facet tags: {}", e))? as i64;

    for rid in root_ids {
        rebuild_subtree_paths(&tx, rid)?;
    }

    if !affected_samples.is_empty() {
        sync_primary_genre_for_samples(&tx, &affected_samples)?;
    }

    tx.execute("DELETE FROM tag_facets WHERE id = ?1", params![facet_id])
        .map_err(|e| format!("Failed deleting custom facet: {}", e))?;

    tx.commit()
        .map_err(|e| format!("Failed committing facet deletion: {}", e))?;

    Ok(migrated)
}

#[tauri::command]
pub async fn delete_tag_facet(state: State<'_, AppState>, facet_id: i64) -> Result<i64, String> {
    crate::db::run_write_op(&state, move |conn| delete_tag_facet_with_conn(conn, facet_id)).await
}

pub(crate) fn reorder_tag_facets_with_conn(
    conn: &mut Connection,
    ordered_facet_ids: &[i64],
) -> Result<(), String> {
    if ordered_facet_ids.is_empty() {
        return Ok(());
    }
    if ordered_facet_ids.len() > 200 {
        return Err("Too many facets in reorder request.".to_string());
    }
    let tx = conn
        .transaction()
        .map_err(|e| format!("Failed starting facet reorder transaction: {}", e))?;
    {
        let mut stmt = tx
            .prepare("UPDATE tag_facets SET sort_order = ?1 WHERE id = ?2")
            .map_err(|e| format!("Failed preparing facet reorder: {}", e))?;
        for (idx, &fid) in ordered_facet_ids.iter().enumerate() {
            if fid > 0 {
                let next_order = ((idx as i64) + 1) * 10;
                stmt.execute(params![next_order, fid])
                    .map_err(|e| format!("Failed updating facet sort order: {}", e))?;
            }
        }
    }
    tx.commit()
        .map_err(|e| format!("Failed committing facet reorder: {}", e))
}

#[tauri::command]
pub async fn reorder_tag_facets(
    state: State<'_, AppState>,
    ordered_facet_ids: Vec<i64>,
) -> Result<(), String> {
    crate::db::run_write_op(&state, move |conn| {
        reorder_tag_facets_with_conn(conn, &ordered_facet_ids)
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::taxonomy::tags::create_tag_with_options_conn;
    use crate::db::init_schema_on_conn;

    #[test]
    fn custom_facet_crud_nesting_flattening_and_safe_rehome() {
        let mut conn = Connection::open_in_memory().expect("in-memory sqlite");
        init_schema_on_conn(&conn).expect("init schema");

        // System facets are protected
        assert!(delete_tag_facet_with_conn(&mut conn, FACET_CATEGORY_ID).is_err());
        assert!(update_tag_facet_with_conn(&mut conn, FACET_GENRE_ID, Some("X".into()), None, None).is_err());

        // Create nested custom facet in tags domain
        let mic = create_tag_facet_with_conn(&conn, "Mic Type", "tags", "#0EA5E9", true)
            .expect("create custom facet");
        assert_eq!(mic.slug, "mic_type");
        assert_eq!(mic.domain, "tags");
        assert!(mic.allow_nesting);
        assert!(!mic.is_system);

        let root_mic = create_tag_with_options_conn(
            &conn,
            "Condenser",
            "#0EA5E9",
            Some(&mic.slug),
            None,
            Some(false),
            None,
        )
        .expect("root tag in custom facet");
        let child_mic = create_tag_with_options_conn(
            &conn,
            "Large Diaphragm",
            "",
            Some(&mic.slug),
            Some(root_mic.id),
            Some(true),
            None,
        )
        .expect("child tag in custom nested facet");
        assert_eq!(child_mic.parent_id, Some(root_mic.id));
        assert_ne!(child_mic.effective_color, root_mic.effective_color);

        // Nested sub-genres work natively on built-in `genre` facet (v18 allow_nesting = 1)
        let elec = create_tag_with_options_conn(&conn, "Electronic", "#0EA5E9", Some("genre"), None, Some(false), None)
            .expect("root genre");
        let sub_synth = create_tag_with_options_conn(&conn, "SynthwaveSub", "", Some("genre"), Some(elec.id), Some(true), None)
            .expect("sub-genre");
        assert_eq!(sub_synth.parent_id, Some(elec.id));
        assert_eq!(sub_synth.facet_slug, "genre");

        // Flat Mood facet still rejects nesting
        let mood_root = create_tag_with_options_conn(&conn, "DarkMoodTest", "#EC4899", Some("mood"), None, Some(false), None)
            .expect("mood tag");
        assert!(create_tag_with_options_conn(&conn, "NestedMood", "", Some("mood"), Some(mood_root.id), Some(true), None).is_err());

        // Switching custom facet from Nested -> Flat safely promotes children to root
        let flattened = update_tag_facet_with_conn(&mut conn, mic.id, Some("Mic Rig".into()), None, Some(false))
            .expect("flatten custom facet");
        assert_eq!(flattened.name, "Mic Rig");
        assert!(!flattened.allow_nesting);
        let child_parent: Option<i64> = conn
            .query_row("SELECT parent_id FROM tags WHERE id = ?1", params![child_mic.id], |r| r.get(0))
            .unwrap();
        assert_eq!(child_parent, None);

        // Deleting custom facet safely re-homes tags to Category (zero lost tags)
        let migrated = delete_tag_facet_with_conn(&mut conn, mic.id).expect("delete custom facet");
        assert_eq!(migrated, 2);
        let moved_facet: i64 = conn
            .query_row("SELECT facet_id FROM tags WHERE id = ?1", params![root_mic.id], |r| r.get(0))
            .unwrap();
        assert_eq!(moved_facet, FACET_CATEGORY_ID);
    }

    #[test]
    fn reorder_tag_facets_and_turkish_slug_folding() {
        use crate::taxonomy_catalog::FACET_MOOD_ID;

        let mut conn = Connection::open_in_memory().expect("in-memory sqlite");
        init_schema_on_conn(&conn).expect("init schema");

        let f1 = create_tag_facet_with_conn(&conn, "Çalgı Türü", "genres", "#F59E0B", false)
            .expect("create Turkish facet");
        assert_eq!(f1.slug, "calgi_turu");

        let f2 = create_tag_facet_with_conn(&conn, "Kayıt Dönemi", "genres", "#14B8A6", false)
            .expect("create second Turkish facet");
        assert_eq!(f2.slug, "kayit_donemi");

        reorder_tag_facets_with_conn(&mut conn, &[f2.id, FACET_MOOD_ID, FACET_GENRE_ID, f1.id])
            .expect("reorder facets");

        let s_f2: i64 = conn
            .query_row("SELECT sort_order FROM tag_facets WHERE id = ?1", params![f2.id], |r| r.get(0))
            .unwrap();
        let s_f1: i64 = conn
            .query_row("SELECT sort_order FROM tag_facets WHERE id = ?1", params![f1.id], |r| r.get(0))
            .unwrap();
        assert!(s_f2 < s_f1, "reordered facet f2 must sort before f1");
    }
}
