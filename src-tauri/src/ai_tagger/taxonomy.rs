use crate::db::taxonomy::facet_domain_in_db;
use crate::db::{
    deterministic_color_for_name, ensure_taxonomy_tag, sync_primary_genre_for_samples,
};
use crate::taxonomy_catalog::lookup_canonical_by_name;
use rusqlite::{params, Connection};
use std::collections::{HashMap, HashSet};

#[cfg(test)]
const YAMNET_CLASS_MAP_CSV: &str = include_str!("yamnet_class_map.csv");

#[derive(Debug, Clone)]
pub struct MappedAiTag {
    pub tag_name: String,
    pub confidence: f32,
}

#[cfg(test)]
pub fn yamnet_class_label(idx: usize) -> Option<&'static str> {
    raw_yamnet_labels().get(idx).map(String::as_str)
}

#[cfg(test)]
fn raw_yamnet_labels() -> &'static Vec<String> {
    static LABELS: std::sync::OnceLock<Vec<String>> = std::sync::OnceLock::new();
    LABELS.get_or_init(|| {
        let mut out = Vec::with_capacity(521);
        for line in YAMNET_CLASS_MAP_CSV.lines().skip(1) {
            let trimmed = line.trim();
            if trimmed.is_empty() {
                continue;
            }
            let mut parts = trimmed.splitn(3, ',');
            let _idx = parts.next();
            let _mid = parts.next();
            if let Some(display) = parts.next() {
                out.push(display.trim().trim_matches('"').to_string());
            }
        }
        out
    })
}

/// Maps all 521 AudioSet/YAMNet class indices directly into Audify's fine 2-level taxonomy
/// (Category sub-tags, Genres, and Moods). Suppresses uninformative silence/room/broad filler classes
/// so broad buckets like `Animals` or `Music` never bloat the library.
pub fn map_audioset_class_to_audify_tag(class_idx: usize) -> Option<&'static str> {
    match class_idx {
        // Silence / generic recording artifacts / overly broad parent buckets to suppress
        67 | 68 | 494 | 498 | 500..=502 | 507 | 508 | 518..=520 => None,

        // Speech & Human Vocal (unified under `Vocal` — no more Vocal/Voice duplication)
        0..=45 | 249..=250 => Some("Vocal"),

        // Footsteps & Body / Crowd Foley
        46..=48 => Some("Footsteps"),
        49..=55 => Some("Foley"),
        56..=66 => Some("Body & Crowd"),

        // Fine 2-level Animals species (parent: `Animals`)
        69..=75 | 117 => Some("Dog"),
        76..=80 => Some("Cat"),
        82..=84 => Some("Horse"),
        104..=105 => Some("Monster"),
        106..=116 => Some("Bird"),
        121..=126 => Some("Insect"),
        81 | 85..=103 | 118..=120 | 127..=131 => Some("Wildlife"),

        // Musical Instruments (parent: `Voice & Music`)
        132..=134 => Some("Music"),
        135..=136 | 138..=146 => Some("Guitar"),
        137 | 189 => Some("Bass"),
        147..=152 | 155 => Some("Piano"),
        153..=154 => Some("Synth"),
        156..=178 => Some("Drums"),
        179..=188 | 190..=194 => Some("Orchestra"),
        195..=202 | 209 => Some("Bell"),
        203..=208 => Some("Music"),

        // Music Genres & Moods (`210..=276` routed directly to `Genre` & `Mood` facets!)
        211 | 231 | 269 => Some("Pop"),
        212..=213 => Some("Hip-Hop"),
        214..=220 => Some("Rock"),
        221..=223 | 225 | 227 | 230 | 246 => Some("Jazz"),
        224 | 226 | 228 => Some("Acoustic"),
        232..=233 => Some("Classical"),
        234..=240 | 242 => Some("Electronic"),
        241 | 248 => Some("Ambient"),
        262..=265 | 267 => Some("Soundtrack"),
        271 => Some("Upbeat"),
        272..=273 => Some("Sad"),
        274..=275 => Some("Action"),
        276 => Some("Horror"),
        210 | 229 | 243..=245 | 247 | 251..=261 | 266 | 268 | 270 => Some("Music"),

        // Nature, Weather, Water, Fire (parent: `Nature & Ambience`)
        277..=281 => Some("Weather"),
        282..=291 | 438..=450 => Some("Water"),
        292..=293 | 484 => Some("Fire"),

        // Vehicles, Alarms & Mechanical (parent: `Sci-Fi & Tech`)
        294..=347 => Some("Vehicles"),
        382..=397 => Some("Alarm"),
        398..=419 | 479 | 487 => Some("Mechanical"),

        // Foley Sub-materials (parent: `Foley`)
        348..=357 => Some("Door"),
        358..=359 | 373..=375 | 478 => Some("Metal"),
        372 | 473..=474 | 481 => Some("Cloth"),
        431..=434 => Some("Wood"),
        435..=437 => Some("Glass"),
        360..=371 | 376..=381 | 459 | 468..=472 | 480 | 482..=483 | 488..=493 => Some("Foley"),

        // Action & Combat (parent: `Action & Combat`)
        420 | 426..=430 => Some("Explosion"),
        421..=425 => Some("Gunshot"),
        452..=453 | 466..=467 => Some("Whoosh"),
        454..=455 | 460..=465 => Some("Impact"),

        // UI, Synth, Ambience & Noise
        451 | 475..=477 | 485..=486 => Some("UI"),
        456..=458 | 495..=497 | 499 => Some("Synth"),
        503..=506 => Some("Ambience"),
        509..=517 => Some("Noise"),

        _ => None,
    }
}

