//! Sononym-grade synchronous Win32 OLE file drag (`DoDragDrop`) for NLEs & DAWs.
//!
//! Eliminates intermittent `DROPEFFECT_NONE` ("🚫 error cursor") issues in DaVinci Resolve (Qt)
//! and Premiere Pro (DVaui) by fixing all three Win32/WebView2 root causes:
//! 1. Releases WebView2's cross-process (`msedgewebview2.exe` `Chrome_RenderWidgetHostHWND`) mouse
//!    capture via `SendMessageTimeoutW(hit_hwnd, WM_CANCELMODE, ...)` + local `ReleaseCapture()`
//!    before entering OLE's modal drag message loop.
//! 2. Uses a 100% synchronous custom COM `IDataObject` serving `CF_HDROP` (`DROPFILES` UTF-16LE
//!    `GMEM_MOVEABLE`, cloning `HGLOBAL` per `GetData` call so repeated `DragEnter`/`DragOver`/`Drop`
//!    queries never invalidate the medium) with **zero `IAsyncOperation` staging**, while also
//!    supporting `SetData` so `IDragSourceHelper::InitializeFromBitmap` renders our custom drag badge.
//! 3. Uses a clean custom COM `IDropSource` (`DRAGDROP_S_USEDEFAULTCURSORS`) with `Ole::DoDragDrop`
//!    advertising `DROPEFFECT_COPY | DROPEFFECT_LINK`.


mod com_defs;
mod data_object;
mod drop_source;

use com_defs::*;
use data_object::create_sync_file_data_object;
use drop_source::create_sync_drop_source;
use std::ffi::c_void;
use std::path::PathBuf;
use std::ptr::null_mut;
use std::sync::Once;
use windows::Win32::Foundation::{COLORREF, HWND, POINT, SIZE};
use windows::Win32::Graphics::Gdi::{CreateBitmap, DeleteObject, GetObjectW, BITMAP, HBITMAP};
use windows::Win32::Graphics::Imaging::{
    CLSID_WICImagingFactory, GUID_WICPixelFormat32bppPBGRA, IWICImagingFactory,
    WICConvertBitmapSource, WICDecodeMetadataCacheOnDemand,
};
use windows::Win32::System::Com::{
    CoCreateInstance, IDataObject, CLSCTX_ALL, CLSCTX_INPROC_SERVER,
};
use windows::Win32::System::Ole::{
    DoDragDrop, OleInitialize, DROPEFFECT, DROPEFFECT_COPY, DROPEFFECT_LINK,
};
use windows::Win32::UI::Shell::{CLSID_DragDropHelper, IDragSourceHelper, SHDRAGIMAGE};

static OLE_INIT_ONCE: Once = Once::new();

unsafe fn is_primary_mouse_button_down() -> bool {
    let vkey = if GetSystemMetrics(SM_SWAPBUTTON_INDEX) != 0 {
        VK_RBUTTON_CODE
    } else {
        VK_LBUTTON_CODE
    };
    (GetAsyncKeyState(vkey) as u16 & 0x8000) != 0
}

unsafe extern "system" fn cancel_mode_child_proc(hwnd: HWND, _lparam: isize) -> i32 {
    let mut dummy_res: usize = 0;
    let _ = SendMessageTimeoutW(
        hwnd,
        WM_CANCELMODE_MSG,
        0,
        0,
        SMTO_ABORTIFHUNG_FLAG,
        30,
        &mut dummy_res,
    );
    1
}

/// Unconditionally releases cross-process WebView2 child window capture (`msedgewebview2.exe`'s
/// `Chrome_RenderWidgetHostHWND` & `Chrome_WidgetWin_*`) and local STA thread capture right before
/// `DoDragDrop`, even if fast mouse movement has already moved the cursor over an external NLE.
unsafe fn release_webview_and_local_capture(owner_hwnd: HWND) {
    if owner_hwnd.0 != 0 {
        let _ = EnumChildWindows(owner_hwnd, cancel_mode_child_proc, 0);
        let mut dummy_res: usize = 0;
        let _ = SendMessageTimeoutW(
            owner_hwnd,
            WM_CANCELMODE_MSG,
            0,
            0,
            SMTO_ABORTIFHUNG_FLAG,
            30,
            &mut dummy_res,
        );
    } else {
        let mut pt = POINT { x: 0, y: 0 };
        if GetCursorPos(&mut pt) != 0 {
            let hit_hwnd = WindowFromPoint(pt);
            if hit_hwnd.0 != 0 {
                let root_hwnd = GetAncestor(hit_hwnd, GA_ROOT_FLAG);
                let check_root = if root_hwnd.0 != 0 { root_hwnd } else { hit_hwnd };
                let mut pid: u32 = 0;
                GetWindowThreadProcessId(check_root, &mut pid);
                if pid != 0 && pid == GetCurrentProcessId() {
                    let mut dummy_res: usize = 0;
                    let _ = SendMessageTimeoutW(
                        hit_hwnd,
                        WM_CANCELMODE_MSG,
                        0,
                        0,
                        SMTO_ABORTIFHUNG_FLAG,
                        30,
                        &mut dummy_res,
                    );
                }
            }
        }
    }
    let _ = ReleaseCapture();
}

