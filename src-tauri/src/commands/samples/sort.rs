/// Builds a safe, allowlisted SQLite `ORDER BY` clause that mirrors frontend
/// `applySort` (`src/utils/catalogFilterCore.ts`) so Stage 1 `LIMIT 150` startup
/// queries return the exact top visible rows of the full sorted library.
///
/// Returns `(order_by_sql, is_default_filename_asc)` so the caller only activates
/// the `idx_samples_file_name` `+library_id` fast path when ordering by default
/// ascending `file_name`.
pub(crate) fn build_samples_order_by_sql(
    sort_key: Option<&str>,
    sort_dir: Option<&str>,
    using_fts: bool,
    want_trashed: bool,
) -> (String, bool) {
    if using_fts {
        return (
            " ORDER BY bm25(samples_fts), s.file_name COLLATE NOCASE ASC".to_string(),
            false,
        );
    }
    if want_trashed {
        return (
            " ORDER BY s.trashed_at DESC, s.file_name COLLATE NOCASE ASC".to_string(),
            false,
        );
    }

    let dir = match sort_dir.map(str::trim) {
        Some(d) if d.eq_ignore_ascii_case("desc") => "DESC",
        _ => "ASC",
    };

    match sort_key.map(str::trim) {
        None | Some("") | Some("match") => (
            " ORDER BY s.file_name COLLATE NOCASE ASC".to_string(),
            true,
        ),
        Some("name") => (
            format!(" ORDER BY s.file_name COLLATE NOCASE {}", dir),
            dir == "ASC",
        ),
        Some("class") => (
            format!(" ORDER BY s.is_loop {}, s.file_name COLLATE NOCASE ASC", dir),
            false,
        ),
        Some("artist") => (
            format!(
                " ORDER BY CASE WHEN TRIM(COALESCE(s.artist, '')) = '' THEN 1 ELSE 0 END ASC, \
                 TRIM(COALESCE(s.artist, '')) COLLATE NOCASE {}, s.file_name COLLATE NOCASE ASC",
                dir
            ),
            false,
        ),
        Some("album") => (
            format!(
                " ORDER BY CASE WHEN TRIM(COALESCE(s.album, '')) = '' THEN 1 ELSE 0 END ASC, \
                 TRIM(COALESCE(s.album, '')) COLLATE NOCASE {}, s.file_name COLLATE NOCASE ASC",
                dir
            ),
            false,
        ),
        Some("year") => (
            format!(
                " ORDER BY CASE WHEN TRIM(COALESCE(s.year, '')) = '' THEN 1 ELSE 0 END ASC, \
                 CAST(TRIM(COALESCE(s.year, '')) AS INTEGER) {}, \
                 TRIM(COALESCE(s.year, '')) COLLATE NOCASE {}, s.file_name COLLATE NOCASE ASC",
                dir, dir
            ),
            false,
        ),
        Some("genre") => (
            format!(
                " ORDER BY CASE WHEN TRIM(COALESCE(s.genre, '')) = '' THEN 1 ELSE 0 END ASC, \
                 TRIM(COALESCE(s.genre, '')) COLLATE NOCASE {}, s.file_name COLLATE NOCASE ASC",
                dir
            ),
            false,
        ),
        Some("bpm") => (
            format!(
                " ORDER BY CASE WHEN s.bpm IS NULL OR s.bpm <= 0 THEN 1 ELSE 0 END ASC, \
                 CASE WHEN s.bpm IS NULL OR s.bpm <= 0 THEN NULL ELSE s.bpm END {}, \
                 s.file_name COLLATE NOCASE ASC",
                dir
            ),
            false,
        ),
        Some("key") => (
            format!(
                " ORDER BY CASE WHEN TRIM(COALESCE(NULLIF(s.camelot_key, ''), s.musical_key, '')) = '' THEN 1 ELSE 0 END ASC, \
                 CAST(TRIM(COALESCE(NULLIF(s.camelot_key, ''), s.musical_key, '')) AS INTEGER) {}, \
                 TRIM(COALESCE(NULLIF(s.camelot_key, ''), s.musical_key, '')) COLLATE NOCASE {}, \
                 s.file_name COLLATE NOCASE ASC",
                dir, dir
            ),
            false,
        ),
        Some("duration") => (
            format!(
                " ORDER BY s.duration_ms {}, s.file_name COLLATE NOCASE ASC",
                dir
            ),
            false,
        ),
        Some("sample_rate") => (
            format!(
                " ORDER BY s.sample_rate {}, s.bit_depth {}, s.file_name COLLATE NOCASE ASC",
                dir, dir
            ),
            false,
        ),
        Some("dateModified") => (
            format!(
                " ORDER BY CASE WHEN s.file_modified_at IS NULL OR s.file_modified_at <= 0 THEN 1 ELSE 0 END ASC, \
                 CASE WHEN s.file_modified_at IS NULL OR s.file_modified_at <= 0 THEN NULL ELSE s.file_modified_at END {}, \
                 s.file_name COLLATE NOCASE ASC",
                dir
            ),
            false,
        ),
        Some("dateAdded") => (
            format!(
                " ORDER BY CASE WHEN TRIM(COALESCE(s.created_at, '')) = '' THEN 1 ELSE 0 END ASC, \
                 s.created_at {}, s.file_name COLLATE NOCASE ASC",
                dir
            ),
            false,
        ),
        Some(_) => (
            " ORDER BY s.file_name COLLATE NOCASE ASC".to_string(),
            true,
        ),
    }
}

#[cfg(test)]
mod tests {
    use super::build_samples_order_by_sql;

    #[test]
    fn default_and_unknown_keys_use_filename_asc_fast_path() {
        let (sql_none, fast_none) = build_samples_order_by_sql(None, None, false, false);
        assert!(fast_none);
        assert!(sql_none.contains("s.file_name COLLATE NOCASE ASC"));

        let (sql_bad, fast_bad) =
            build_samples_order_by_sql(Some("DROP TABLE samples;--"), Some("desc"), false, false);
        assert!(fast_bad);
        assert_eq!(sql_bad, " ORDER BY s.file_name COLLATE NOCASE ASC");
    }

    #[test]
    fn non_default_sort_keys_disable_filename_fast_path_and_keep_empty_last() {
        let (genre_asc, fast) =
            build_samples_order_by_sql(Some("genre"), Some("asc"), false, false);
        assert!(!fast);
        assert!(genre_asc.contains("THEN 1 ELSE 0 END ASC"));
        assert!(genre_asc.contains("COLLATE NOCASE ASC"));

        let (genre_desc, fast_desc) =
            build_samples_order_by_sql(Some("genre"), Some("desc"), false, false);
        assert!(!fast_desc);
        assert!(genre_desc.contains("THEN 1 ELSE 0 END ASC"));
        assert!(genre_desc.contains("COLLATE NOCASE DESC"));

        let (name_desc, fast_name_desc) =
            build_samples_order_by_sql(Some("name"), Some("desc"), false, false);
        assert!(!fast_name_desc);
        assert_eq!(name_desc, " ORDER BY s.file_name COLLATE NOCASE DESC");
    }
}