/// Converts raw 521-class model predictions into up to `max_tags` deduplicated Audify tags
/// passing `min_confidence` (`0.0..=1.0`) with calibrated activation floor (`0.58x`).
pub fn extract_mapped_tags_from_scores(
    class_scores: &[f32],
    min_confidence: f32,
    max_tags: usize,
) -> Vec<MappedAiTag> {
    if class_scores.is_empty() || max_tags == 0 {
        return Vec::new();
    }

    let clamped_min = min_confidence.clamp(0.25, 0.98);
    let effective_floor = (clamped_min * 0.58).clamp(0.18, 0.72);

    let mut best_by_tag: HashMap<String, f32> = HashMap::new();

    for (idx, &raw_score) in class_scores.iter().enumerate() {
        if !raw_score.is_finite() || raw_score < effective_floor {
            continue;
        }
        let Some(tag) = map_audioset_class_to_audify_tag(idx) else {
            continue;
        };
        let display_conf = (raw_score / 0.62).min(0.99);
        let entry = best_by_tag.entry(tag.to_string()).or_insert(0.0);
        if display_conf > *entry {
            *entry = display_conf;
        }
    }

    let mut ranked: Vec<MappedAiTag> = best_by_tag
        .into_iter()
        .filter(|(_, conf)| *conf >= clamped_min)
        .map(|(tag_name, confidence)| MappedAiTag {
            tag_name,
            confidence,
        })
        .collect();

    ranked.sort_by(|a, b| {
        b.confidence
            .partial_cmp(&a.confidence)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| a.tag_name.cmp(&b.tag_name))
    });
    ranked.truncate(max_tags);
    ranked
}

fn resolve_or_create_ai_tag_id(conn: &Connection, tag_name: &str) -> Result<i64, String> {
    if let Ok(id) = conn.query_row::<i64, _, _>(
        "SELECT id FROM tags WHERE LOWER(name) = LOWER(?1) LIMIT 1",
        [tag_name],
        |r| r.get(0),
    ) {
        return Ok(id);
    }

    // Use full taxonomy helper when v17 columns exist, with fallback for minimal unit-test tables.
    if let Ok(id) = ensure_taxonomy_tag(conn, tag_name, None, None, None, false) {
        return Ok(id);
    }

    let color = lookup_canonical_by_name(tag_name)
        .map(|s| s.color)
        .unwrap_or_else(|| deterministic_color_for_name(tag_name));
    conn.execute(
        "INSERT INTO tags (name, color, is_manual) VALUES (?1, ?2, 0)",
        params![tag_name, color],
    )
    .map_err(|e| e.to_string())?;
    Ok(conn.last_insert_rowid())
}

