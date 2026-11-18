# Audify — Architecture & Engineering Reference (v0.2+)

> **Note:** For binding engineering rules covering modularity, file size limits, performance, security, and UI consistency, see [AGENTS.md](AGENTS.md). For visual design philosophy, see [DESIGN.md](DESIGN.md); for phased implementation plans, see [ROADMAP.md](ROADMAP.md).

---

## 1. Project Goal & Core Architecture
**Audify** is a high-density local audio & SFX sample manager built for video editing (`DaVinci Resolve`, `Premiere Pro`) and sound design workflows using **Tauri v2 (Rust Backend) + React 18 / TypeScript / TailwindCSS + Zustand**.

- **Database (Rust):** `rusqlite` (SQLite) + **FTS5** full-text search (`samples_fts`) + schema migrations (`user_version`).
- **Audio Processing & Analysis (Rust):**
  - `symphonia` & `lofty`: Audio decoding, duration/sample-rate/bit-depth probing, embedded metadata extraction, 200-bin / hi-res waveform peak caching, and varispeed/micro-fade WAV slice export (`audio.rs`).
  - `dsp_analysis.rs`: Pure-Rust spectral-flux BPM estimation and Krumhansl-Kessler / Camelot musical key detection.
- **Waveform & Playback (Frontend):** Custom HTML5 Canvas renderers (`WaveformDeckCanvas`, `MiniWaveform`), `AudioEngine`, and `playheadClock` isolated from React renders for smooth 60 FPS animation.
- **Virtualized Table:** `@tanstack/react-virtual` (engineered for 50,000+ audio rows).
- **Native OS Drag-and-Drop (DAW/NLE):**
  - Standard HTML5 `draggable` is NOT USED (Windows WebView2 cannot drop files into external desktop applications).
  - On Windows, `src-tauri/src/win_drag.rs` invokes native COM `IDataObject` / `HDROP` / `DoDragDrop` (with a `> 4px` pointer threshold and temp slice WAV export).
- **Multi-Window & Modes:** Main studio window, standalone/modal `Settings` window (`?window=settings`), and Always-on-Top `Mini Dock` overlay mode; `Dark`, `Light`, and `Contrast` themes + dynamic Accent (including `Auto`) and Animated ASCII / Wallpaper atmosphere layers.

---

## 2. Core Development Principles (Summary)
1. **Prevent File Bloat:** Keep UI and store files within the `<= 450–600` line limits; split new features into modular subfolders/services rather than piling code into existing files.
2. **Layer Boundaries:** Never import React components (`src/components/**`) from the store (`src/store/**`). Keep static constants under `src/constants/`, and keep `src/types.ts` strictly type-only.
3. **Performance First:** Preserve `React.memo` integrity on virtualized table rows (`SampleTableRow`, `MiniWaveform`), pass explicit dimensions, never read layout (`getBoundingClientRect`) in animation loops, and avoid repeatedly scanning the large `allProfileSamples` array in side panels.
4. **Security & Robustness:** Validate all file paths through `security.rs`; keep hex color validation and profile settings allowlist (`ALLOWED_PROFILE_SETTINGS_KEYS`) in sync; never pop Undo/Redo stacks before async operations succeed.
5. **Shared Window & Theme Design:** All three windows (`Main`, `Settings`, `Mini Dock`) must share pixel-locked `WindowCaptionControls` icon/title alignment; all overlay/Mica rules must work seamlessly across `Dark`, `Light`, and `Contrast`.
6. **Zero Quality Compromise:** Leave no placeholders (`// todo`), `: any`, `as any`, `@ts-ignore`, or forbidden opacity token classes; pass the [AGENTS.md](AGENTS.md#5-pre-delivery-verification-gate) verification gate before delivery.
