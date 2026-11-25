use super::com_defs::*;
use std::ffi::c_void;
use std::path::PathBuf;
use std::ptr::null_mut;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Mutex;
use windows::core::{Interface, BOOL, GUID, HRESULT};
use windows::Win32::Graphics::Gdi::HBITMAP;
use windows::Win32::System::Com::{
    IDataObject, DATADIR_GET, DVASPECT_CONTENT, FORMATETC, STGMEDIUM, TYMED_GDI, TYMED_HGLOBAL,
    TYMED_ISTORAGE, TYMED_ISTREAM,
};
use windows::Win32::System::Ole::ReleaseStgMedium;

#[repr(C)]
struct RawDataObjectVtbl {
    base: RawIUnknownVtbl,
    get_data: unsafe extern "system" fn(*mut c_void, *const FORMATETC, *mut STGMEDIUM) -> HRESULT,
    get_data_here:
        unsafe extern "system" fn(*mut c_void, *const FORMATETC, *mut STGMEDIUM) -> HRESULT,
    query_get_data: unsafe extern "system" fn(*mut c_void, *const FORMATETC) -> HRESULT,
    get_canonical_format_etc:
        unsafe extern "system" fn(*mut c_void, *const FORMATETC, *mut FORMATETC) -> HRESULT,
    set_data:
        unsafe extern "system" fn(*mut c_void, *const FORMATETC, *const STGMEDIUM, BOOL) -> HRESULT,
    enum_format_etc: unsafe extern "system" fn(*mut c_void, u32, *mut *mut c_void) -> HRESULT,
    d_advise: unsafe extern "system" fn(
        *mut c_void,
        *const FORMATETC,
        u32,
        *mut c_void,
        *mut u32,
    ) -> HRESULT,
    d_unadvise: unsafe extern "system" fn(*mut c_void, u32) -> HRESULT,
    enum_d_advise: unsafe extern "system" fn(*mut c_void, *mut *mut c_void) -> HRESULT,
}

struct StoredMediumEntry {
    fmt: FORMATETC,
    med: STGMEDIUM,
}

impl Drop for StoredMediumEntry {
    fn drop(&mut self) {
        unsafe {
            ReleaseStgMedium(&mut self.med);
        }
    }
}

#[repr(C)]
struct SyncFileDataObject {
    vtbl: *const RawDataObjectVtbl,
    ref_count: AtomicU32,
    entries: Mutex<Vec<StoredMediumEntry>>,
}

static DATA_OBJECT_VTBL: RawDataObjectVtbl = RawDataObjectVtbl {
    base: RawIUnknownVtbl {
        query_interface: data_obj_query_interface,
        add_ref: data_obj_add_ref,
        release: data_obj_release,
    },
    get_data: data_obj_get_data,
    get_data_here: data_obj_get_data_here,
    query_get_data: data_obj_query_get_data,
    get_canonical_format_etc: data_obj_get_canonical_format_etc,
    set_data: data_obj_set_data,
    enum_format_etc: data_obj_enum_format_etc,
    d_advise: data_obj_d_advise,
    d_unadvise: data_obj_d_unadvise,
    enum_d_advise: data_obj_enum_d_advise,
};

fn format_matches(req: &FORMATETC, stored: &FORMATETC) -> bool {
    req.cfFormat == stored.cfFormat
        && (req.dwAspect & stored.dwAspect) != 0
        && (req.lindex == stored.lindex || req.lindex == -1 || stored.lindex == -1)
        && (req.tymed & stored.tymed) != 0
}

