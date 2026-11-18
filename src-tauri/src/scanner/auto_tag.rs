use super::ucs_rules::{
    extract_stem_and_near_folders, extract_ucs_cat_id, fold_turkish_to_ascii,
    parse_duration_directive, tokenize_audio_identifier,
};
use crate::db::{AutoTagCategoryConfig, AutoTagRule};
use std::collections::{HashMap, HashSet};

fn single_keyword_matches_target(
    kw_clean: &str,
    lower_stem: &str,
    folded_stem: &str,
    lower_parent: &str,
    folded_parent: &str,
    name_tokens: &HashSet<String>,
    folder_tokens: &HashSet<String>,
) -> bool {
    let kw = kw_clean.trim();
    if kw.is_empty() {
        return false;
    }
    let kw_lower = kw.to_lowercase();
    let kw_folded = fold_turkish_to_ascii(&kw_lower);

    if kw_lower.contains(|c: char| !c.is_alphanumeric()) {
        let kw_parts: Vec<&str> = kw_lower
            .split(|c: char| !c.is_alphanumeric())
            .filter(|s| !s.is_empty())
            .collect();
        if kw_parts.is_empty() {
            return false;
        }
        let joined_compact = kw_parts.join("");
        let joined_folded = fold_turkish_to_ascii(&joined_compact);
        if name_tokens.contains(&joined_compact)
            || name_tokens.contains(&joined_folded)
            || folder_tokens.contains(&joined_compact)
            || folder_tokens.contains(&joined_folded)
        {
            return true;
        }
        if kw_parts.iter().all(|p| {
            let folded_p = fold_turkish_to_ascii(p);
            name_tokens.contains(*p) || name_tokens.contains(&folded_p)
        }) || kw_parts.iter().all(|p| {
            let folded_p = fold_turkish_to_ascii(p);
            folder_tokens.contains(*p) || folder_tokens.contains(&folded_p)
        }) {
            return true;
        }
        return lower_stem.contains(&kw_lower)
            || folded_stem.contains(&kw_folded)
            || lower_parent.contains(&kw_lower)
            || folded_parent.contains(&kw_folded);
    }

    if kw.chars().count() <= 4 {
        return name_tokens.contains(&kw_lower)
            || name_tokens.contains(&kw_folded)
            || folder_tokens.contains(&kw_lower)
            || folder_tokens.contains(&kw_folded);
    }

    if name_tokens.contains(&kw_lower)
        || name_tokens.contains(&kw_folded)
        || folder_tokens.contains(&kw_lower)
        || folder_tokens.contains(&kw_folded)
    {
        return true;
    }
    if name_tokens.iter().any(|t| {
        (t.len() >= kw_lower.len() && t.starts_with(&kw_lower))
            || (t.len() >= kw_folded.len() && t.starts_with(&kw_folded))
    }) || folder_tokens.iter().any(|t| {
        (t.len() >= kw_lower.len() && t.starts_with(&kw_lower))
            || (t.len() >= kw_folded.len() && t.starts_with(&kw_folded))
    }) {
        return true;
    }

    lower_stem.contains(&kw_lower) || folded_stem.contains(&kw_folded)
}

fn path_matches_filter(lower_file_path: &str, filter: &str) -> bool {
    let clean = filter.trim();
    if clean.is_empty() {
        return false;
    }
    let norm = clean.replace('/', "\\").to_lowercase();
    if lower_file_path.contains(&norm) {
        return true;
    }
    if let Some(pos) = norm.find(':') {
        let without_drive = &norm[pos + 1..];
        let trimmed = without_drive.trim_start_matches('\\');
        if !trimmed.is_empty() && lower_file_path.contains(trimmed) {
            return true;
        }
    }
    false
}

