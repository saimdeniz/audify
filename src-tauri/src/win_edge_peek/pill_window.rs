//! Ultra-lightweight native Win32 layered Edge-Peek handle (`WS_EX_LAYERED` + `UpdateLayeredWindow`).
//!
//! Renders an anti-aliased, theme-synced vertical pill flush to the monitor edge using a
//! 32-bit premultiplied BGRA DIB (zero extra WebView2 processes, zero `SetWindowRgn` GDI
//! clipping, zero white `WS_THICKFRAME` artifacts, and `MA_NOACTIVATE` so clicking or
//! hovering never steals focus from DaVinci Resolve or Premiere Pro).

use super::{EdgePillTheme, EdgeSide, PILL_HEIGHT_LOGICAL, PILL_WIDTH_LOGICAL};
use std::ffi::c_void;
use std::mem::size_of;
use std::ptr::null_mut;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::OnceLock;
use windows::core::PCWSTR;
use windows::Win32::Foundation::{COLORREF, HINSTANCE, HWND, LPARAM, LRESULT, POINT, SIZE, WPARAM};
use windows::Win32::Graphics::Gdi::{
    CreateCompatibleDC, CreateDIBSection, DeleteDC, DeleteObject, GetDC, ReleaseDC, SelectObject,
    AC_SRC_ALPHA, AC_SRC_OVER, BITMAPINFO, BITMAPINFOHEADER, BI_RGB, BLENDFUNCTION,
    DIB_RGB_COLORS,
};
use windows::Win32::System::LibraryLoader::GetModuleHandleW;
use windows::Win32::UI::WindowsAndMessaging::{
    CreateWindowExW, DefWindowProcW, DestroyWindow, DispatchMessageW, IsWindow, LoadCursorW,
    PeekMessageW, RegisterClassExW, SetCursor, SetWindowPos, ShowWindow, TranslateMessage,
    UpdateLayeredWindow, CS_HREDRAW, CS_VREDRAW, HWND_TOPMOST, IDC_HAND, MA_NOACTIVATE, MSG,
    PM_REMOVE, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE, SW_HIDE, SW_SHOWNOACTIVATE, ULW_ALPHA,
    WM_LBUTTONDOWN, WM_MOUSEACTIVATE, WM_SETCURSOR, WNDCLASSEXW, WS_EX_LAYERED, WS_EX_NOACTIVATE,
    WS_EX_TOOLWINDOW, WS_EX_TOPMOST, WS_POPUP,
};

static CLASS_REGISTERED: OnceLock<bool> = OnceLock::new();
static PILL_CLICKED: AtomicBool = AtomicBool::new(false);

fn wide_null(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}

pub(super) fn take_pill_clicked() -> bool {
    PILL_CLICKED.swap(false, Ordering::AcqRel)
}

unsafe extern "system" fn pill_wnd_proc(
    hwnd: HWND,
    msg: u32,
    wparam: WPARAM,
    lparam: LPARAM,
) -> LRESULT {
    match msg {
        WM_MOUSEACTIVATE => LRESULT(MA_NOACTIVATE as isize),
        WM_LBUTTONDOWN => {
            PILL_CLICKED.store(true, Ordering::Release);
            LRESULT(0)
        }
        WM_SETCURSOR => {
            if let Ok(cursor) = LoadCursorW(None, IDC_HAND) {
                SetCursor(Some(cursor));
                return LRESULT(1);
            }
            DefWindowProcW(hwnd, msg, wparam, lparam)
        }
        _ => DefWindowProcW(hwnd, msg, wparam, lparam),
    }
}

fn ensure_class_registered() -> bool {
    *CLASS_REGISTERED.get_or_init(|| unsafe {
        let hinstance: HINSTANCE = GetModuleHandleW(PCWSTR::null())
            .map(Into::into)
            .unwrap_or_default();
        let class_name = wide_null("AudifyEdgePeekPillWindow");
        let wc = WNDCLASSEXW {
            cbSize: size_of::<WNDCLASSEXW>() as u32,
            style: CS_HREDRAW | CS_VREDRAW,
            lpfnWndProc: Some(pill_wnd_proc),
            hInstance: hinstance,
            lpszClassName: PCWSTR(class_name.as_ptr()),
            ..Default::default()
        };
        RegisterClassExW(&wc) != 0
    })
}

pub(super) struct NativeEdgePill {
    hwnd: HWND,
    visible: bool,
    last_x: i32,
    last_y: i32,
    last_w: i32,
    last_h: i32,
    last_side: EdgeSide,
    last_theme: Option<EdgePillTheme>,
    last_hovered: bool,
}

