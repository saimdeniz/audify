mod inputs;
mod json_io;
mod os_shell;
mod path_guards;

pub use inputs::{
    detect_image_magic, has_parent_dir_traversal, is_dos_device_name, is_personal_path,
    is_safe_existing_bg_image, is_valid_collection_icon, sanitize_hex_color_or_default,
    sanitize_settings_paths, validate_hex_color, validate_safe_audio_stem,
    whitelist_and_sanitize_settings, ALLOWED_PROFILE_SETTINGS_KEYS,
};
pub use json_io::{
    is_zip_magic, read_bounded_bytes, read_bounded_string, validate_archive_export_path,
    validate_archive_import_path, validate_json_export_path, validate_json_import_path,
    MAX_CUSTOM_BG_BYTES, MAX_JSON_IMPORT_BYTES, MAX_LEGACY_PROFILE_JSON_BYTES,
    MAX_PROFILE_UNCOMPRESSED_BYTES, MAX_SNAPSHOT_ARCHIVE_BYTES,
};
pub use os_shell::{
    move_files_to_os_recycle_bin, open_directory_in_shell, reveal_file_in_explorer,
};
pub use path_guards::{
    collect_profile_slice_dirs, display_leaf, ensure_inside, ensure_not_inside_user_dir,
    ensure_safe_export_dir, has_ntfs_ads_colon, is_forbidden_os_or_root_path, is_safe_library_dir,
    is_unc_or_network_path, normalize_clean_path, sanitize_err, strip_verbatim_prefix,
    validate_audio_path_in_scope, validate_path_in_libraries_or_cache,
};

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn unc_and_network_path_detection() {
        assert!(is_unc_or_network_path(r"\\192.168.1.50\share\kick.wav"));
        assert!(is_unc_or_network_path("//evil.example.com/dav/kick.wav"));
        assert!(is_unc_or_network_path(r"\/evil/share/kick.wav"));
        assert!(is_unc_or_network_path(r"/\evil\share\kick.wav"));
        assert!(is_unc_or_network_path(r"\\?\UNC\server\share\kick.wav"));
        assert!(is_unc_or_network_path("//?/unc/server/share/kick.wav"));
        assert!(is_unc_or_network_path(r"\\.\PhysicalDrive0"));
        assert!(is_unc_or_network_path("file://attacker/share/a.json"));

        // Valid local paths (including local extended Windows drive prefix)
        assert!(!is_unc_or_network_path(r"\\?\C:\Sounds\Drums\Kick.wav"));
        assert!(!is_unc_or_network_path(r"\\?\d:/Samples/Hit.wav"));
        assert!(!is_unc_or_network_path(r"C:\Sounds\Drums\Kick.wav"));
        assert!(!is_unc_or_network_path("D:/Samples/FX"));
    }

    #[test]
    fn normalize_clean_path_handles_slashes_and_roots() {
        assert_eq!(
            normalize_clean_path(r"  \\?\C:\Sounds\\Drums\Kick.wav  "),
            "C:/Sounds/Drums/Kick.wav"
        );
        assert_eq!(normalize_clean_path("D:\\Samples\\Hits///"), "D:/Samples/Hits");
        assert_eq!(normalize_clean_path("C:\\"), "C:/");
        assert_eq!(normalize_clean_path("C:/"), "C:/");
        assert_eq!(normalize_clean_path("/"), "/");
    }

    #[test]
    fn safe_library_dir_rejects_unc_and_os_roots() {
        assert!(is_safe_library_dir(r"\\10.0.0.1\share\sounds").is_err());
        assert!(is_safe_library_dir("C:/").is_err());
        assert!(is_safe_library_dir("C:\\").is_err());
        assert!(is_safe_library_dir("C:/Windows").is_err());
        assert!(is_safe_library_dir("C:/Windows/System32").is_err());
        assert!(is_safe_library_dir("C:/Program Files").is_err());
        assert!(is_safe_library_dir("C:/Program Files (x86)").is_err());
        assert!(is_safe_library_dir("C:/Users").is_err());

        let tmp = std::env::temp_dir().join(format!("audify_sec_lib_{}", std::process::id()));
        fs::create_dir_all(&tmp).unwrap();
        assert!(is_safe_library_dir(&tmp.to_string_lossy()).is_ok());
        let _ = fs::remove_dir_all(&tmp);
    }

    #[test]
    fn whitelist_settings_blocks_arbitrary_json_exfiltration() {
        let secret_json = serde_json::json!({
            "aws_secret_key": "AKIA_TOP_SECRET",
            "password": "hunter2"
        });
        assert!(whitelist_and_sanitize_settings(&secret_json, true, true).is_err());

        // Empty `{}` is allowed
        let empty = serde_json::json!({});
        let res_empty = whitelist_and_sanitize_settings(&empty, true, true).unwrap();
        assert_eq!(res_empty, serde_json::json!({}));

        // Mixed known + unknown keys strips unknown keys and sanitizes UNC paths
        let mixed = serde_json::json!({
            "volume": 0.75,
            "themeMode": "dark",
            "customSliceExportPath": r"\\attacker\smb\leak",
            "customBgImage": r"\\attacker\smb\bg.png",
            "injectedKey": "should_be_dropped"
        });
        let cleaned = whitelist_and_sanitize_settings(&mixed, true, true).unwrap();
        assert_eq!(cleaned["volume"], 0.75);
        assert_eq!(cleaned["themeMode"], "dark");
        assert_eq!(cleaned["customSliceExportPath"], "");
        assert_eq!(cleaned["customBgImage"], "");
        assert!(cleaned.get("injectedKey").is_none());
    }

    #[test]
    fn image_magic_byte_verification() {
        assert_eq!(detect_image_magic(b"\x89PNG\r\n\x1a\n0000"), Some("png"));
        assert_eq!(detect_image_magic(&[0xFF, 0xD8, 0xFF, 0xE0]), Some("jpg"));
        assert_eq!(detect_image_magic(b"GIF89a0000"), Some("gif"));
        assert_eq!(detect_image_magic(b"RIFF\x24\x00\x00\x00WEBP"), Some("webp"));
        assert_eq!(
            detect_image_magic(b"BM\x36\x00\x00\x00\x00\x00\x00\x00\x36\x00\x00\x00"),
            Some("bmp")
        );
        assert_eq!(detect_image_magic(b"MZ\x90\x00NotAnImageAtAll"), None);
        assert_eq!(detect_image_magic(b"<html><script>"), None);
    }

    #[test]
    fn safe_audio_stem_validation_blocks_hazards() {
        assert_eq!(
            validate_safe_audio_stem("Heavy_Impact_01").unwrap(),
            "Heavy_Impact_01"
        );
        assert!(validate_safe_audio_stem("  Whoosh Fast (v2) ").is_err()); // trailing space rejected
        assert!(validate_safe_audio_stem("trailing_dot.").is_err());
        assert!(validate_safe_audio_stem("").is_err());
        assert!(validate_safe_audio_stem("   ").is_err());
        assert!(validate_safe_audio_stem("../escape").is_err());
        assert!(validate_safe_audio_stem("sub/folder").is_err());
        assert!(validate_safe_audio_stem("sub\\folder").is_err());
        assert!(validate_safe_audio_stem("ads:stream").is_err());
        assert!(validate_safe_audio_stem("wild*card").is_err());
        assert!(validate_safe_audio_stem("CON").is_err());
        assert!(validate_safe_audio_stem("nul").is_err());
        assert!(validate_safe_audio_stem("com1.test").is_err());
    }

    #[test]
    fn whitelist_settings_preserves_ascii_presets_and_migrates_legacy_custom_kind() {
        let input = serde_json::json!({
            "accentAuto": true,
            "wallpaperKind": "ascii_custom",
            "asciiPreset": "koi_pond",
            "customAsciiText": "legacy art",
            "customAsciiEffect": "wave",
            "asciiMotionSpeed": 1.5,
            "unknownSecret": "drop_me"
        });
        let cleaned = whitelist_and_sanitize_settings(&input, true, true).unwrap();
        assert_eq!(cleaned["accentAuto"], true);
        assert_eq!(cleaned["wallpaperKind"], "ascii_preset");
        assert_eq!(cleaned["asciiPreset"], "koi_pond");
        assert_eq!(cleaned["asciiMotionSpeed"], 1.5);
        assert!(cleaned.get("customAsciiText").is_none());
        assert!(cleaned.get("customAsciiEffect").is_none());
        assert!(cleaned.get("unknownSecret").is_none());
    }

    #[test]
    fn validate_hex_color_and_accent_sanitization_work() {
        assert_eq!(validate_hex_color(" #38bdf8 ").unwrap(), "#38BDF8");
        assert_eq!(validate_hex_color("#fff").unwrap(), "#FFFFFF");
        assert!(validate_hex_color("red; background: url(x)").is_err());
        assert!(validate_hex_color("#12345").is_err());
        assert!(validate_hex_color("#GGGGGG").is_err());
        assert_eq!(sanitize_hex_color_or_default("invalid", "#38BDF8"), "#38BDF8");

        let input = serde_json::json!({
            "themeMode": "dark",
            "accentColor": "red; evil: expression(1)"
        });
        let cleaned = whitelist_and_sanitize_settings(&input, true, true).unwrap();
        assert!(cleaned.get("accentColor").is_none());

        let valid_input = serde_json::json!({
            "accentColor": "#0ea5e9"
        });
        let cleaned_valid = whitelist_and_sanitize_settings(&valid_input, true, true).unwrap();
        assert_eq!(cleaned_valid["accentColor"], "#0EA5E9");
    }
}