unsafe fn is_cursor_over_external_window(owner_hwnd: HWND) -> bool {
    let mut pt = POINT { x: 0, y: 0 };
    if GetCursorPos(&mut pt) == 0 {
        return false;
    }
    let hit_hwnd = WindowFromPoint(pt);
    if hit_hwnd.0 == 0 {
        return false;
    }
    let root_hwnd = GetAncestor(hit_hwnd, GA_ROOT_FLAG);
    let check_hwnd = if root_hwnd.0 != 0 { root_hwnd } else { hit_hwnd };
    if owner_hwnd.0 != 0 && check_hwnd == owner_hwnd {
        return false;
    }
    let mut root_pid: u32 = 0;
    GetWindowThreadProcessId(check_hwnd, &mut root_pid);
    let current_pid = GetCurrentProcessId();
    root_pid != 0 && root_pid != current_pid
}

fn ensure_ole_initialized() {
    OLE_INIT_ONCE.call_once(|| unsafe {
        let _ = OleInitialize(Some(null_mut()));
    });
}

unsafe fn decode_png_to_hbitmap(png_bytes: &[u8]) -> Option<HBITMAP> {
    let factory: IWICImagingFactory =
        CoCreateInstance(&CLSID_WICImagingFactory, None, CLSCTX_INPROC_SERVER).ok()?;
    let stream = factory.CreateStream().ok()?;
    stream.InitializeFromMemory(png_bytes).ok()?;
    let decoder = factory
        .CreateDecoderFromStream(&stream, std::ptr::null(), WICDecodeMetadataCacheOnDemand)
        .ok()?;
    let frame = decoder.GetFrame(0).ok()?;

    let mut width: u32 = 0;
    let mut height: u32 = 0;
    frame.GetSize(&mut width, &mut height).ok()?;
    if width == 0 || height == 0 || width > 1024 || height > 1024 {
        return None;
    }

    let mut pixel_buf: Vec<u8> = vec![0; (width * height * 4) as usize];
    let pixel_format = frame.GetPixelFormat().ok()?;
    if pixel_format != GUID_WICPixelFormat32bppPBGRA {
        let converted = WICConvertBitmapSource(&GUID_WICPixelFormat32bppPBGRA, &frame).ok()?;
        converted
            .CopyPixels(std::ptr::null(), width * 4, &mut pixel_buf)
            .ok()?;
    } else {
        frame
            .CopyPixels(std::ptr::null(), width * 4, &mut pixel_buf)
            .ok()?;
    }

    let hbmp = CreateBitmap(
        width as i32,
        height as i32,
        1,
        32,
        Some(pixel_buf.as_ptr() as *const c_void),
    );
    if hbmp.is_invalid() {
        None
    } else {
        Some(hbmp)
    }
}

unsafe fn attach_drag_badge(data_object: &IDataObject, png_bytes: &[u8]) {
    let Some(hbmp) = decode_png_to_hbitmap(png_bytes) else {
        return;
    };

    let mut bmp: BITMAP = BITMAP::default();
    let got_obj = GetObjectW(
        hbmp,
        std::mem::size_of::<BITMAP>() as i32,
        Some(&mut bmp as *mut BITMAP as *mut c_void),
    );
    let (cx, cy) = if got_obj == 0 {
        (128, 36)
    } else {
        (bmp.bmWidth, bmp.bmHeight)
    };

    let drag_img = SHDRAGIMAGE {
        sizeDragImage: SIZE { cx, cy },
        ptOffset: POINT { x: 0, y: 0 },
        hbmpDragImage: hbmp,
        crColorKey: COLORREF(0x00000000),
    };

    let attached = CoCreateInstance::<_, IDragSourceHelper>(&CLSID_DragDropHelper, None, CLSCTX_ALL)
        .and_then(|helper| helper.InitializeFromBitmap(&drag_img, data_object))
        .is_ok();

    if !attached {
        let _ = DeleteObject(hbmp);
    }
}

