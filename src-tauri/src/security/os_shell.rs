use super::path_guards::{
    display_leaf, has_ntfs_ads_colon, is_unc_or_network_path, strip_verbatim_prefix,
};
use std::fs;
use std::path::{Path, PathBuf};

/// Runs a Windows Shell API closure on a dedicated short-lived COM STA thread
/// (`COINIT_APARTMENTTHREADED | COINIT_DISABLE_OLE1DDE`) with guaranteed `CoUninitialize` cleanup,
/// avoiding COM apartment pollution on shared Tokio `spawn_blocking` worker threads.
#[cfg(target_os = "windows")]
fn run_on_sta_thread<F, T>(thread_name: &str, f: F) -> Result<T, String>
where
    F: FnOnce() -> Result<T, String> + Send + 'static,
    T: Send + 'static,
{
    use std::ffi::c_void;

    #[link(name = "ole32")]
    extern "system" {
        fn CoInitializeEx(reserved: *mut c_void, co_init: u32) -> i32;
        fn CoUninitialize();
    }

    const COINIT_APARTMENTTHREADED: u32 = 0x2;
    const COINIT_DISABLE_OLE1DDE: u32 = 0x4;

    struct ComStaGuard(bool);
    impl Drop for ComStaGuard {
        fn drop(&mut self) {
            if self.0 {
                unsafe {
                    CoUninitialize();
                }
            }
        }
    }

    let handle = std::thread::Builder::new()
        .name(thread_name.to_string())
        .spawn(move || {
            let hr = unsafe {
                CoInitializeEx(
                    std::ptr::null_mut(),
                    COINIT_APARTMENTTHREADED | COINIT_DISABLE_OLE1DDE,
                )
            };
            let _guard = ComStaGuard(hr == 0 || hr == 1);
            f()
        })
        .map_err(|e| format!("Failed to spawn shell STA worker: {}", e))?;

    handle
        .join()
        .map_err(|_| "Shell STA worker panicked".to_string())?
}

/// Opens Windows Explorer with the exact file selected using `SHParseDisplayName` +
/// `SHOpenFolderAndSelectItems` (never invoking `explorer.exe` CLI or `.raw_arg`).
#[cfg(target_os = "windows")]
pub fn reveal_file_in_explorer(file_path: &Path) -> Result<(), String> {
    use std::ffi::c_void;
    use std::os::windows::ffi::OsStrExt;

    #[link(name = "shell32")]
    extern "system" {
        fn SHParseDisplayName(
            name: *const u16,
            bind_ctx: *mut c_void,
            pidl: *mut *mut c_void,
            attrs_in: u32,
            attrs_out: *mut u32,
        ) -> i32;
        fn SHOpenFolderAndSelectItems(
            folder: *const c_void,
            count: u32,
            items: *const *const c_void,
            flags: u32,
        ) -> i32;
    }
    #[link(name = "ole32")]
    extern "system" {
        fn CoTaskMemFree(ptr: *mut c_void);
    }

    let raw = file_path.to_string_lossy();
    if is_unc_or_network_path(&raw) {
        return Err("Network and UNC paths are not allowed".to_string());
    }
    super::path_guards::reject_symlink_ancestors(file_path)?;
    let sym = fs::symlink_metadata(file_path)
        .map_err(|_| format!("File does not exist: {}", display_leaf(file_path)))?;
    if sym.file_type().is_symlink() {
        return Err("Symbolic links and junctions are not allowed".to_string());
    }
    let canon = fs::canonicalize(file_path)
        .map_err(|_| format!("File does not exist or cannot be accessed: {}", display_leaf(file_path)))?;
    if is_unc_or_network_path(&canon.to_string_lossy()) {
        return Err("Network and UNC paths are not allowed".to_string());
    }
    let clean = strip_verbatim_prefix(&canon);
    let win_str = clean.to_string_lossy().replace('/', "\\");
    let wide: Vec<u16> = std::ffi::OsStr::new(&win_str)
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();

    run_on_sta_thread("audify-shell-reveal", move || unsafe {
        let mut pidl: *mut c_void = std::ptr::null_mut();
        let hr_parse = SHParseDisplayName(
            wide.as_ptr(),
            std::ptr::null_mut(),
            &mut pidl,
            0,
            std::ptr::null_mut(),
        );
        let result = if hr_parse < 0 || pidl.is_null() {
            Err(format!("SHParseDisplayName failed: 0x{:08X}", hr_parse as u32))
        } else {
            let hr_open = SHOpenFolderAndSelectItems(pidl, 0, std::ptr::null(), 0);
            if hr_open < 0 {
                Err(format!(
                    "SHOpenFolderAndSelectItems failed: 0x{:08X}",
                    hr_open as u32
                ))
            } else {
                Ok(())
            }
        };
        if !pidl.is_null() {
            CoTaskMemFree(pidl);
        }
        result
    })
}

