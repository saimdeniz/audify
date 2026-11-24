use crate::db::deterministic_color_for_name;
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
            // Format: index,mid,display_name (possibly quoted)
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

/// Maps AudioSet class indices into crisp Audify SFX/production tags aligned with
/// `default_auto_tag_rules`. Returns `None` for uninformative room/silence filler classes.
pub fn map_audioset_class_to_audify_tag(class_idx: usize) -> Option<&'static str> {
    match class_idx {
        // Silence / generic recording artifacts to suppress
        494 | 498 | 500..=502 | 507 | 508 | 518..=520 => None,

        // Speech & Human Vocal
        0..=5 => Some("Vocal"),
        6..=12 => Some("Vocal"),
        13..=18 => Some("Voice"),
        19..=23 => Some("Voice"),
        24..=32 => Some("Vocal"),
        33..=45 => Some("Voice"),

        // Footsteps & Body Foley
        46..=48 => Some("Footsteps"),
        49..=55 => Some("Foley"),
        56..=58 => Some("Clap"),
        59..=60 => Some("Heartbeat"),
        61..=66 => Some("Crowd"),

        // Creatures & Animals
        67..=131 => Some("Animals"),

        // Musical Categories & Instruments
        132..=134 => Some("Music"),
        135..=136 | 138..=146 => Some("Guitar"),
        137 | 189 => Some("Bass"),
        147..=152 | 155 => Some("Piano"),
        153..=154 => Some("Synth"),
        156..=159 | 161..=162 | 164..=165 => Some("Drums"),
        160 => Some("Snare"),
        163 => Some("Kick"),
        166 | 172 => Some("Cymbal"),
        167 => Some("Hi-Hat"),
        168..=171 | 173..=178 => Some("Percussion"),
        179..=188 | 190..=194 => Some("Orchestra"),
        195..=202 | 209 => Some("Bell"),
        203..=208 => Some("Instrument"),
        210..=276 => Some("Music"),

        // Nature, Weather, Water, Fire
        277..=281 => Some("Weather"),
        282..=291 | 438..=450 => Some("Water"),
        292..=293 | 484 => Some("Fire"),

        // Vehicles & Mechanical
        294..=347 => Some("Vehicles"),
        348..=381 => Some("Foley"),
        382..=397 => Some("Alarm"),
        398..=419 => Some("Mechanical"),

        // Combat, Weapons, Explosion
        420 | 426..=430 => Some("Explosion"),
        421..=425 => Some("Weapons"),

        // Wood, Glass & Material Impacts
        431..=434 => Some("Wood"),
        435..=437 => Some("Glass"),

        // Whoosh, Impact & Transitions
        451 | 475..=477 | 485..=486 => Some("UI"),
        452..=453 | 466..=467 => Some("Whoosh"),
        454..=455 | 460..=465 => Some("Impact"),
        456..=458 | 495..=497 | 499 => Some("Synth"),
        459 => Some("Foley"),
        468..=474 | 480..=483 | 488..=493 => Some("Foley"),
        478..=479 | 487 => Some("Mechanical"),
        503..=506 => Some("Ambience"),
        509..=517 => Some("Noise"),

        _ => None,
    }
}

/// Converts raw 521-class model predictions into up to `max_tags` deduplicated Audify tags
/// passing `min_confidence` (`0.0..=1.0`).
pub fn extract_mapped_tags_from_scores(
    class_scores: &[f32],
    min_confidence: f32,
    max_tags: usize,
) -> Vec<MappedAiTag> {
    if class_scores.is_empty() || max_tags == 0 {
        return Vec::new();
    }

    // Calibrated threshold: AudioSet softmax/sigmoid scores distribute across siblings, so we map
    // UI slider percentage (e.g. 0.72) monotonically onto effective YAMNet activation floor.
    let effective_floor = (min_confidence.clamp(0.25, 0.98) * 0.42).clamp(0.10, 0.65);

    let mut best_by_tag: HashMap<String, f32> = HashMap::new();

    for (idx, &raw_score) in class_scores.iter().enumerate() {
        if !raw_score.is_finite() || raw_score <= 0.0 {
            continue;
        }
        // Normalize raw YAMNet activation to user-facing 0..1 confidence scale
        let display_conf = (raw_score / 0.55).min(0.99);
        if raw_score < effective_floor {
            continue;
        }
        let Some(tag) = map_audioset_class_to_audify_tag(idx) else {
            continue;
        };
        let mapped_name = tag.to_string();

        let entry = best_by_tag.entry(mapped_name).or_insert(0.0);
        if display_conf > *entry {
            *entry = display_conf;
        }
    }

    let mut ranked: Vec<MappedAiTag> = best_by_tag
        .into_iter()
        .filter(|(_, conf)| *conf >= min_confidence.clamp(0.25, 0.98))
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

    for item in mapped {
        let lower = item.tag_name.to_lowercase();
        if existing_tags.contains(&lower) || dismissed.contains(&lower) {
            continue;
        }

        if auto_apply {
            let tag_id: i64 = {
                let mut find_tag = conn
                    .prepare_cached("SELECT id FROM tags WHERE LOWER(name) = LOWER(?1) LIMIT 1")
                    .map_err(|e| e.to_string())?;
                match find_tag.query_row([&item.tag_name], |r| r.get(0)) {
                    Ok(id) => id,
                    Err(_) => {
                        let color = deterministic_color_for_name(&item.tag_name);
                        let mut ins_tag = conn
                            .prepare_cached(
                                "INSERT INTO tags (name, color, is_manual) VALUES (?1, ?2, 0)",
                            )
                            .map_err(|e| e.to_string())?;
                        ins_tag
                            .execute(params![item.tag_name, color])
                            .map_err(|e| e.to_string())?;
                        conn.last_insert_rowid()
                    }
                }
            };
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

    Ok((suggestions_added, tags_applied))
}