pub fn start_explorer_file_drag(
    window: &tauri::Window,
    files: Vec<PathBuf>,
    icon_png: Option<&[u8]>,
) -> Result<bool, String> {
    if files.is_empty() {
        return Ok(false);
    }

    ensure_ole_initialized();

    let dropped_externally = unsafe {
        if !is_primary_mouse_button_down() {
            return Ok(false);
        }

        let owner_hwnd = window
            .hwnd()
            .ok()
            .map(|h| HWND(h.0 as isize))
            .unwrap_or(HWND(0));

        // Release WebView2 cross-process capture unconditionally BEFORE creating drag image or
        // entering OLE's modal drag loop so fast drags across window boundaries never leave
        // Chrome_RenderWidgetHostHWND holding stale capture.
        release_webview_and_local_capture(owner_hwnd);

        let data_object = create_sync_file_data_object(&files)?;
        let drop_source = create_sync_drop_source();

        if let Some(bytes) = icon_png {
            if !bytes.is_empty() {
                attach_drag_badge(&data_object, bytes);
            }
        }

        if !is_primary_mouse_button_down() {
            return Ok(false);
        }

        let allowed_effects = DROPEFFECT_COPY | DROPEFFECT_LINK;
        let mut final_effect = DROPEFFECT(0);
        let drop_hr = DoDragDrop(&data_object, &drop_source, allowed_effects, &mut final_effect);

        let drop_accepted = drop_hr == DRAGDROP_S_DROP_HR && final_effect.0 != 0;
        drop_accepted && is_cursor_over_external_window(owner_hwnd)
    };

    Ok(dropped_externally)
}

#[cfg(test)]
mod tests {
    use super::*;
    use windows::Win32::System::Com::{DVASPECT_CONTENT, FORMATETC, IDataObject, TYMED_HGLOBAL};
    use windows::Win32::System::Ole::ReleaseStgMedium;

    #[test]
    fn test_hdrop_payload_and_com_data_object_roundtrip() {
        let paths = vec![
            PathBuf::from(r"C:\Audio\Impact_01.wav"),
            PathBuf::from(r"D:\SFX\Türkçe_Geçiş.wav"),
        ];
        let payload = build_hdrop_payload(&paths).expect("payload should build");
        assert!(payload.len() > std::mem::size_of::<DropFilesHeader>());
        assert_eq!(
            u32::from_le_bytes(payload[0..4].try_into().unwrap()),
            std::mem::size_of::<DropFilesHeader>() as u32
        );
        // fWide == 1 at offset 16
        assert_eq!(i32::from_le_bytes(payload[16..20].try_into().unwrap()), 1);

        unsafe {
            let data_obj: IDataObject =
                create_sync_file_data_object(&paths).expect("COM IDataObject should construct");
            let req = FORMATETC {
                cfFormat: CF_HDROP_FORMAT,
                ptd: null_mut(),
                dwAspect: DVASPECT_CONTENT.0,
                lindex: -1,
                tymed: TYMED_HGLOBAL.0 as u32,
            };
            assert!(data_obj.QueryGetData(&req).is_ok());

            // Calling GetData multiple times (simulating DragEnter + Drop) must return independent HGLOBALs
            let mut med1 = data_obj.GetData(&req).expect("first GetData");
            let mut med2 = data_obj.GetData(&req).expect("second GetData");
            assert_ne!(med1.u.hGlobal.0, med2.u.hGlobal.0);
            assert!(GlobalSize(med1.u.hGlobal.0 as isize) >= payload.len());
            ReleaseStgMedium(&mut med1);
            ReleaseStgMedium(&mut med2);

            // Preferred DropEffect must advertise DROPEFFECT_COPY (1)
            if let Some(cf_pref) = register_clipboard_format("Preferred DropEffect") {
                let pref_req = FORMATETC {
                    cfFormat: cf_pref,
                    ptd: null_mut(),
                    dwAspect: DVASPECT_CONTENT.0,
                    lindex: -1,
                    tymed: TYMED_HGLOBAL.0 as u32,
                };
                assert!(data_obj.QueryGetData(&pref_req).is_ok());
                let mut pref_med = data_obj.GetData(&pref_req).expect("Preferred DropEffect");
                let ptr = GlobalLock(pref_med.u.hGlobal.0 as isize) as *const u32;
                assert!(!ptr.is_null());
                assert_eq!(*ptr, DROPEFFECT_COPY.0);
                let _ = GlobalUnlock(pref_med.u.hGlobal.0 as isize);
                ReleaseStgMedium(&mut pref_med);
            }

            // Single-file IDataObject should also expose FileNameW
            let single_obj = create_sync_file_data_object(&paths[..1])
                .expect("single-file COM IDataObject should construct");
            if let Some(cf_fname) = register_clipboard_format("FileNameW") {
                let fname_req = FORMATETC {
                    cfFormat: cf_fname,
                    ptd: null_mut(),
                    dwAspect: DVASPECT_CONTENT.0,
                    lindex: -1,
                    tymed: TYMED_HGLOBAL.0 as u32,
                };
                assert!(single_obj.QueryGetData(&fname_req).is_ok());
            }
        }
    }
}