#[cfg(not(target_os = "windows"))]
pub fn reveal_file_in_explorer(file_path: &Path) -> Result<(), String> {
    let raw = file_path.to_string_lossy();
    if is_unc_or_network_path(&raw) {
        return Err("Network and UNC paths are not allowed".to_string());
    }
    super::path_guards::reject_symlink_ancestors(file_path)?;
    let sym = fs::symlink_metadata(file_path)
        .map_err(|_| format!("File does not exist: {}", display_leaf(file_path)))?;
    if sym.file_type().is_symlink() {
        return Err("Symbolic links and junctions are not allowed".to_string());
    }
    let canon = fs::canonicalize(file_path)
        .map_err(|_| format!("File does not exist: {}", display_leaf(file_path)))?;
    if is_unc_or_network_path(&canon.to_string_lossy()) {
        return Err("Network and UNC paths are not allowed".to_string());
    }
    let parent = canon
        .parent()
        .ok_or_else(|| "File has no parent directory".to_string())?;
    open_directory_in_shell(parent)
}

/// Opens a local directory natively using Win32 `ShellExecuteW(null, "open", dir_wide, ...)`
/// on Windows (handling commas, spaces, quotes, and Unicode cleanly without `explorer.exe` CLI bugs).
#[cfg(target_os = "windows")]
pub fn open_directory_in_shell(dir_path: &Path) -> Result<(), String> {
    use std::ffi::c_void;
    use std::os::windows::ffi::OsStrExt;

    #[link(name = "shell32")]
    extern "system" {
        fn ShellExecuteW(
            hwnd: *mut c_void,
            lp_operation: *const u16,
            lp_file: *const u16,
            lp_parameters: *const u16,
            lp_directory: *const u16,
            n_show_cmd: i32,
        ) -> isize;
    }

    const SW_SHOWNORMAL: i32 = 1;

    let raw = dir_path.to_string_lossy();
    if is_unc_or_network_path(&raw) {
        return Err("Network and UNC paths are not allowed".to_string());
    }
    super::path_guards::reject_symlink_ancestors(dir_path)?;
    let sym = fs::symlink_metadata(dir_path)
        .map_err(|_| format!("Directory does not exist: {}", display_leaf(dir_path)))?;
    if sym.file_type().is_symlink() {
        return Err("Symbolic links and junctions are not allowed".to_string());
    }
    let canon = fs::canonicalize(dir_path)
        .map_err(|_| format!("Directory does not exist or cannot be accessed: {}", display_leaf(dir_path)))?;
    if is_unc_or_network_path(&canon.to_string_lossy()) {
        return Err("Network and UNC paths are not allowed".to_string());
    }
    if !canon.is_dir() {
        return Err(format!("Path is not a directory: {}", display_leaf(dir_path)));
    }

    let clean = strip_verbatim_prefix(&canon);
    let win_str = clean.to_string_lossy().replace('/', "\\");
    let verb_wide: Vec<u16> = std::ffi::OsStr::new("open")
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();
    let dir_wide: Vec<u16> = std::ffi::OsStr::new(&win_str)
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();

    run_on_sta_thread("audify-shell-open-dir", move || {
        let code = unsafe {
            ShellExecuteW(
                std::ptr::null_mut(),
                verb_wide.as_ptr(),
                dir_wide.as_ptr(),
                std::ptr::null(),
                std::ptr::null(),
                SW_SHOWNORMAL,
            )
        };
        if code <= 32 {
            Err(format!(
                "Failed to open folder in Explorer (ShellExecuteW code {})",
                code
            ))
        } else {
            Ok(())
        }
    })
}

#[cfg(not(target_os = "windows"))]
pub fn open_directory_in_shell(dir_path: &Path) -> Result<(), String> {
    let raw = dir_path.to_string_lossy();
    if is_unc_or_network_path(&raw) {
        return Err("Network and UNC paths are not allowed".to_string());
    }
    super::path_guards::reject_symlink_ancestors(dir_path)?;
    let sym = fs::symlink_metadata(dir_path)
        .map_err(|_| format!("Directory does not exist: {}", display_leaf(dir_path)))?;
    if sym.file_type().is_symlink() {
        return Err("Symbolic links and junctions are not allowed".to_string());
    }
    let canon = fs::canonicalize(dir_path)
        .map_err(|_| format!("Directory does not exist: {}", display_leaf(dir_path)))?;
    if !canon.is_dir() {
        return Err("Path is not a directory".to_string());
    }
    #[cfg(target_os = "macos")]
    let opener = "/usr/bin/open";
    #[cfg(not(target_os = "macos"))]
    let opener = "xdg-open";
    std::process::Command::new(opener)
        .arg(&canon)
        .spawn()
        .map_err(|e| format!("Failed to open directory: {}", e))?;
    Ok(())
}