pub fn match_auto_tags(
    file_path: &str,
    file_name: &str,
    duration_ms: i64,
    is_loop: bool,
    rules: &[AutoTagRule],
    categories: &HashMap<String, AutoTagCategoryConfig>,
) -> Vec<String> {
    let mut matched = HashSet::new();
    let lower_path = file_path.replace('/', "\\").to_lowercase();
    let (raw_stem, raw_parent, raw_grandparent) =
        extract_stem_and_near_folders(file_path, file_name);
    let lower_stem = raw_stem.to_lowercase();
    let lower_parent = raw_parent.to_lowercase();

    let folded_stem = fold_turkish_to_ascii(&lower_stem);
    let folded_parent = fold_turkish_to_ascii(&lower_parent);

    let name_tokens = tokenize_audio_identifier(&raw_stem);
    let mut folder_tokens = tokenize_audio_identifier(&raw_parent);
    for t in tokenize_audio_identifier(&raw_grandparent) {
        folder_tokens.insert(t);
    }

    let ucs_cat_id = extract_ucs_cat_id(file_name);

    for rule in rules {
        if !rule.enabled {
            continue;
        }

        let cat_cfg = rule.category.as_ref().and_then(|cat_name| {
            let lower = cat_name.trim().to_lowercase();
            categories.get(&lower).or_else(|| categories.get(cat_name))
        });

        // Exclude Scope: union of Category exclusions and Rule exclusions.
        let cat_excluded = cat_cfg.is_some_and(|cfg| {
            cfg.exclude_paths
                .iter()
                .any(|p| path_matches_filter(&lower_path, p))
                || cfg
                    .rel_exclude_paths
                    .iter()
                    .any(|p| path_matches_filter(&lower_path, p))
        });
        let rule_excluded = rule.exclude_paths.as_ref().is_some_and(|exc| {
            exc.iter().any(|p| path_matches_filter(&lower_path, p))
        }) || rule
            .rel_exclude_paths
            .iter()
            .any(|p| path_matches_filter(&lower_path, p));
        if cat_excluded || rule_excluded {
            continue;
        }

        // Include Scope: Rule include_paths overrides Category include_paths when non-empty;
        // otherwise inherit Category include_paths when present.
        let rule_inc = rule.include_paths.as_deref().unwrap_or(&[]);
        if !rule_inc.is_empty() || !rule.rel_include_paths.is_empty() {
            let matches_rule_inc = rule_inc
                .iter()
                .any(|p| path_matches_filter(&lower_path, p))
                || rule
                    .rel_include_paths
                    .iter()
                    .any(|p| path_matches_filter(&lower_path, p));
            if !matches_rule_inc {
                continue;
            }
        } else if let Some(cfg) = cat_cfg {
            if !cfg.include_paths.is_empty() || !cfg.rel_include_paths.is_empty() {
                let matches_cat_inc = cfg
                    .include_paths
                    .iter()
                    .any(|p| path_matches_filter(&lower_path, p))
                    || cfg
                        .rel_include_paths
                        .iter()
                        .any(|p| path_matches_filter(&lower_path, p));
                if !matches_cat_inc {
                    continue;
                }
            }
        }

        let mut has_duration_constraint =
            rule.min_duration_ms.is_some() || rule.max_duration_ms.is_some();
        for kw in &rule.keywords {
            if parse_duration_directive(kw).is_some() {
                has_duration_constraint = true;
                break;
            }
        }

        if duration_ms > 0 {
            if let Some(min_ms) = rule.min_duration_ms {
                if duration_ms < min_ms {
                    continue;
                }
            }
            if let Some(max_ms) = rule.max_duration_ms {
                if duration_ms > max_ms {
                    continue;
                }
            }
            let mut dur_mismatch = false;
            for kw in &rule.keywords {
                if let Some((min_opt, max_opt)) = parse_duration_directive(kw) {
                    if let Some(min) = min_opt {
                        if duration_ms < min {
                            dur_mismatch = true;
                            break;
                        }
                    }
                    if let Some(max) = max_opt {
                        if duration_ms > max {
                            dur_mismatch = true;
                            break;
                        }
                    }
                }
            }
            if dur_mismatch {
                continue;
            }
        }

        let mut blocked_by_negative = false;
        for kw in &rule.keywords {
            let trimmed = kw.trim();
            if let Some(neg_kw) = trimmed
                .strip_prefix('!')
                .or_else(|| trimmed.strip_prefix('-'))
            {
                let neg_clean = neg_kw.trim();
                if !neg_clean.is_empty()
                    && single_keyword_matches_target(
                        neg_clean,
                        &lower_stem,
                        &folded_stem,
                        &lower_parent,
                        &folded_parent,
                        &name_tokens,
                        &folder_tokens,
                    )
                {
                    blocked_by_negative = true;
                    break;
                }
            }
        }
        if blocked_by_negative {
            continue;
        }

        if let Some(ucs_tag) = ucs_cat_id {
            if rule.tag_name.eq_ignore_ascii_case(ucs_tag) {
                matched.insert(rule.tag_name.clone());
                continue;
            }
        }

        let mut has_positive_keyword = false;
        for kw in &rule.keywords {
            let kw_trim = kw.trim();
            if kw_trim.is_empty()
                || kw_trim.starts_with('!')
                || kw_trim.starts_with('-')
                || kw_trim.starts_with('@')
            {
                continue;
            }
            has_positive_keyword = true;

            if kw_trim.contains('+') {
                let parts: Vec<&str> = kw_trim
                    .split('+')
                    .map(|p| p.trim())
                    .filter(|p| !p.is_empty())
                    .collect();
                if !parts.is_empty()
                    && parts.iter().all(|part| {
                        single_keyword_matches_target(
                            part,
                            &lower_stem,
                            &folded_stem,
                            &lower_parent,
                            &folded_parent,
                            &name_tokens,
                            &folder_tokens,
                        )
                    })
                {
                    matched.insert(rule.tag_name.clone());
                    break;
                }
            } else if single_keyword_matches_target(
                kw_trim,
                &lower_stem,
                &folded_stem,
                &lower_parent,
                &folded_parent,
                &name_tokens,
                &folder_tokens,
            ) {
                matched.insert(rule.tag_name.clone());
                break;
            }
        }
        if !has_positive_keyword && has_duration_constraint && duration_ms > 0 {
            matched.insert(rule.tag_name.clone());
        }
    }

    if is_loop {
        matched.insert("Loop".to_string());
    }

    let mut out: Vec<String> = matched.into_iter().collect();
    out.sort();
    out
}