unsafe fn duplicate_stgmedium(src: &STGMEDIUM, dst: *mut STGMEDIUM) -> HRESULT {
    std::ptr::write_bytes(dst, 0, 1);

    // If the medium relies on a custom `pUnkForRelease`, shallow-copy the union and
    // explicitly AddRef `pUnkForRelease` (in `windows 0.52`, `STGMEDIUM::clone()` is a
    // raw bitwise copy and does NOT call AddRef!).
    // Per MSDN `ReleaseStgMedium`, for `TYMED_ISTREAM` / `TYMED_ISTORAGE` the runtime
    // releases BOTH the interface pointer in the union AND `pUnkForRelease`, so we must
    // AddRef the underlying COM stream/storage pointer as well to avoid a UAF double-release.
    if let Some(ref punk) = *src.pUnkForRelease {
        *dst = src.clone();
        let raw_unk = punk.as_raw();
        if !raw_unk.is_null() {
            let vtbl = *(raw_unk as *const *const RawIUnknownVtbl);
            ((*vtbl).add_ref)(raw_unk);
        }
        if src.tymed == TYMED_ISTREAM.0 as u32 || src.tymed == TYMED_ISTORAGE.0 as u32 {
            let raw_iface: *mut c_void =
                std::ptr::read(&src.u as *const _ as *const *mut c_void);
            if !raw_iface.is_null() {
                let vtbl = *(raw_iface as *const *const RawIUnknownVtbl);
                ((*vtbl).add_ref)(raw_iface);
            }
        }
        return S_OK_HR;
    }

    let tymed = src.tymed;
    if tymed == TYMED_HGLOBAL.0 as u32 {
        let raw_hglobal = src.u.hGlobal.0 as isize;
        let Some(cloned) = clone_hglobal(raw_hglobal) else {
            return E_OUTOFMEMORY_HR;
        };
        (*dst).tymed = tymed;
        (*dst).u.hGlobal = windows::Win32::Foundation::HGLOBAL(cloned as *mut c_void);
        return S_OK_HR;
    }

    if tymed == TYMED_ISTREAM.0 as u32 || tymed == TYMED_ISTORAGE.0 as u32 {
        *dst = src.clone();
        // `ManuallyDrop<Option<IStream>>` inside union is not automatically AddRef'd by STGMEDIUM::clone
        let raw_punk: *mut c_void = std::ptr::read(&src.u as *const _ as *const *mut c_void);
        if !raw_punk.is_null() {
            let vtbl = *(raw_punk as *const *const RawIUnknownVtbl);
            ((*vtbl).add_ref)(raw_punk);
        }
        return S_OK_HR;
    }

    if tymed == TYMED_GDI.0 as u32 {
        let src_hbmp = src.u.hBitmap.0 as isize;
        if src_hbmp == 0 {
            return E_OUTOFMEMORY_HR;
        }
        let copied = CopyImage(src_hbmp, IMAGE_BITMAP_TYPE, 0, 0, LR_CREATEDIBSECTION_FLAG);
        if copied == 0 {
            return E_OUTOFMEMORY_HR;
        }
        (*dst).tymed = tymed;
        (*dst).u.hBitmap = HBITMAP(copied as *mut c_void);
        return S_OK_HR;
    }

    DV_E_TYMED_HR
}

unsafe extern "system" fn data_obj_query_interface(
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
    // Note: Intentionally do NOT implement `IAsyncOperation` / `IDataObjectAsyncCapability` so
    // DaVinci Resolve and Premiere Pro treat this drag source as immediate synchronous CF_HDROP!
    if iid == IID_IUNKNOWN || iid == IID_IDATAOBJECT {
        *ppv = this;
        data_obj_add_ref(this);
        S_OK_HR
    } else {
        E_NOINTERFACE_HR
    }
}

unsafe extern "system" fn data_obj_add_ref(this: *mut c_void) -> u32 {
    let obj = &*(this as *const SyncFileDataObject);
    obj.ref_count.fetch_add(1, Ordering::Relaxed) + 1
}

unsafe extern "system" fn data_obj_release(this: *mut c_void) -> u32 {
    let obj = &*(this as *const SyncFileDataObject);
    let prev = obj.ref_count.fetch_sub(1, Ordering::Release);
    if prev == 1 {
        std::sync::atomic::fence(Ordering::Acquire);
        drop(Box::from_raw(this as *mut SyncFileDataObject));
        0
    } else {
        prev - 1
    }
}

unsafe extern "system" fn data_obj_get_data(
    this: *mut c_void,
    pformatetc_in: *const FORMATETC,
    pmedium: *mut STGMEDIUM,
) -> HRESULT {
    if pformatetc_in.is_null() || pmedium.is_null() {
        return E_POINTER_HR;
    }
    let req = &*pformatetc_in;
    let obj = &*(this as *const SyncFileDataObject);

    if let Ok(entries) = obj.entries.lock() {
        for entry in entries.iter() {
            if format_matches(req, &entry.fmt) {
                return duplicate_stgmedium(&entry.med, pmedium);
            }
        }
    }
    std::ptr::write_bytes(pmedium, 0, 1);
    DV_E_FORMATETC_HR
}