impl NativeEdgePill {
    pub(super) fn new() -> Option<Self> {
        if !ensure_class_registered() {
            return None;
        }
        let class_name = wide_null("AudifyEdgePeekPillWindow");
        let title = wide_null("Audify Edge Handle");
        let Ok(hwnd) = (unsafe {
            let hinstance: HINSTANCE = GetModuleHandleW(PCWSTR::null())
                .map(Into::into)
                .unwrap_or_default();
            CreateWindowExW(
                WS_EX_LAYERED | WS_EX_TOPMOST | WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE,
                PCWSTR(class_name.as_ptr()),
                PCWSTR(title.as_ptr()),
                WS_POPUP,
                0,
                0,
                10,
                148,
                None,
                None,
                Some(hinstance),
                None,
            )
        }) else {
            return None;
        };
        if hwnd.is_invalid() {
            return None;
        }
        Some(Self {
            hwnd,
            visible: false,
            last_x: i32::MIN,
            last_y: i32::MIN,
            last_w: 0,
            last_h: 0,
            last_side: EdgeSide::Right,
            last_theme: None,
            last_hovered: false,
        })
    }

    pub(super) fn pump_messages(&self) {
        unsafe {
            let mut msg = MSG::default();
            while PeekMessageW(&mut msg, None, 0, 0, PM_REMOVE).as_bool() {
                let _ = TranslateMessage(&msg);
                DispatchMessageW(&msg);
            }
        }
    }

    pub(super) fn hide(&mut self) {
        if !self.visible {
            return;
        }
        unsafe {
            if IsWindow(Some(self.hwnd)).as_bool() {
                let _ = ShowWindow(self.hwnd, SW_HIDE);
            }
        }
        self.visible = false;
    }

    #[allow(clippy::too_many_arguments)]
    pub(super) fn show_or_update(
        &mut self,
        x: i32,
        y: i32,
        w: i32,
        h: i32,
        scale: f64,
        side: EdgeSide,
        theme: EdgePillTheme,
        hovered: bool,
    ) {
        let w = w.max(8);
        let h = h.max(48);
        let needs_redraw = self.last_w != w
            || self.last_h != h
            || self.last_side != side
            || self.last_theme != Some(theme)
            || self.last_hovered != hovered
            || self.last_x != x
            || self.last_y != y
            || !self.visible;

        let was_visible = self.visible;
        if needs_redraw {
            self.render_layered(x, y, w, h, scale, side, theme, hovered);
            self.last_x = x;
            self.last_y = y;
            self.last_w = w;
            self.last_h = h;
            self.last_side = side;
            self.last_theme = Some(theme);
            self.last_hovered = hovered;
        }

        if !was_visible || needs_redraw {
            unsafe {
                if IsWindow(Some(self.hwnd)).as_bool() {
                    if !self.visible {
                        let _ = ShowWindow(self.hwnd, SW_SHOWNOACTIVATE);
                        self.visible = true;
                    }
                    let _ = SetWindowPos(
                        self.hwnd,
                        Some(HWND_TOPMOST),
                        0,
                        0,
                        0,
                        0,
                        SWP_NOACTIVATE | SWP_NOMOVE | SWP_NOSIZE,
                    );
                }
            }
        }
    }

    #[allow(clippy::too_many_arguments)]
    fn render_layered(
        &self,
        x: i32,
        y: i32,
        w: i32,
        h: i32,
        scale: f64,
        side: EdgeSide,
        theme: EdgePillTheme,
        hovered: bool,
    ) {
        unsafe {
            if !IsWindow(Some(self.hwnd)).as_bool() {
                return;
            }
            let screen_dc = GetDC(None);
            if screen_dc.is_invalid() {
                return;
            }
            let mem_dc = CreateCompatibleDC(Some(screen_dc));
            if mem_dc.is_invalid() {
                let _ = ReleaseDC(None, screen_dc);
                return;
            }

            let bmi = BITMAPINFO {
                bmiHeader: BITMAPINFOHEADER {
                    biSize: size_of::<BITMAPINFOHEADER>() as u32,
                    biWidth: w,
                    biHeight: -h, // top-down DIB
                    biPlanes: 1,
                    biBitCount: 32,
                    biCompression: BI_RGB.0,
                    ..Default::default()
                },
                ..Default::default()
            };

            let mut bits_ptr: *mut c_void = null_mut();
            let dib = CreateDIBSection(
                Some(screen_dc),
                &bmi,
                DIB_RGB_COLORS,
                &mut bits_ptr,
                None,
                0,
            );
            let Ok(hbitmap) = dib else {
                let _ = DeleteDC(mem_dc);
                let _ = ReleaseDC(None, screen_dc);
                return;
            };
            if hbitmap.is_invalid() || bits_ptr.is_null() {
                if !hbitmap.is_invalid() {
                    let _ = DeleteObject(hbitmap.into());
                }
                let _ = DeleteDC(mem_dc);
                let _ = ReleaseDC(None, screen_dc);
                return;
            }

            let total_bytes = (w as usize) * (h as usize) * 4;
            let pixels = std::slice::from_raw_parts_mut(bits_ptr as *mut u8, total_bytes);
            paint_pill_rgba(pixels, w, h, scale as f32, side, theme, hovered);

            let old_obj = SelectObject(mem_dc, hbitmap.into());
            let pt_dst = POINT { x, y };
            let size = SIZE { cx: w, cy: h };
            let pt_src = POINT { x: 0, y: 0 };
            let blend = BLENDFUNCTION {
                BlendOp: AC_SRC_OVER as u8,
                BlendFlags: 0,
                SourceConstantAlpha: 255,
                AlphaFormat: AC_SRC_ALPHA as u8,
            };
            let _ = UpdateLayeredWindow(
                self.hwnd,
                Some(screen_dc),
                Some(&pt_dst),
                Some(&size),
                Some(mem_dc),
                Some(&pt_src),
                COLORREF(0),
                Some(&blend),
                ULW_ALPHA,
            );

            let _ = SelectObject(mem_dc, old_obj);
            let _ = DeleteObject(hbitmap.into());
            let _ = DeleteDC(mem_dc);
            let _ = ReleaseDC(None, screen_dc);
        }
    }
}

