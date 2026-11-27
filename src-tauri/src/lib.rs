pub mod ai_tagger;
pub mod app_cache_helpers;
pub mod app_helpers;
pub mod ascii_magic;
pub mod audio;
pub mod audio_engine;
pub mod commands;
pub mod db;
pub mod dsp_analysis;
pub mod duplicates;
pub mod library_watcher;
pub mod scanner;
pub mod security;
pub mod taxonomy_catalog;
#[cfg(target_os = "windows")]
pub mod win_drag;
pub mod win_edge_peek;
pub mod win_memory;
pub mod win_sysmenu;

pub use app_helpers::{prune_audio_cache_dirs, reconcile_library_asset_scopes};
use app_helpers::{
    theme_window_bg_color, AUDIFY_WEBVIEW_ARGS, CACHE_PRUNE_MAX_BYTES, CACHE_PRUNE_MAX_FILES,
    CACHE_PRUNE_MIN_AGE_SECS,
};
use db::{fallback_user_dir, init_db, resolve_user_dir, AppState};
use std::fs;
use std::time::Duration;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Cap Rayon's global compute pool (leaving >= 1 core free for WASAPI audio & WebView2 UI)
    // so heavy background scans, hashing, and AI k-NN never starve real-time playback or frames.
    let rayon_threads = std::thread::available_parallelism()
        .map(|n| n.get().saturating_sub(1).clamp(2, 6))
        .unwrap_or(4);
    let _ = rayon::ThreadPoolBuilder::new()
        .num_threads(rayon_threads)
        .thread_name(|idx| format!("audify-compute-{}", idx))
        .build_global();

    // Portable `user/` folder first; if it is not writable (e.g. Program Files) fall back to
    // %APPDATA%\Audify instead of crashing silently before any window appears.
    let primary_dir = resolve_user_dir();
    let (user_dir, conn) = match init_db(&primary_dir) {
        Ok(conn) => (primary_dir, conn),
        Err(primary_err) => {
            let fallback = fallback_user_dir();
            match fallback.as_ref().map(|fb| (fb, init_db(fb))) {
                Some((fb, Ok(conn))) => (fb.clone(), conn),
                other => {
                    let fallback_err = match other {
                        Some((_, Err(e))) => e,
                        _ => "APPDATA is not available".to_string(),
                    };
                    let _ = rfd::MessageDialog::new()
                        .set_level(rfd::MessageLevel::Error)
                        .set_title("Audify cannot start")
                        .set_description(format!(
                            "Audify could not open its database.\n\n{}\n\n{}",
                            primary_err, fallback_err
                        ))
                        .set_buttons(rfd::MessageButtons::Ok)
                        .show();
                    return;
                }
            }
        }
    };

    let webview_cache_dir = user_dir.join("cache").join("webview");
    let _ = fs::create_dir_all(&webview_cache_dir);
    std::env::set_var("WEBVIEW2_USER_DATA_FOLDER", &webview_cache_dir);

    // Clean up legacy drag icon file if it exists in the user directory
    let legacy_icon = user_dir.join("audify_drag_icon_32.png");
    if legacy_icon.exists() {
        let _ = fs::remove_file(legacy_icon);
    }

    let state = AppState::new(conn, user_dir);
    let sandbox_user_dir = state.user_dir.clone();

    tauri::Builder::default()
        .manage(state)
        .manage(ai_tagger::AiTaggerState::default())
        .manage(audio_engine::AudioEngineState::default())
        .manage(library_watcher::LibraryWatcherState::default())
        .manage(win_edge_peek::EdgePeekState::default())
        .register_uri_scheme_protocol("ascii-sandbox", move |_ctx, request| {
            ascii_magic::sandbox_protocol::handle_sandbox_request(&sandbox_user_dir, request)
        })
        .setup(|app| {
            use tauri::Manager;
            let state = app.state::<AppState>();
            app.state::<audio_engine::AudioEngineState>()
                .start(app.handle().clone());
            app.state::<library_watcher::LibraryWatcherState>()
                .start(app.handle().clone());
            {
                let conn = state.lock_db();
                reconcile_library_asset_scopes(app.handle(), &conn, None);
            }

            let webview_cache_dir = state.user_dir.join("cache").join("webview");
            let _ = fs::create_dir_all(&webview_cache_dir);
            let mut main_builder = tauri::WebviewWindowBuilder::new(
                app,
                "main",
                tauri::WebviewUrl::App("index.html".into()),
            )
            .title("Audify")
            .inner_size(1440.0, 900.0)
            .min_inner_size(1024.0, 640.0)
            .resizable(true)
            .decorations(false)
            .center()
            .background_color(theme_window_bg_color(None))
            .data_directory(webview_cache_dir)
            .disable_drag_drop_handler();

            #[cfg(target_os = "windows")]
            {
                main_builder = main_builder.additional_browser_args(AUDIFY_WEBVIEW_ARGS);
            }

            let main_win = main_builder.build()?;
            win_sysmenu::install_sysmenu_guard(&main_win);

            let cache_dirs = vec![
                state.user_dir.join("cache").join("slices"),
                state.user_dir.join("cache").join("layer_preview"),
                state.user_dir.join("cache").join("playback_fallback"),
            ];
            let sim_probe_user_dir = state.user_dir.clone();
            std::thread::spawn(move || {
                let _ = commands::clear_stale_sim_probe_dir(&sim_probe_user_dir);
                commands::prune_stale_drop_staging_dirs(&sim_probe_user_dir, 0);
                let _ = prune_audio_cache_dirs(
                    &cache_dirs,
                    CACHE_PRUNE_MAX_FILES,
                    CACHE_PRUNE_MAX_BYTES,
                    Duration::from_secs(CACHE_PRUNE_MIN_AGE_SECS),
                );
            });

            Ok(())
        })
        .on_window_event(|window, event| {
            use tauri::Manager;
            if let tauri::WindowEvent::Focused(focused) = event {
                app_helpers::on_window_focus_changed(
                    window.app_handle(),
                    window.label(),
                    *focused,
                );
                if window.label() == "main" && *focused {
                    win_memory::sync_main_window_minimized(window, true);
                    if let Some(edge_state) =
                        window.app_handle().try_state::<win_edge_peek::EdgePeekState>()
                    {
                        edge_state.notify_main_focused();
                    }
                }
                return;
            }
            if window.label() == "main" {
                if matches!(event, tauri::WindowEvent::Resized(_)) {
                    win_memory::sync_main_window_minimized(window, false);
                } else if matches!(
                    event,
                    tauri::WindowEvent::CloseRequested { .. } | tauri::WindowEvent::Destroyed
                ) {
                    if let Some(edge_state) =
                        window.app_handle().try_state::<win_edge_peek::EdgePeekState>()
                    {
                        if let Some(main_win) = window.app_handle().get_webview_window("main") {
                            edge_state.disable_for_window_nonblocking(window.app_handle(), &main_win);
                        }
                    }
                    if let Some(settings_win) = window.app_handle().get_webview_window("settings") {
                        let _ = settings_win.destroy();
                    }
                }
            } else if window.label() == "settings" {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    app_helpers::on_settings_close_requested(window);
                } else if matches!(event, tauri::WindowEvent::Destroyed) {
                    app_helpers::on_settings_window_destroyed();
                    app_helpers::on_window_focus_changed(
                        window.app_handle(),
                        "settings",
                        false,
                    );
                }
            }
        })
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            app_helpers::start_native_file_drag,
            app_helpers::open_settings_window,
            app_helpers::sync_window_theme_bg,
            app_helpers::broadcast_state_sync,
            commands::get_profiles,
            commands::create_profile,
            commands::duplicate_profile,
            commands::switch_profile,
            commands::update_profile,
            commands::delete_profile,
            commands::apply_auto_tag_rules_to_library,
            commands::preview_auto_tag_rule,
            commands::preview_auto_tag_rules_impact,
            commands::undo_last_auto_tag_apply,
            commands::export_settings_to_file,
            commands::import_settings_from_file,
            commands::export_profile_to_file,
            commands::import_profile_from_file,
            commands::list_backups,
            commands::create_quick_backup,
            commands::delete_backup_file,
            commands::open_backups_folder,
            commands::export_full_snapshot_to_file,
            commands::create_full_snapshot_backup,
            commands::inspect_full_snapshot_file,
            commands::restore_full_snapshot_from_file,
            commands::get_folder_tree_stats,
            commands::get_artist_stats,
            commands::preview_license_group_samples,
            commands::count_license_group_matches,
            commands::sync_library_incremental,
            commands::sync_library_background,
            commands::backfill_file_modified_dates,
            commands::get_libraries,
            commands::set_library_profile_scope,
            commands::set_library_read_only,
            commands::remove_library,
            commands::relink_library_folder,
            commands::get_trash_status,
            commands::rename_sample_file,
            commands::batch_rename_samples,
            commands::undo_rename_sample_file,
            commands::get_sample_rename_history,
            commands::move_samples_to_trash,
            commands::restore_samples_from_trash,
            commands::empty_audify_trash,
            commands::create_physical_subfolder,
            commands::rename_physical_subfolder,
            commands::trash_physical_subfolder,
            commands::move_samples_to_folder,
            commands::relocate_moved_samples,
            commands::stage_dropped_audio_file_raw,
            commands::stage_dropped_audio_files,
            commands::import_external_files_to_folder,
            commands::query_samples,
            commands::get_sample_by_id_or_path,
            commands::get_profile_quick_stats,
            commands::toggle_favorite,
            commands::toggle_favorites_batch,
            commands::toggle_sample_loop,
            commands::set_sample_bpm_key,
            commands::analyze_library_bpm_and_key,
            commands::get_tag_facets,
            commands::create_tag_facet,
            commands::update_tag_facet,
            commands::delete_tag_facet,
            commands::reorder_tag_facets,
            commands::get_tags,
            commands::create_tag,
            commands::assign_tag,
            commands::unassign_tag,
            commands::assign_tag_batch,
            commands::unassign_tag_batch,
            commands::clear_sample_tags_batch,
            commands::rename_tag,
            commands::update_tag_color,
            commands::update_tag_taxonomy,
            commands::reorder_taxonomy_items,
            commands::harmonize_taxonomy_colors,
            commands::merge_tags,
            commands::delete_tag,
            commands::get_genres,
            commands::create_genre,
            commands::rename_genre,
            commands::update_genre_color,
            commands::delete_genre,
            commands::assign_sample_genre,
            commands::assign_sample_genre_batch,
            commands::auto_detect_library_genres,
            commands::get_collections,
            commands::create_collection,
            commands::add_to_collection,
            commands::add_samples_to_collection_batch,
            commands::remove_samples_from_collection,
            commands::rename_collection,
            commands::reparent_collection,
            commands::delete_collection,
            commands::scan_duplicate_samples,
            commands::export_audio_slice,
            commands::promote_slice_to_export,
            commands::cleanup_unrecorded_slice_file,
            commands::record_slice_export,
            commands::save_slice_to_export,
            commands::list_slice_history,
            commands::toggle_slice_favorite,
            commands::toggle_slice_favorites_batch,
            commands::batch_rename_slices,
            commands::clear_missing_slices,
            commands::trash_slice_files,
            commands::restore_trashed_slice_files,
            commands::get_slice_trash_status,
            commands::list_trashed_slices,
            commands::empty_trashed_slices,
            commands::preview_layer_mix,
            commands::save_layer_mix,
            commands::prepare_layer_drag_wav,
            commands::validate_layer_recipe_sources,
            commands::list_layer_history,
            commands::toggle_layer_favorite,
            commands::toggle_layer_favorites_batch,
            commands::rename_layer_item,
            commands::clear_missing_layers,
            commands::trash_layer_files,
            commands::restore_trashed_layer_files,
            commands::get_layer_trash_status,
            commands::list_trashed_layers,
            commands::empty_trashed_layers,
            commands::open_layers_folder,
            commands::get_audio_preview_gain,
            commands::audio_engine_load,
            commands::audio_engine_play,
            commands::audio_engine_pause,
            commands::audio_engine_stop,
            commands::audio_engine_unload,
            commands::audio_engine_seek,
            commands::audio_engine_set_params,
            commands::audio_engine_list_devices,
            commands::audio_engine_set_device,
            commands::audio_engine_release_handle,
            commands::open_slices_folder,
            commands::transcode_to_pcm_cache,
            commands::show_in_folder,
            commands::resolve_metadata_titles,
            commands::get_sample_peaks,
            commands::get_hires_peaks,
            commands::open_data_folder,
            commands::import_custom_background,
            commands::get_custom_backgrounds,
            commands::delete_custom_background,
            commands::open_custom_backgrounds_folder,
            commands::check_app_update,
            commands::open_github_url,
            commands::get_ascii_magic_state,
            commands::sync_ascii_magic_catalog,
            commands::install_ascii_magic_piece,
            commands::delete_ascii_magic_piece,
            commands::save_ascii_magic_preview,
            commands::get_ascii_magic_preview,
            commands::get_ai_model_status,
            commands::verify_ai_model_integrity,
            commands::download_ai_model,
            commands::cancel_ai_download,
            commands::import_ai_model_file,
            commands::remove_ai_model,
            commands::analyze_samples_ai,
            commands::suggest_knn_ai_tags,
            commands::cancel_ai_analysis,
            commands::find_similar_samples,
            commands::find_similar_samples_by_external_audio,
            commands::find_similar_samples_by_external_audio_raw,
            commands::get_ai_tag_suggestions,
            commands::resolve_ai_tag_suggestion,
            commands::approve_all_ai_tag_suggestions,
            commands::dismiss_all_ai_tag_suggestions,
            win_edge_peek::mini_dock_set_edge_peek,
            win_edge_peek::mini_dock_edge_peek_set_hold,
            win_edge_peek::mini_dock_edge_peek_set_theme,
        ])
        .build(tauri::generate_context!())
        .expect("Failed to setup app")
        .run(|app_handle, event| {
            if let tauri::RunEvent::Exit = event {
                use tauri::Manager;
                if let Some(state) = app_handle.try_state::<AppState>() {
                    // Close idle WAL read-pool connections before checkpointing so TRUNCATE succeeds cleanly.
                    state.drain_read_pool();
                    let conn = state.lock_db();
                    let _ = conn.execute_batch(
                        "PRAGMA wal_checkpoint(TRUNCATE); PRAGMA optimize;",
                    );
                }
            }
        });
}
