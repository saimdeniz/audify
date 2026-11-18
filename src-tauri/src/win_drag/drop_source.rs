use super::com_defs::*;
use std::ffi::c_void;
use std::ptr::null_mut;
use std::sync::atomic::{AtomicU32, Ordering};
use windows::core::{Interface, GUID, HRESULT};
use windows::Win32::Foundation::BOOL;
use windows::Win32::System::Ole::IDropSource;

#[repr(C)]
struct RawDropSourceVtbl {
    base: RawIUnknownVtbl,
    query_continue_drag: unsafe extern "system" fn(*mut c_void, BOOL, u32) -> HRESULT,
    give_feedback: unsafe extern "system" fn(*mut c_void, u32) -> HRESULT,
}

#[repr(C)]
struct SyncDropSource {
    vtbl: *const RawDropSourceVtbl,
    ref_count: AtomicU32,
    button_mask: u32,
}

static DROP_SOURCE_VTBL: RawDropSourceVtbl = RawDropSourceVtbl {
    base: RawIUnknownVtbl {
        query_interface: drop_src_query_interface,
        add_ref: drop_src_add_ref,
        release: drop_src_release,
    },
    query_continue_drag: drop_src_query_continue_drag,
    give_feedback: drop_src_give_feedback,
};

unsafe extern "system" fn drop_src_query_interface(
    this: *mut c_void,
    riid: *const GUID,
    ppv: *mut *mut c_void,
) -> HRESULT {
    if ppv.is_null() {
        return E_POINTER_HR;
    }
    *ppv = null_mut();
    if riid.is_null() {
        return E_POINTER_HR;
    }
    let iid = *riid;
    if iid == IID_IUNKNOWN || iid == IID_IDROPSOURCE {
        *ppv = this;
        drop_src_add_ref(this);
        S_OK_HR
    } else {
        E_NOINTERFACE_HR
    }
}

unsafe extern "system" fn drop_src_add_ref(this: *mut c_void) -> u32 {
    let obj = &*(this as *const SyncDropSource);
    obj.ref_count.fetch_add(1, Ordering::Relaxed) + 1
}

unsafe extern "system" fn drop_src_release(this: *mut c_void) -> u32 {
    let obj = &*(this as *const SyncDropSource);
    let prev = obj.ref_count.fetch_sub(1, Ordering::Release);
    if prev == 1 {
        std::sync::atomic::fence(Ordering::Acquire);
        drop(Box::from_raw(this as *mut SyncDropSource));
        0
    } else {
        prev - 1
    }
}

unsafe extern "system" fn drop_src_query_continue_drag(
    this: *mut c_void,
    f_escape_pressed: BOOL,
    grf_key_state: u32,
) -> HRESULT {
    if f_escape_pressed.as_bool() {
        return DRAGDROP_S_CANCEL_HR;
    }
    let obj = &*(this as *const SyncDropSource);
    if (grf_key_state & obj.button_mask) == 0 {
        return DRAGDROP_S_DROP_HR;
    }
    S_OK_HR
}

unsafe extern "system" fn drop_src_give_feedback(
    _this: *mut c_void,
    _dw_effect: u32,
) -> HRESULT {
    DRAGDROP_S_USEDEFAULTCURSORS_HR
}

pub(super) unsafe fn create_sync_drop_source() -> IDropSource {
    // `grfKeyState` sets MK_LBUTTON for the logical primary mouse button, but check MK_RBUTTON as
    // well when left-handed mouse swap (`SM_SWAPBUTTON`) is active and MK_LBUTTON wasn't mapped.
    let swapped = GetSystemMetrics(SM_SWAPBUTTON_INDEX) != 0;
    let button_mask = if swapped {
        MK_LBUTTON_MASK | MK_RBUTTON_MASK
    } else {
        MK_LBUTTON_MASK
    };
    let boxed = Box::new(SyncDropSource {
        vtbl: &DROP_SOURCE_VTBL,
        ref_count: AtomicU32::new(1),
        button_mask,
    });
    IDropSource::from_raw(Box::into_raw(boxed) as *mut c_void)
}