impl Drop for NativeEdgePill {
    fn drop(&mut self) {
        unsafe {
            if !self.hwnd.is_invalid() && IsWindow(Some(self.hwnd)).as_bool() {
                let _ = DestroyWindow(self.hwnd);
            }
        }
    }
}

pub(super) fn compute_pill_dimensions(work_h: i32, scale: f64) -> (i32, i32) {
    let pill_w = (PILL_WIDTH_LOGICAL * scale).round().max(9.0) as i32;
    let pill_h = ((PILL_HEIGHT_LOGICAL * scale).round() as i32)
        .min(work_h.saturating_sub(32))
        .max(64);
    (pill_w, pill_h)
}

fn mix_rgb(a: (u8, u8, u8), b: (u8, u8, u8), t: f32) -> (f32, f32, f32) {
    let t = t.clamp(0.0, 1.0);
    (
        (a.0 as f32) * (1.0 - t) + (b.0 as f32) * t,
        (a.1 as f32) * (1.0 - t) + (b.1 as f32) * t,
        (a.2 as f32) * (1.0 - t) + (b.2 as f32) * t,
    )
}

fn sdf_rounded_box(px: f32, py: f32, half_w: f32, half_h: f32, radius: f32) -> f32 {
    let r = radius.min(half_w).min(half_h).max(0.0);
    let qx = px.abs() - (half_w - r);
    let qy = py.abs() - (half_h - r);
    let out_dist = (qx.max(0.0).powi(2) + qy.max(0.0).powi(2)).sqrt();
    let in_dist = qx.max(qy).min(0.0);
    out_dist + in_dist - r
}

fn over_premul(dst: [f32; 4], src_rgb: (f32, f32, f32), src_a: f32) -> [f32; 4] {
    let a = src_a.clamp(0.0, 1.0);
    if a <= 0.0001 {
        return dst;
    }
    let inv = 1.0 - a;
    [
        src_rgb.0 * a + dst[0] * inv,
        src_rgb.1 * a + dst[1] * inv,
        src_rgb.2 * a + dst[2] * inv,
        a + dst[3] * inv,
    ]
}

