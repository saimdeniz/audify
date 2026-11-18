use std::ffi::c_void;
use std::os::windows::ffi::OsStrExt;
use std::path::PathBuf;
use std::ptr::copy_nonoverlapping;
use windows::core::{GUID, HRESULT};
use windows::Win32::Foundation::{HWND, POINT};
use windows::Win32::System::Com::FORMATETC;

#[link(name = "user32")]
extern "system" {
    pub(super) fn ReleaseCapture() -> i32;
    pub(super) fn GetAsyncKeyState(vkey: i32) -> i16;
    pub(super) fn GetSystemMetrics(nindex: i32) -> i32;
    pub(super) fn GetCursorPos(lppoint: *mut POINT) -> i32;
    pub(super) fn WindowFromPoint(point: POINT) -> HWND;
    pub(super) fn GetAncestor(hwnd: HWND, gaflags: u32) -> HWND;
    pub(super) fn GetWindowThreadProcessId(hwnd: HWND, lpdwprocessid: *mut u32) -> u32;
    pub(super) fn SendMessageTimeoutW(
        hwnd: HWND,
        msg: u32,
        wparam: usize,
        lparam: isize,
        fuflags: u32,
        utimeout: u32,
        lpdwresult: *mut usize,
    ) -> isize;
    pub(super) fn CopyImage(h: isize, img_type: u32, cx: i32, cy: i32, flags: u32) -> isize;
}

#[link(name = "kernel32")]
extern "system" {
    pub(super) fn GetCurrentProcessId() -> u32;
    pub(super) fn GlobalAlloc(uflags: u32, dwbytes: usize) -> isize;
    pub(super) fn GlobalLock(hmem: isize) -> *mut c_void;
    pub(super) fn GlobalUnlock(hmem: isize) -> i32;
    pub(super) fn GlobalSize(hmem: isize) -> usize;
    pub(super) fn GlobalFree(hmem: isize) -> isize;
}

#[link(name = "shell32")]
extern "system" {
    pub(super) fn SHCreateStdEnumFmtEtc(
        cfmt: u32,
        rgfmt: *const FORMATETC,
        ppenumformatetc: *mut *mut c_void,
    ) -> HRESULT;
}

pub(super) const VK_LBUTTON_CODE: i32 = 0x01;
pub(super) const VK_RBUTTON_CODE: i32 = 0x02;
pub(super) const SM_SWAPBUTTON_INDEX: i32 = 23;
pub(super) const GA_ROOT_FLAG: u32 = 2;
pub(super) const WM_CANCELMODE_MSG: u32 = 0x001F;
pub(super) const SMTO_ABORTIFHUNG_FLAG: u32 = 0x0002;

pub(super) const GMEM_MOVEABLE_ZERO: u32 = 0x0002 | 0x0040;
pub(super) const CF_HDROP_FORMAT: u16 = 15;
pub(super) const MK_LBUTTON_MASK: u32 = 0x0001;
pub(super) const MK_RBUTTON_MASK: u32 = 0x0002;
pub(super) const IMAGE_BITMAP_TYPE: u32 = 0;
pub(super) const LR_CREATEDIBSECTION_FLAG: u32 = 0x0000_2000;

pub(super) const S_OK_HR: HRESULT = HRESULT(0);
pub(super) const E_POINTER_HR: HRESULT = HRESULT(0x8000_4003_u32 as i32);
pub(super) const E_NOINTERFACE_HR: HRESULT = HRESULT(0x8000_4002_u32 as i32);
pub(super) const E_NOTIMPL_HR: HRESULT = HRESULT(0x8000_4001_u32 as i32);
pub(super) const E_OUTOFMEMORY_HR: HRESULT = HRESULT(0x8007_000E_u32 as i32);
pub(super) const E_INVALIDARG_HR: HRESULT = HRESULT(0x8007_0057_u32 as i32);
pub(super) const DV_E_FORMATETC_HR: HRESULT = HRESULT(0x8004_0064_u32 as i32);
pub(super) const DV_E_TYMED_HR: HRESULT = HRESULT(0x8004_0069_u32 as i32);
pub(super) const OLE_E_ADVISENOTSUPPORTED_HR: HRESULT = HRESULT(0x8004_0003_u32 as i32);
pub(super) const DATA_S_SAMEFORMATETC_HR: HRESULT = HRESULT(0x0004_0130);
pub(super) const DRAGDROP_S_DROP_HR: HRESULT = HRESULT(0x0004_0100);
pub(super) const DRAGDROP_S_CANCEL_HR: HRESULT = HRESULT(0x0004_0101);
pub(super) const DRAGDROP_S_USEDEFAULTCURSORS_HR: HRESULT = HRESULT(0x0004_0102);

