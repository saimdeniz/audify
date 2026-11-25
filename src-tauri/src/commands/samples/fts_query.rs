use crate::scanner::fold_turkish_to_ascii;
use rusqlite::{params, Connection};
use serde::Deserialize;
use std::sync::OnceLock;

const SFX_THESAURUS_JSON: &str = include_str!("../../../../src/data/sfxThesaurus.json");

#[derive(Deserialize)]
struct RawThesaurusCluster {
    terms: Vec<String>,
}

fn builtin_thesaurus_clusters() -> &'static Vec<Vec<String>> {
    static CLUSTERS: OnceLock<Vec<Vec<String>>> = OnceLock::new();
    CLUSTERS.get_or_init(|| {
        let parsed: Vec<RawThesaurusCluster> =
            serde_json::from_str(SFX_THESAURUS_JSON).unwrap_or_default();
        parsed
            .into_iter()
            .filter_map(|c| {
                let mut group: Vec<String> = Vec::new();
                for raw in c.terms {
                    let folded = fold_turkish_to_ascii(raw.trim());
                    if !folded.is_empty() && !group.contains(&folded) {
                        group.push(folded);
                    }
                }
                if group.len() > 1 {
                    Some(group)
                } else {
                    None
                }
            })
            .collect()
    })
}

fn clean_fts_term(raw: &str) -> String {
    let filtered: String = raw
        .chars()
        .filter(|c| c.is_alphanumeric() || *c == '_' || *c == '-')
        .collect();
    let trimmed = filtered.trim_matches(|c| c == '_' || c == '-');
    if trimmed.chars().any(|c| c.is_alphanumeric()) {
        trimmed.to_lowercase()
    } else {
        String::new()
    }
}

fn is_numeric_range_operator(token: &str) -> bool {
    let lower = token.trim().to_ascii_lowercase();
    let core = lower
        .strip_suffix("bpm")
        .or_else(|| lower.strip_suffix("secs"))
        .or_else(|| lower.strip_suffix("sec"))
        .or_else(|| lower.strip_suffix("ms"))
        .or_else(|| lower.strip_suffix('s'));
    let Some(range_part) = core else {
        return false;
    };
    if !range_part.contains('-') {
        return false;
    }
    let parts: Vec<&str> = range_part
        .split('-')
        .map(|p| p.trim().trim_end_matches("ms").trim_end_matches('s'))
        .collect();
    parts.len() == 2
        && parts
            .iter()
            .all(|p| !p.is_empty() && p.parse::<f64>().is_ok())
}

fn is_smart_search_skip_token(token: &str) -> bool {
    let t = token.trim();
    if t.is_empty() {
        return true;
    }
    if t.eq_ignore_ascii_case("and")
        || t.eq_ignore_ascii_case("not")
        || t == "+"
        || t == "&"
        || t == "&&"
    {
        return true;
    }
    // Preserve numeric dB/take literals like `-12dB` and `#1` as searchable FTS terms
    if let Some(rest) = t.strip_prefix('-') {
        let is_numeric_literal = rest
            .chars()
            .next()
            .map(|c| c.is_ascii_digit())
            .unwrap_or(false);
        if !is_numeric_literal {
            return true;
        }
    }
    if let Some(rest) = t.strip_prefix('#') {
        let is_numeric_literal = rest
            .chars()
            .next()
            .map(|c| c.is_ascii_digit())
            .unwrap_or(false);
        if !is_numeric_literal {
            return true;
        }
    }
    if t.starts_with('!')
        || t.starts_with('<')
        || t.starts_with('>')
        || t.starts_with('@')
        || t.contains(':')
    {
        return true;
    }
    is_numeric_range_operator(t)
}

pub(super) struct FtsSynonymConfig {
    pub(super) use_synonyms: bool,
    pub(super) custom_synonyms: Vec<Vec<String>>,
}

