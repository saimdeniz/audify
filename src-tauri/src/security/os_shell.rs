use super::path_guards::{
    display_leaf, has_ntfs_ads_colon, is_unc_or_network_path, strip_verbatim_prefix,
};
use std::fs;
use std::path::{Path, PathBuf};

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
        fn CoInitializeEx(reserved: *mut c_void, co_init: u32) -> i32;
        fn CoUninitialize();
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

    unsafe {
        let hr_init = CoInitializeEx(std::ptr::null_mut(), 0x2);
        let initialized = hr_init == 0 || hr_init == 1;

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
        if initialized {
            CoUninitialize();
        }
        result
    }
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
        Err(format!("Failed to open folder in Explorer (ShellExecuteW code {})", code))
    } else {
        Ok(())
    }
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

/// Moves one or more quarantined files to the operating system Recycle Bin / Trash
/// using Win32 `SHFileOperationW` (`FO_DELETE | FOF_ALLOWUNDO`) on Windows so Audify
/// never permanently destroys user audio files with `fs::remove_file` in production.
#[cfg(target_os = "windows")]
pub fn move_files_to_os_recycle_bin(paths: &[PathBuf]) -> Result<(), String> {
    use std::ffi::c_void;
    use std::os::windows::ffi::OsStrExt;
    use windows::core::PCWSTR;
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::Shell::{
        SHFileOperationW, FOF_ALLOWUNDO, FOF_NOCONFIRMATION, FOF_NOERRORUI, FOF_SILENT,
        FO_DELETE, SHFILEOPSTRUCTW,
    };

    #[link(name = "ole32")]
    extern "system" {
        fn CoInitializeEx(reserved: *mut c_void, co_init: u32) -> i32;
        fn CoUninitialize();
    }

    struct ComInitGuard(bool);
    impl Drop for ComInitGuard {
        fn drop(&mut self) {
            if self.0 {
                unsafe { CoUninitialize() };
            }
        }
    }

    let mut double_null_wide: Vec<u16> = Vec::new();
    for p in paths {
        let raw = p.to_string_lossy();
        if is_unc_or_network_path(&raw) {
            return Err("Network and UNC paths are not allowed".to_string());
        }
        if has_ntfs_ads_colon(&raw) {
            return Err("Alternate data streams are not allowed".to_string());
        }
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
        let win_str = clean.to_string_lossy().replace('/', "\\");
        double_null_wide.extend(std::ffi::OsStr::new(&win_str).encode_wide());
        double_null_wide.push(0);
    }

    if double_null_wide.is_empty() {
        return Ok(());
    }
    // Double-NULL terminator required by SHFileOperationW
    double_null_wide.push(0);

    const COINIT_APARTMENTTHREADED: u32 = 0x2;
    const COINIT_DISABLE_OLE1DDE: u32 = 0x4;
    let hr_init = unsafe {
        CoInitializeEx(
            std::ptr::null_mut(),
            COINIT_APARTMENTTHREADED | COINIT_DISABLE_OLE1DDE,
        )
    };
    let _com_guard = ComInitGuard(hr_init == 0 || hr_init == 1);

    let mut file_op = SHFILEOPSTRUCTW {
        hwnd: HWND(0),
        wFunc: FO_DELETE,
        pFrom: PCWSTR(double_null_wide.as_ptr()),
        pTo: PCWSTR::null(),
        fFlags: (FOF_ALLOWUNDO | FOF_NOCONFIRMATION | FOF_NOERRORUI | FOF_SILENT).0 as u16,
        fAnyOperationsAborted: windows::Win32::Foundation::BOOL(0),
        hNameMappings: std::ptr::null_mut(),
        lpszProgressTitle: PCWSTR::null(),
    };

    let ret = unsafe { SHFileOperationW(&mut file_op) };
    if ret != 0 {
        return Err(format!(
            "Windows Recycle Bin operation failed (SHFileOperationW code 0x{:X})",
            ret
        ));
    }
    if file_op.fAnyOperationsAborted.as_bool() {
        return Err("Windows Recycle Bin operation was aborted".to_string());
    }
    Ok(())
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