/// Persists AI tag outputs for one sample inside an active SQLite transaction while strictly
/// protecting manual user tags (`is_manual = 1`) and previously `dismissed` suggestions.
pub fn persist_ai_tags_for_sample(
    conn: &Connection,
    sample_id: i64,
    model_id: &str,
    mapped: &[MappedAiTag],
    auto_apply: bool,
) -> Result<(usize, usize), String> {
    let existing_tags: HashSet<String> = {
        let mut stmt = conn
            .prepare_cached(
                "SELECT LOWER(t.name)
                 FROM sample_tags st
                 JOIN tags t ON t.id = st.tag_id
                 WHERE st.sample_id = ?1",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([sample_id], |r| r.get::<_, String>(0))
            .map_err(|e| e.to_string())?;
        rows.flatten().collect()
    };

    let dismissed: HashSet<String> = {
        let mut stmt = conn
            .prepare_cached(
                "SELECT LOWER(tag_name)
                 FROM ai_tag_suggestions
                 WHERE sample_id = ?1 AND model_id = ?2 AND status = 'dismissed'",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![sample_id, model_id], |r| r.get::<_, String>(0))
            .map_err(|e| e.to_string())?;
        rows.flatten().collect()
    };

    let mut suggestions_added = 0usize;
    let mut tags_applied = 0usize;
    let mut touched_genre_or_mood = false;

    for item in mapped {
        let lower = item.tag_name.to_lowercase();
        if existing_tags.contains(&lower) || dismissed.contains(&lower) {
            continue;
        }

        if auto_apply {
            let tag_id = resolve_or_create_ai_tag_id(conn, &item.tag_name)?;
            let inserted = {
                let mut ins_st = conn
                    .prepare_cached(
                        "INSERT OR IGNORE INTO sample_tags (sample_id, tag_id, is_manual, source) VALUES (?1, ?2, 0, 'ai_auto')",
                    )
                    .map_err(|e| format!("Failed inserting auto AI tag: {}", e))?;
                ins_st
                    .execute(params![sample_id, tag_id])
                    .map_err(|e| format!("Failed inserting auto AI tag: {}", e))?
            };
            if inserted > 0 {
                tags_applied += 1;
                if let Ok(fid) = conn.query_row::<i64, _, _>(
                    "SELECT COALESCE(facet_id, 1) FROM tags WHERE id = ?1",
                    params![tag_id],
                    |r| r.get(0),
                ) {
                    if facet_domain_in_db(conn, fid) == "genres" {
                        touched_genre_or_mood = true;
                    }
                }
            }
            let mut ins_app = conn
                .prepare_cached(
                    "INSERT INTO ai_tag_suggestions (sample_id, tag_name, confidence, model_id, status)
                     VALUES (?1, ?2, ?3, ?4, 'approved')
                     ON CONFLICT(sample_id, tag_name) DO UPDATE SET
                         confidence = excluded.confidence,
                         model_id = excluded.model_id,
                         status = CASE WHEN ai_tag_suggestions.status = 'dismissed' THEN 'dismissed' ELSE 'approved' END",
                )
                .map_err(|e| format!("Failed recording approved AI suggestion: {}", e))?;
            ins_app
                .execute(params![sample_id, item.tag_name, item.confidence, model_id])
                .map_err(|e| format!("Failed recording approved AI suggestion: {}", e))?;
        } else {
            let mut ins_pend = conn
                .prepare_cached(
                    "INSERT INTO ai_tag_suggestions (sample_id, tag_name, confidence, model_id, status)
                     VALUES (?1, ?2, ?3, ?4, 'pending')
                     ON CONFLICT(sample_id, tag_name) DO UPDATE SET
                         confidence = excluded.confidence,
                         model_id = excluded.model_id
                     WHERE ai_tag_suggestions.status = 'pending'",
                )
                .map_err(|e| format!("Failed recording pending AI suggestion: {}", e))?;
            let affected = ins_pend
                .execute(params![sample_id, item.tag_name, item.confidence, model_id])
                .map_err(|e| format!("Failed recording pending AI suggestion: {}", e))?;
            if affected > 0 {
                suggestions_added += 1;
            }
        }
    }

    if touched_genre_or_mood {
        let _ = sync_primary_genre_for_samples(conn, &[sample_id]);
    }

    Ok((suggestions_added, tags_applied))
}