pub(super) fn load_synonym_config(
    conn: &Connection,
    active_profile_id: i64,
) -> FtsSynonymConfig {
    let mut cfg = FtsSynonymConfig {
        use_synonyms: true,
        custom_synonyms: Vec::new(),
    };
    let Ok(settings_json) = conn.query_row::<String, _, _>(
        "SELECT settings_json FROM profiles WHERE id = ?1",
        params![active_profile_id],
        |r| r.get(0),
    ) else {
        return cfg;
    };
    let Ok(val) = serde_json::from_str::<serde_json::Value>(&settings_json) else {
        return cfg;
    };
    if let Some(enabled) = val.get("smartSearchSynonyms").and_then(|v| v.as_bool()) {
        cfg.use_synonyms = enabled;
        if !enabled {
            return cfg;
        }
    }
    let Some(syn_val) = val.get("smartSearchSynonyms") else {
        return cfg;
    };

    let custom = &mut cfg.custom_synonyms;
    if let Some(obj) = syn_val.as_object() {
        for (head, arr_val) in obj {
            let mut group = Vec::new();
            let h = clean_fts_term(head);
            if !h.is_empty() {
                group.push(h);
            }
            if let Some(arr) = arr_val.as_array() {
                for item in arr {
                    if let Some(s) = item.as_str() {
                        let c = clean_fts_term(s);
                        if !c.is_empty() && !group.contains(&c) {
                            group.push(c);
                        }
                    }
                }
            }
            if group.len() > 1 {
                custom.push(group);
            }
        }
    } else if let Some(arr) = syn_val.as_array() {
        for entry in arr {
            let mut group = Vec::new();
            if let Some(inner_arr) = entry.as_array() {
                for item in inner_arr {
                    if let Some(s) = item.as_str() {
                        let c = clean_fts_term(s);
                        if !c.is_empty() && !group.contains(&c) {
                            group.push(c);
                        }
                    }
                }
            } else if let Some(obj) = entry.as_object() {
                for key in ["term", "word", "head"] {
                    if let Some(h) = obj.get(key).and_then(|v| v.as_str()) {
                        let c = clean_fts_term(h);
                        if !c.is_empty() && !group.contains(&c) {
                            group.push(c);
                        }
                    }
                }
                for key in ["synonyms", "words", "terms"] {
                    if let Some(list) = obj.get(key).and_then(|v| v.as_array()) {
                        for item in list {
                            if let Some(s) = item.as_str() {
                                let c = clean_fts_term(s);
                                if !c.is_empty() && !group.contains(&c) {
                                    group.push(c);
                                }
                            }
                        }
                    }
                }
            }
            if group.len() > 1 {
                custom.push(group);
            }
        }
    }
    cfg
}

fn format_fts_variant_expr(raw: &str) -> Option<String> {
    if raw.contains(' ') {
        let parts: Vec<String> = raw
            .split_whitespace()
            .map(clean_fts_term)
            .filter(|p| !p.is_empty())
            .map(|p| format!("\"{}\"*", p))
            .collect();
        if parts.is_empty() {
            None
        } else if parts.len() == 1 {
            Some(parts.into_iter().next().unwrap_or_default())
        } else {
            Some(format!("({})", parts.join(" AND ")))
        }
    } else {
        let c = clean_fts_term(raw);
        if c.is_empty() {
            None
        } else {
            Some(format!("\"{}\"*", c))
        }
    }
}

fn expand_token_to_fts_clause(
    raw_word: &str,
    use_synonyms: bool,
    custom_synonyms: &[Vec<String>],
) -> Option<String> {
    let base = clean_fts_term(raw_word);
    if base.is_empty() {
        return None;
    }
    let folded = clean_fts_term(&fold_turkish_to_ascii(&base));

    const MAX_FTS_VARIANTS_PER_TOKEN: usize = 24;
    let mut variant_exprs: Vec<String> = Vec::new();
    let push_unique = |list: &mut Vec<String>, expr: Option<String>| {
        if list.len() >= MAX_FTS_VARIANTS_PER_TOKEN {
            return;
        }
        if let Some(e) = expr {
            if !e.is_empty() && !list.contains(&e) {
                list.push(e);
            }
        }
    };

    push_unique(&mut variant_exprs, format_fts_variant_expr(&base));
    push_unique(&mut variant_exprs, format_fts_variant_expr(&folded));

    if use_synonyms {
        for cluster in builtin_thesaurus_clusters() {
            if cluster
                .iter()
                .any(|w| w == &base || (!folded.is_empty() && w == &folded))
            {
                for syn in cluster {
                    push_unique(&mut variant_exprs, format_fts_variant_expr(syn));
                }
            }
        }

        for cluster in custom_synonyms {
            if cluster.iter().any(|w| {
                let wf = fold_turkish_to_ascii(w);
                *w == base || wf == base || (!folded.is_empty() && (*w == folded || wf == folded))
            }) {
                for syn in cluster {
                    let cf = fold_turkish_to_ascii(syn);
                    push_unique(&mut variant_exprs, format_fts_variant_expr(syn));
                    push_unique(&mut variant_exprs, format_fts_variant_expr(&cf));
                }
            }
        }
    }

    if variant_exprs.is_empty() {
        None
    } else if variant_exprs.len() == 1 {
        Some(variant_exprs.into_iter().next().unwrap_or_default())
    } else {
        Some(format!("({})", variant_exprs.join(" OR ")))
    }
}