unsafe extern "system" fn data_obj_get_data_here(
    _this: *mut c_void,
    _pformatetc: *const FORMATETC,
    _pmedium: *mut STGMEDIUM,
) -> HRESULT {
    E_NOTIMPL_HR
}

unsafe extern "system" fn data_obj_query_get_data(
    this: *mut c_void,
    pformatetc: *const FORMATETC,
) -> HRESULT {
    if pformatetc.is_null() {
        return E_POINTER_HR;
    }
    let req = &*pformatetc;
    let obj = &*(this as *const SyncFileDataObject);
    if let Ok(entries) = obj.entries.lock() {
        for entry in entries.iter() {
            if format_matches(req, &entry.fmt) {
                return S_OK_HR;
            }
        }
    }
    DV_E_FORMATETC_HR
}

unsafe extern "system" fn data_obj_get_canonical_format_etc(
    _this: *mut c_void,
    pformatetc_in: *const FORMATETC,
    pformatetc_out: *mut FORMATETC,
) -> HRESULT {
    if pformatetc_out.is_null() {
        return E_POINTER_HR;
    }
    if !pformatetc_in.is_null() {
        *pformatetc_out = *pformatetc_in;
    }
    (*pformatetc_out).ptd = null_mut();
    DATA_S_SAMEFORMATETC_HR
}

unsafe extern "system" fn data_obj_set_data(
    this: *mut c_void,
    pformatetc: *const FORMATETC,
    pmedium: *const STGMEDIUM,
    f_release: BOOL,
) -> HRESULT {
    if pformatetc.is_null() || pmedium.is_null() {
        return E_POINTER_HR;
    }
    let mut fmt = *pformatetc;
    fmt.ptd = null_mut();

    let owned_med = if f_release.as_bool() {
        // Ownership of `*pmedium` transfers directly to us without extra AddRef/copy
        std::ptr::read(pmedium)
    } else {
        let mut cloned: STGMEDIUM = std::mem::zeroed();
        let hr = duplicate_stgmedium(&*pmedium, &mut cloned);
        if hr.0 < 0 {
            return hr;
        }
        cloned
    };

    let obj = &*(this as *const SyncFileDataObject);
    let new_entry = StoredMediumEntry {
        fmt,
        med: owned_med,
    };
    // Swap out any replaced entry and drop it strictly AFTER releasing the mutex so
    // any re-entrant COM ReleaseStgMedium callback cannot deadlock or violate aliasing.
    let replaced = {
        let mut entries = match obj.entries.lock() {
            Ok(g) => g,
            Err(poisoned) => poisoned.into_inner(),
        };
        if let Some(existing) = entries.iter_mut().find(|e| {
            e.fmt.cfFormat == fmt.cfFormat
                && e.fmt.dwAspect == fmt.dwAspect
                && e.fmt.lindex == fmt.lindex
        }) {
            Some(std::mem::replace(existing, new_entry))
        } else {
            entries.push(new_entry);
            None
        }
    };
    drop(replaced);
    S_OK_HR
}

unsafe extern "system" fn data_obj_enum_format_etc(
    this: *mut c_void,
    dw_direction: u32,
    ppenum: *mut *mut c_void,
) -> HRESULT {
    if ppenum.is_null() {
        return E_POINTER_HR;
    }
    *ppenum = null_mut();
    if dw_direction != DATADIR_GET.0 as u32 {
        return E_NOTIMPL_HR;
    }
    let obj = &*(this as *const SyncFileDataObject);
    let formats: Vec<FORMATETC> = match obj.entries.lock() {
        Ok(entries) => entries.iter().map(|e| e.fmt).collect(),
        Err(_) => Vec::new(),
    };
    if formats.is_empty() {
        return E_INVALIDARG_HR;
    }
    SHCreateStdEnumFmtEtc(formats.len() as u32, formats.as_ptr(), ppenum)
}