/// Validates and opens an HTTPS URL in the user's default web browser.
/// Callers must additionally enforce domain allowlisting before invoking this helper.
pub fn open_https_url_in_browser(url: &str) -> Result<(), String> {
    let trimmed = url.trim();
    if trimmed.is_empty()
        || trimmed.len() > 512
        || !trimmed.starts_with("https://")
        || trimmed
            .chars()
            .any(|c| c.is_control() || c.is_whitespace() || c == '"' || c == '\'' || c == '\\')
    {
        return Err("Invalid or unsafe external URL".to_string());
    }

    #[cfg(target_os = "windows")]
    {
        use std::ffi::c_void;
        use std::os::windows::ffi::OsStrExt;

        #[link(name = "shell32")]
        extern "system" {
            fn ShellExecuteW(
                hwnd: *mut c_void,
                lp_operation: *const u16,
                lp_file: *const u16,
                lp_parameters: *const u16,
                lp_directory: *const u16,
                n_show_cmd: i32,
            ) -> isize;
        }

        const SW_SHOWNORMAL: i32 = 1;
        let verb_wide: Vec<u16> = std::ffi::OsStr::new("open")
            .encode_wide()
            .chain(std::iter::once(0))
            .collect();
        let url_wide: Vec<u16> = std::ffi::OsStr::new(trimmed)
            .encode_wide()
            .chain(std::iter::once(0))
            .collect();

        run_on_sta_thread("audify-shell-open-url", move || {
            let code = unsafe {
                ShellExecuteW(
                    std::ptr::null_mut(),
                    verb_wide.as_ptr(),
                    url_wide.as_ptr(),
                    std::ptr::null(),
                    std::ptr::null(),
                    SW_SHOWNORMAL,
                )
            };
            if code <= 32 {
                Err(format!(
                    "Failed to open URL in default browser (ShellExecuteW code {})",
                    code
                ))
            } else {
                Ok(())
            }
        })
    }

    #[cfg(not(target_os = "windows"))]
    {
        #[cfg(target_os = "macos")]
        let opener = "/usr/bin/open";
        #[cfg(not(target_os = "macos"))]
        let opener = "xdg-open";
        std::process::Command::new(opener)
            .arg(trimmed)
            .spawn()
            .map_err(|e| format!("Failed to open browser URL: {}", e))?;
        Ok(())
    }
}