fn tokenize_fts_query_preserving_quotes(input: &str) -> Vec<(String, bool)> {
    let mut tokens: Vec<(String, bool)> = Vec::new();
    let mut chars = input.chars().peekable();
    while let Some(&ch) = chars.peek() {
        if ch.is_whitespace() {
            chars.next();
            continue;
        }
        if ch == '"' {
            chars.next();
            let mut phrase = String::new();
            for next_c in chars.by_ref() {
                if next_c == '"' {
                    break;
                }
                phrase.push(next_c);
            }
            let trimmed = phrase.trim();
            if !trimmed.is_empty() {
                tokens.push((trimmed.to_string(), true));
            }
        } else {
            let mut word = String::new();
            while let Some(&nc) = chars.peek() {
                if nc.is_whitespace() || nc == '"' {
                    break;
                }
                word.push(nc);
                chars.next();
            }
            if !word.is_empty() {
                tokens.push((word, false));
            }
        }
    }
    tokens
}

/// Builds an FTS5 MATCH expression with Turkish `ı`/`İ` folding, Smart Search operator filtering,
/// boolean `OR`/`|` support, quoted exact-match preservation, and optional SFX synonym expansion.
pub(crate) fn build_fts_match_expression(
    raw_query: &str,
    use_synonyms: bool,
    custom_synonyms: &[Vec<String>],
) -> Option<String> {
    let trimmed = raw_query.trim();
    if trimmed.is_empty() {
        return None;
    }

    let mut or_branches: Vec<Vec<String>> = vec![Vec::new()];
    for (raw_tok, is_quoted) in tokenize_fts_query_preserving_quotes(trimmed) {
        if is_quoted {
            // Exact quoted token/phrase: skip synonym expansion!
            let words: Vec<String> = raw_tok
                .split_whitespace()
                .flat_map(|w| {
                    let c = clean_fts_term(w);
                    let f = clean_fts_term(&fold_turkish_to_ascii(&c));
                    if c.is_empty() {
                        None
                    } else if f.is_empty() || f == c {
                        Some(format!("\"{}\"*", c))
                    } else {
                        Some(format!("(\"{}\"* OR \"{}\"*)", c, f))
                    }
                })
                .collect();
            if !words.is_empty() {
                let exact_clause = if words.len() == 1 {
                    words.into_iter().next().unwrap_or_default()
                } else {
                    format!("({})", words.join(" AND "))
                };
                if let Some(last) = or_branches.last_mut() {
                    last.push(exact_clause);
                }
            }
            continue;
        }

        if raw_tok.eq_ignore_ascii_case("or") || raw_tok == "|" || raw_tok == "||" {
            if !or_branches.last().map(|b| b.is_empty()).unwrap_or(true) {
                or_branches.push(Vec::new());
            }
            continue;
        }

        if raw_tok.contains('|') && !raw_tok.contains(':') {
            let sub_parts: Vec<&str> = raw_tok
                .split('|')
                .map(|s| s.trim())
                .filter(|s| !s.is_empty())
                .collect();
            if sub_parts.len() > 1 {
                let mut pipe_terms = Vec::new();
                for sp in sub_parts {
                    if !is_smart_search_skip_token(sp) {
                        if let Some(expanded) =
                            expand_token_to_fts_clause(sp, use_synonyms, custom_synonyms)
                        {
                            pipe_terms.push(expanded);
                        }
                    }
                }
                if !pipe_terms.is_empty() {
                    let combined = format!("({})", pipe_terms.join(" OR "));
                    if let Some(last) = or_branches.last_mut() {
                        last.push(combined);
                    }
                }
                continue;
            }
        }

        if is_smart_search_skip_token(&raw_tok) {
            continue;
        }
        if let Some(expanded) =
            expand_token_to_fts_clause(&raw_tok, use_synonyms, custom_synonyms)
        {
            if let Some(last) = or_branches.last_mut() {
                last.push(expanded);
            }
        }
    }

    let rendered_branches: Vec<String> = or_branches
        .into_iter()
        .filter(|b| !b.is_empty())
        .map(|b| {
            if b.len() == 1 {
                b.into_iter().next().unwrap_or_default()
            } else {
                format!("({})", b.join(" AND "))
            }
        })
        .collect();

    if rendered_branches.is_empty() {
        None
    } else if rendered_branches.len() == 1 {
        Some(rendered_branches.into_iter().next().unwrap_or_default())
    } else {
        Some(rendered_branches.join(" OR "))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn smart_search_synonyms_false_disables_thesaurus_expansion() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE profiles (id INTEGER PRIMARY KEY, settings_json TEXT NOT NULL);",
        )
        .unwrap();
        conn.execute(
            "INSERT INTO profiles (id, settings_json) VALUES (1, '{\"smartSearchSynonyms\":false}')",
            [],
        )
        .unwrap();

        let cfg = load_synonym_config(&conn, 1);
        assert!(!cfg.use_synonyms);
        let strict_expr =
            build_fts_match_expression("hit", cfg.use_synonyms, &cfg.custom_synonyms).unwrap();
        assert_eq!(strict_expr, "\"hit\"*");

        let expanded_expr = build_fts_match_expression("hit", true, &[]).unwrap();
        assert!(
            expanded_expr.contains("impact"),
            "expected synonym expansion when enabled, got {}",
            expanded_expr
        );
    }
}