unsafe extern "system" fn data_obj_d_advise(
    _this: *mut c_void,
    _pformatetc: *const FORMATETC,
    _advf: u32,
    _padv_sink: *mut c_void,
    _pdw_connection: *mut u32,
) -> HRESULT {
    OLE_E_ADVISENOTSUPPORTED_HR
}

unsafe extern "system" fn data_obj_d_unadvise(_this: *mut c_void, _dw_connection: u32) -> HRESULT {
    OLE_E_ADVISENOTSUPPORTED_HR
}

unsafe extern "system" fn data_obj_enum_d_advise(
    _this: *mut c_void,
    _ppenum_advise: *mut *mut c_void,
) -> HRESULT {
    OLE_E_ADVISENOTSUPPORTED_HR
}

pub(super) unsafe fn create_sync_file_data_object(paths: &[PathBuf]) -> Result<IDataObject, String> {
    let hdrop_bytes = build_hdrop_payload(paths)?;
    let hglobal = alloc_hglobal_bytes(&hdrop_bytes)
        .ok_or_else(|| "Out of memory allocating CF_HDROP HGLOBAL".to_string())?;

    let fmt = FORMATETC {
        cfFormat: CF_HDROP_FORMAT,
        ptd: null_mut(),
        dwAspect: DVASPECT_CONTENT.0,
        lindex: -1,
        tymed: TYMED_HGLOBAL.0 as u32,
    };

    let mut med: STGMEDIUM = std::mem::zeroed();
    med.tymed = TYMED_HGLOBAL.0 as u32;
    med.u.hGlobal = windows::Win32::Foundation::HGLOBAL(hglobal as *mut c_void);

    let mut entries = Vec::with_capacity(3);
    entries.push(StoredMediumEntry { fmt, med });

    // Advertise Explorer-standard `Preferred DropEffect = DROPEFFECT_COPY` so Shell/Qt/NLE
    // targets immediately know COPY is preferred without risking accidental file moves.
    if let Some(cf_pref) = register_clipboard_format("Preferred DropEffect") {
        let copy_effect_bytes = 1u32.to_le_bytes(); // DROPEFFECT_COPY
        if let Some(hpref) = alloc_hglobal_bytes(&copy_effect_bytes) {
            let mut pref_med: STGMEDIUM = std::mem::zeroed();
            pref_med.tymed = TYMED_HGLOBAL.0 as u32;
            pref_med.u.hGlobal = windows::Win32::Foundation::HGLOBAL(hpref as *mut c_void);
            entries.push(StoredMediumEntry {
                fmt: FORMATETC {
                    cfFormat: cf_pref,
                    ptd: null_mut(),
                    dwAspect: DVASPECT_CONTENT.0,
                    lindex: -1,
                    tymed: TYMED_HGLOBAL.0 as u32,
                },
                med: pref_med,
            });
        }
    }

    // Companion standard Windows Shell `FileNameW` format for single-file drops.
    if paths.len() == 1 {
        if let (Some(cf_fname), Some(fname_bytes)) = (
            register_clipboard_format("FileNameW"),
            build_filenamew_payload(&paths[0]),
        ) {
            if let Some(hfname) = alloc_hglobal_bytes(&fname_bytes) {
                let mut fname_med: STGMEDIUM = std::mem::zeroed();
                fname_med.tymed = TYMED_HGLOBAL.0 as u32;
                fname_med.u.hGlobal = windows::Win32::Foundation::HGLOBAL(hfname as *mut c_void);
                entries.push(StoredMediumEntry {
                    fmt: FORMATETC {
                        cfFormat: cf_fname,
                        ptd: null_mut(),
                        dwAspect: DVASPECT_CONTENT.0,
                        lindex: -1,
                        tymed: TYMED_HGLOBAL.0 as u32,
                    },
                    med: fname_med,
                });
            }
        }
    }

    let boxed = Box::new(SyncFileDataObject {
        vtbl: &DATA_OBJECT_VTBL,
        ref_count: AtomicU32::new(1),
        entries: Mutex::new(entries),
    });

    Ok(IDataObject::from_raw(Box::into_raw(boxed) as *mut c_void))
}