/// Moves one or more quarantined files to the operating system Recycle Bin / Trash
/// using modern COM `IFileOperation` (`FOF_ALLOWUNDO | FOFX_RECYCLEONDELETE`) on Windows,
/// supporting paths beyond legacy `SHFileOperationW`'s 248-char limit while ensuring
/// Audify never permanently destroys user audio files with `fs::remove_file` in production.
#[cfg(target_os = "windows")]
pub fn move_files_to_os_recycle_bin(paths: &[PathBuf]) -> Result<(), String> {
    use std::os::windows::ffi::OsStrExt;
    use windows::core::PCWSTR;
    use windows::Win32::System::Com::{
        CoCreateInstance, CoInitializeEx, CoUninitialize, CLSCTX_ALL, COINIT_APARTMENTTHREADED,
        COINIT_DISABLE_OLE1DDE,
    };
    use windows::Win32::UI::Shell::{
        FileOperation, IFileOperation, IShellItem, SHCreateItemFromParsingName,
        FILEOPERATION_FLAGS, FOF_ALLOWUNDO, FOF_NOCONFIRMATION, FOF_NOERRORUI, FOF_SILENT,
    };

    struct ComInitGuard(bool);
    impl Drop for ComInitGuard {
        fn drop(&mut self) {
            if self.0 {
                unsafe { CoUninitialize() };
            }
        }
    }

    let mut validated: Vec<(String, String)> = Vec::with_capacity(paths.len());
    for p in paths {
        let raw = p.to_string_lossy();
        if is_unc_or_network_path(&raw) {
            return Err("Network and UNC paths are not allowed".to_string());
        }
        if has_ntfs_ads_colon(&raw) {
            return Err("Alternate data streams are not allowed".to_string());
        }
        super::path_guards::reject_symlink_ancestors(p)?;
        let sym_meta = fs::symlink_metadata(p)
            .map_err(|_| format!("Failed to inspect '{}'", display_leaf(p)))?;
        if sym_meta.file_type().is_symlink() {
            return Err("Refusing to recycle symlink or directory junction".to_string());
        }
        let canon = fs::canonicalize(p)
            .map_err(|_| format!("Failed to verify '{}' for recycle", display_leaf(p)))?;
        if is_unc_or_network_path(&canon.to_string_lossy()) {
            return Err("Symbolic links pointing to network/UNC paths are not allowed".to_string());
        }
        let clean = strip_verbatim_prefix(&canon);
        let win_clean = clean.to_string_lossy().replace('/', "\\");
        let win_verbatim = canon.to_string_lossy().replace('/', "\\");
        validated.push((win_clean, win_verbatim));
    }

    if validated.is_empty() {
        return Ok(());
    }

    // Run Shell IFileOperation on a dedicated fresh OS thread so COM STA initialization
    // never collides with Tokio worker threads that may already be initialized as MTA.
    let handle = std::thread::Builder::new()
        .name("audify-recycle-sta".to_string())
        .spawn(move || -> Result<(), String> {
            let hr_init =
                unsafe { CoInitializeEx(None, COINIT_APARTMENTTHREADED | COINIT_DISABLE_OLE1DDE) };
            let _com_guard = ComInitGuard(hr_init.is_ok());

            const FOFX_RECYCLEONDELETE: FILEOPERATION_FLAGS = FILEOPERATION_FLAGS(0x0008_0000);
            unsafe {
                let op: IFileOperation = CoCreateInstance(&FileOperation, None, CLSCTX_ALL)
                    .map_err(|e| format!("Failed to initialize Windows Recycle Bin operation: {}", e))?;
                let flags = FOF_ALLOWUNDO
                    | FOF_NOCONFIRMATION
                    | FOF_NOERRORUI
                    | FOF_SILENT
                    | FOFX_RECYCLEONDELETE;
                op.SetOperationFlags(flags)
                    .map_err(|e| format!("Failed to configure Windows Recycle Bin flags: {}", e))?;

                for (win_clean, win_verbatim) in &validated {
                    let wide_clean: Vec<u16> = std::ffi::OsStr::new(win_clean)
                        .encode_wide()
                        .chain(std::iter::once(0))
                        .collect();
                    let item: IShellItem =
                        match SHCreateItemFromParsingName(PCWSTR(wide_clean.as_ptr()), None) {
                            Ok(it) => it,
                            Err(_) if win_verbatim != win_clean => {
                                let wide_verb: Vec<u16> = std::ffi::OsStr::new(win_verbatim)
                                    .encode_wide()
                                    .chain(std::iter::once(0))
                                    .collect();
                                SHCreateItemFromParsingName(PCWSTR(wide_verb.as_ptr()), None)
                                    .map_err(|e| {
                                        format!(
                                            "Windows Recycle Bin could not locate file (HRESULT 0x{:X})",
                                            e.code().0 as u32
                                        )
                                    })?
                            }
                            Err(e) => {
                                return Err(format!(
                                    "Windows Recycle Bin could not locate file (HRESULT 0x{:X})",
                                    e.code().0 as u32
                                ));
                            }
                        };
                    op.DeleteItem(&item, None).map_err(|e| {
                        format!(
                            "Failed to queue file for Windows Recycle Bin (HRESULT 0x{:X})",
                            e.code().0 as u32
                        )
                    })?;
                }

                op.PerformOperations().map_err(|e| {
                    format!(
                        "Windows Recycle Bin operation failed (HRESULT 0x{:X})",
                        e.code().0 as u32
                    )
                })?;
                if op
                    .GetAnyOperationsAborted()
                    .map(|b| b.as_bool())
                    .unwrap_or(false)
                {
                    return Err("Windows Recycle Bin operation was aborted".to_string());
                }
            }
            Ok(())
        })
        .map_err(|e| format!("Failed to spawn Windows Recycle Bin thread: {}", e))?;

    handle
        .join()
        .map_err(|_| "Windows Recycle Bin thread panicked".to_string())?
}

#[cfg(not(target_os = "windows"))]
pub fn move_files_to_os_recycle_bin(paths: &[PathBuf]) -> Result<(), String> {
    for p in paths {
        let raw = p.to_string_lossy();
        if is_unc_or_network_path(&raw) || has_ntfs_ads_colon(&raw) {
            return Err("Network paths and alternate data streams are not allowed".to_string());
        }
        let Ok(sym_meta) = fs::symlink_metadata(p) else {
            continue;
        };
        if sym_meta.file_type().is_symlink() {
            return Err("Refusing to recycle symlink".to_string());
        }
        if sym_meta.is_file() {
            fs::remove_file(p)
                .map_err(|_| format!("Failed to remove trashed file '{}'", display_leaf(p)))?;
        }
    }
    Ok(())
}