pub(super) const IID_IUNKNOWN: GUID = GUID::from_u128(0x00000000_0000_0000_c000_000000000046);
pub(super) const IID_IDATAOBJECT: GUID = GUID::from_u128(0x0000010e_0000_0000_c000_000000000046);
pub(super) const IID_IDROPSOURCE: GUID = GUID::from_u128(0x00000121_0000_0000_c000_000000000046);

#[repr(C)]
pub(super) struct DropFilesHeader {
    pub(super) p_files: u32,
    pub(super) pt: POINT,
    pub(super) f_nc: i32,
    pub(super) f_wide: i32,
}

pub(super) unsafe fn alloc_hglobal_bytes(bytes: &[u8]) -> Option<isize> {
    let hmem = GlobalAlloc(GMEM_MOVEABLE_ZERO, bytes.len().max(1));
    if hmem == 0 {
        return None;
    }
    let dst = GlobalLock(hmem);
    if dst.is_null() {
        let _ = GlobalFree(hmem);
        return None;
    }
    if !bytes.is_empty() {
        copy_nonoverlapping(bytes.as_ptr(), dst as *mut u8, bytes.len());
    }
    let _ = GlobalUnlock(hmem);
    Some(hmem)
}

pub(super) unsafe fn clone_hglobal(src: isize) -> Option<isize> {
    if src == 0 {
        return None;
    }
    let size = GlobalSize(src);
    if size == 0 {
        return None;
    }
    let src_ptr = GlobalLock(src);
    if src_ptr.is_null() {
        return None;
    }
    let hdest = GlobalAlloc(GMEM_MOVEABLE_ZERO, size);
    if hdest == 0 {
        let _ = GlobalUnlock(src);
        return None;
    }
    let dst_ptr = GlobalLock(hdest);
    if dst_ptr.is_null() {
        let _ = GlobalUnlock(src);
        let _ = GlobalFree(hdest);
        return None;
    }
    copy_nonoverlapping(src_ptr as *const u8, dst_ptr as *mut u8, size);
    let _ = GlobalUnlock(hdest);
    let _ = GlobalUnlock(src);
    Some(hdest)
}

/// Builds a UTF-16LE `DROPFILES` byte buffer (`fWide = 1`, double-NUL terminated) for `CF_HDROP`.
pub(super) fn build_hdrop_payload(paths: &[PathBuf]) -> Result<Vec<u8>, String> {
    let mut wide_chars: Vec<u16> = Vec::new();
    for path in paths {
        let canon = dunce::canonicalize(path).unwrap_or_else(|_| path.clone());
        let clean_str = canon.to_string_lossy().replace('/', "\\");
        if clean_str.trim().is_empty() {
            continue;
        }
        wide_chars.extend(std::ffi::OsStr::new(&clean_str).encode_wide());
        wide_chars.push(0);
    }
    if wide_chars.is_empty() {
        return Err("No valid file paths for CF_HDROP".to_string());
    }
    // Final trailing NUL terminating the multi-string list
    wide_chars.push(0);

    let header_size = std::mem::size_of::<DropFilesHeader>();
    let wide_bytes_len = wide_chars.len() * std::mem::size_of::<u16>();
    let mut payload = vec![0u8; header_size + wide_bytes_len];

    let header = DropFilesHeader {
        p_files: header_size as u32,
        pt: POINT { x: 0, y: 0 },
        f_nc: 0,
        f_wide: 1,
    };

    unsafe {
        copy_nonoverlapping(
            &header as *const DropFilesHeader as *const u8,
            payload.as_mut_ptr(),
            header_size,
        );
        copy_nonoverlapping(
            wide_chars.as_ptr() as *const u8,
            payload.as_mut_ptr().add(header_size),
            wide_bytes_len,
        );
    }

    Ok(payload)
}

// ============================================================================
// Custom synchronous COM `IDataObject`
// ============================================================================

#[repr(C)]
pub(super) struct RawIUnknownVtbl {
    pub(super) query_interface:
        unsafe extern "system" fn(*mut c_void, *const GUID, *mut *mut c_void) -> HRESULT,
    pub(super) add_ref: unsafe extern "system" fn(*mut c_void) -> u32,
    pub(super) release: unsafe extern "system" fn(*mut c_void) -> u32,
}