/// Renders an anti-aliased premultiplied BGRA pill bitmap matching Audify's theme & accent.
pub(super) fn paint_pill_rgba(
    buf: &mut [u8],
    w: i32,
    h: i32,
    scale: f32,
    side: EdgeSide,
    theme: EdgePillTheme,
    hovered: bool,
) {
    let wf = w as f32;
    let hf = h as f32;
    let radius = (5.5 * scale).min(wf * 0.72);
    let border_w = (1.15 * scale).max(1.0);

    // Extend the SDF box past the screen-flush edge so the screen-touching side stays crisp & square
    let ext = radius + 2.0;
    let (shape_cx, shape_hw) = match side {
        EdgeSide::Right => ((wf + ext) * 0.5, (wf + ext) * 0.5),
        EdgeSide::Left => ((wf - ext) * 0.5, (wf + ext) * 0.5),
    };
    let shape_cy = hf * 0.5;
    let shape_hh = hf * 0.5;

    let accent_mix = if hovered {
        if theme.is_light { 0.24 } else { 0.28 }
    } else if theme.is_light {
        0.13
    } else {
        0.16
    };
    let body_rgb = mix_rgb(theme.surface, theme.accent, accent_mix);
    let body_alpha = if hovered { 0.98 } else { 0.94 };

    let border_rgb = mix_rgb(theme.border, theme.accent, if hovered { 0.95 } else { 0.78 });
    let border_alpha = if hovered { 0.98 } else { 0.85 };
    let accent_rgb = (theme.accent.0 as f32, theme.accent.1 as f32, theme.accent.2 as f32);

    // Center grip capsule + top/bottom rounded-square indicator dots
    let grip_cx = match side {
        EdgeSide::Right => wf * 0.54,
        EdgeSide::Left => wf * 0.46,
    };
    let grip_hw = (1.45 * scale).max(1.2);
    let grip_hh = (23.0 * scale).min(hf * 0.28);
    let dot_half = (1.45 * scale).max(1.2);
    let dot_r = (0.65 * scale).max(0.5);
    let dot_offset = grip_hh + (7.5 * scale).max(6.0);

    for py in 0..h {
        let fy = (py as f32) + 0.5;
        for px in 0..w {
            let fx = (px as f32) + 0.5;
            let d_outer = sdf_rounded_box(fx - shape_cx, fy - shape_cy, shape_hw, shape_hh, radius);
            let outer_cov = (0.5 - d_outer).clamp(0.0, 1.0);

            let idx = ((py * w + px) as usize) * 4;
            if outer_cov <= 0.001 {
                buf[idx] = 0;
                buf[idx + 1] = 0;
                buf[idx + 2] = 0;
                buf[idx + 3] = 0;
                continue;
            }

            let mut col = over_premul([0.0; 4], body_rgb, body_alpha * outer_cov);

            // Inner + top/bottom border (exclude outer screen-edge pixel)
            let on_screen_edge = match side {
                EdgeSide::Right => fx > wf - border_w * 0.5,
                EdgeSide::Left => fx < border_w * 0.5,
            };
            if !on_screen_edge {
                let d_inner = d_outer + border_w;
                let inner_cov = (0.5 - d_inner).clamp(0.0, 1.0);
                let ring_cov = (outer_cov - inner_cov).clamp(0.0, 1.0);
                if ring_cov > 0.001 {
                    col = over_premul(col, border_rgb, border_alpha * ring_cov);
                }
            }

            // Center vertical accent capsule
            let d_grip = sdf_rounded_box(fx - grip_cx, fy - shape_cy, grip_hw, grip_hh, grip_hw);
            let grip_cov = (0.5 - d_grip).clamp(0.0, 1.0) * outer_cov;
            if grip_cov > 0.001 {
                col = over_premul(col, accent_rgb, (if hovered { 1.0 } else { 0.94 }) * grip_cov);
            }

            // Top and bottom rounded-square micro-dots
            let d_dot_top = sdf_rounded_box(
                fx - grip_cx,
                fy - (shape_cy - dot_offset),
                dot_half,
                dot_half,
                dot_r,
            );
            let d_dot_bot = sdf_rounded_box(
                fx - grip_cx,
                fy - (shape_cy + dot_offset),
                dot_half,
                dot_half,
                dot_r,
            );
            let dot_cov = (0.5 - d_dot_top.min(d_dot_bot)).clamp(0.0, 1.0) * outer_cov;
            if dot_cov > 0.001 {
                col = over_premul(col, accent_rgb, (if hovered { 0.88 } else { 0.68 }) * dot_cov);
            }

            // Write premultiplied BGRA bytes
            buf[idx] = col[2].round().clamp(0.0, 255.0) as u8;
            buf[idx + 1] = col[1].round().clamp(0.0, 255.0) as u8;
            buf[idx + 2] = col[0].round().clamp(0.0, 255.0) as u8;
            buf[idx + 3] = (col[3] * 255.0).round().clamp(0.0, 255.0) as u8;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pill_bitmap_renders_transparent_inner_corners_and_opaque_accent_center() {
        let w = 10;
        let h = 148;
        let mut buf = vec![0u8; (w * h * 4) as usize];
        let theme = EdgePillTheme {
            surface: (18, 20, 24),
            border: (48, 54, 66),
            accent: (56, 189, 248),
            is_light: false,
        };
        paint_pill_rgba(&mut buf, w, h, 1.0, EdgeSide::Right, theme, false);

        // Top-left corner (rounded inner edge) should be transparent
        assert_eq!(buf[3], 0);
        // Top-right corner (flush with screen edge) should be visible
        let tr_idx = ((w - 1) * 4) as usize;
        assert!(buf[tr_idx + 3] > 200);
        // Center grip pixel should carry strong accent blue/cyan channels
        let mid_idx = (((h / 2) * w + (w / 2)) * 4) as usize;
        assert!(buf[mid_idx] > 200); // B channel of #38BDF8
        assert!(buf[mid_idx + 3] > 230); // Alpha
    }
}
