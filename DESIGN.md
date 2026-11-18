# DESIGN.md — Audify Pro-Audio Design System

This document defines Audify's **visual language, theme token system, atmosphere layers, and UI standards**. The single binding authority for code architecture, file size caps, Zustand selector rules, the Rust security gate, and pre-delivery verification is [AGENTS.md](AGENTS.md).

Audify is not a marketing website or a generic SaaS dashboard; it is a high-density desktop audio & SFX engineering tool inspired by **Sononym, DaVinci Resolve (Fairlight), Ableton Live, and Teenage Engineering**.

---

## 1. Core Rules & Anti-Slop Prohibitions

- **FORBIDDEN:** SaaS-style purple/indigo gradient (`bg-gradient-to-r from-indigo-500...`) backgrounds or buttons.
- **FORBIDDEN:** Navy-tinted dark surfaces such as `slate-900` / `gray-900`. Only neutral carbon/graphite (`surface-*`) tones are permitted.
- **FORBIDDEN:** Oversized card padding (`p-6`, `p-8`, `gap-6`) or cushioned web cards (`rounded-2xl` / `rounded-3xl`). Primary data views live on a high-density `1px` structural grid.
- **FORBIDDEN:** Bouncy or sluggish animations (`duration-300+`). Interaction feedback must feel instantaneous (`0ms–75ms`, global `60ms linear`).
- **FORBIDDEN:** Unicode emojis or text symbols (`★`, `⚙`, `🗑`, `▶`, `✕`, etc.) inside UI controls. All icons are rendered with `lucide-react` (`w-3 h-3`, `w-3.5 h-3.5`, `w-4 h-4`), and window caption glyphs are drawn as pixel-crisp SVGs inside `WindowCaptionControls`. *(Exception: Animated ASCII Wallpaper canvases and previews in Settings → Appearance.)*

---

## 2. Theme System (`Dark` / `Light` / `Contrast`) & Tokens

### Golden Rule

Component code (`src/components/**`) must never hardcode raw hex values (`bg-[#...]`), `bg-black/*`, or `text-white` *(except the red `bg-danger` / `Close` hover button and dynamic color-picker contrast calculation)*. All surfaces use the semantic token classes defined in [`src/index.css`](src/index.css) and [`tailwind.config.js`](tailwind.config.js).

### Semantic Token Reference

| Role | Tailwind Class | Dark | Light | Contrast |
|---|---|---|---|---|
| Root canvas / base | `bg-surface-0` | `#0D0D0F` | `#F4F5F8` | `#000000` |
| Panel (sidebar, deck, statusbar) | `bg-surface-1` | `#141417` | `#EAECEF` | `#050505` |
| Vertical icon rail | `bg-surface-rail` | `#101013` | `#E2E5EC` | `#000000` |
| Section header strip | `bg-surface-header` | `#16161A` | `#E6E8EF` | `#0A0A0A` |
| Elevated card / popover | `bg-surface-2` | `#18181C` | `#FAFAFC` | `#0A0A0A` |
| Input / secondary button | `bg-surface-3` | `#1C1C21` | `#FFFFFF` | `#121212` |
| Badge / tag chip surface | `bg-surface-badge` | `#1E1E24` | `#E7E9F0` | `#141414` |
| Hover surface | `bg-surface-hover` | `#1A1A1F` | `#E3E7F2` | `#181818` |
| Selected / active surface | `bg-accent-soft` | accent-derived | accent-derived | `#1F1F1F` |
| Primary grid divider (`1px`) | `border-line` | `#26262C` | `#CBCDD8` | `#525252` |
| Row separator | `border-line-subtle` | `#18181C` | `#DFDFE8` | `#262626` |
| Strong border | `border-line-strong` | `#2E2E38` | `#B0B4C2` | `#666666` |
| Hover border | `border-line-hover` | `#4A4A55` | `#8C90A1` | `#888888` |
| Primary text | `text-fg` | `#F4F4F8` | `#111216` | `#FFFFFF` |
| Secondary text | `text-fg-2` | `#C8C8D4` | `#363945` | `#D4D4D4` |
| Muted / helper text | `text-fg-3` | `#9E9EAE` | `#525666` | `#A3A3A3` |
| Section heading text | `text-fg-head` | `#B8B8C6` | `#484C5B` | `#CCCCCC` |
| Faintest / inactive text | `text-fg-faint` | `#4A4A55` | `#8F94A4` | `#777777` |
| Accent fill / border | `bg-accent` `border-accent` | user accent | normalized accent | normalized accent |
| Accent text (on surfaces) | `text-accent-fg` | high-contrast accent | darkened accent | high-contrast accent |
| Text on solid accent fill | `text-accent-on` | `#0D0D0F` | `#0D0D0F` | `#000000` |
| Success / Feedback *(passive)* | `text-ok` `bg-ok/15` `border-ok` | `#10B981` | `#059669` | `#34D399` |
| Warning | `text-warn` `bg-warn/15` `border-warn` | `#F59E0B` | `#B45309` | `#FACC15` |
| Info | `text-info` `bg-info/15` `border-info` | `#60A5FA` | `#2563EB` | `#38BDF8` |
| Error / Delete confirm / Close hover | `text-danger` `bg-danger` | `#EF4444` | `#DC2626` | `#EF4444` |

### Critical Token Rules

- **Theme Accent Priority (Interactive Controls):** Interactive buttons, toggles (`Loop`, `Global`, switch pills), context menu items (`Restore from Trash`, `Send to Recycle Bin`, `Move to Trash`, `Undo Rename`), and waveform slice controls (`FULL`, slice range pill, `DRAG TO NLE`, In/Out handles, Clear Slice `[X]`) must follow the active theme accent (`accent` / `bg-accent-soft` / `text-accent-fg` / `border-accent`) rather than hardcoded green (`ok`) or menu-hover `danger` red. Reserve `ok`/`warn`/`danger` strictly for passive feedback banners/toasts and destructive confirmation dialogs.
- **Opacity Modifier Boundary:** Tailwind alpha modifiers such as `/15` or `/40` work **only** on colors backed by `--*-rgb` triplets (`accent`, `accent-fg`, `ok`, `warn`, `info`, `danger`). Never apply `/80` to `surface-*`, `line*`, or `fg*` classes (which use flat `--c-*` variables); when translucent surfaces are needed, use `.bg-surface-sub` / `.bg-surface-soft` (`color-mix`).
- **Light Theme Depth Hierarchy:** The main canvas (`surface-0`) is the lightest layer, panels (`surface-1`) are one step darker, and the vertical icon rail (`surface-rail`) is the darkest surface; flat single-tone gray layouts are forbidden.
- **Auto Contrast & Auto Accent:** [`applyThemeAndAccentToDom`](src/store/themeDom.ts) automatically boosts overly dark accents in Dark/Contrast mode and darkens overly bright accents in Light mode (`--accent-fg-rgb`). When `Auto Accent` is enabled, a harmonious accent color is extracted from the active wallpaper (`extractDominantImageAccent`) or active ASCII preset palette (`getPresetAutoAccentHex`).
- **Canvas Drawing:** `WaveformDeckCanvas` and `MiniWaveform` must never hardcode hex colors; read CSS theme tokens via [`getCanvasThemePalette`](src/utils/format.ts).

---

## 3. Scale, Typography & Interaction

- **Border Radii (`tailwind.config.js`):**
  - `rounded-[2px]` / `rounded-[3px]` (`rounded-2xs`): uniform rounded-square color swatches (profile badges, Tags & Rules, Genres, filter pills, batch bar, context submenus, inspector & color picker headers), tag/genre chips, segmented buttons
  - `rounded-xs` (`5px`): larger badges, compact buttons
  - `rounded-sm` (`6px`): inputs, buttons, inline row controls
  - `rounded-md` (`8px`): settings cards, inspector panels, context menus
  - `rounded-lg` (`10px`): modal dialogs, popovers, empty-state cards (`SettingsModal`, `ColorPickerPopover`, `QuickCreatePopover`)
  - `rounded-full`: status dots and notification counters *(never color swatches)*
- **Typography:**
  - UI copy: `Inter` / system `sans-serif` (`11px–13px` data density; section titles `10px–11px uppercase tracking-wider text-fg-head`).
  - Technical values: duration, `BPM`, sample rate, bit depth, file size, slider readouts, and counters must always use `font-mono` (`tabular-nums`).
- **Interaction & Focus:**
  - Clickable controls respond with `60ms linear` transitions, `:active` (`1px` press + neutral overlay), and `:focus-visible` (`1px solid var(--signal-accent)`).
  - Scrollbars use a slim (`7px`) studio profile; `input[type="range"]` uses rectangular (`6px × 12px`) accent thumbs.
  - Every icon-only button must define `title` (automatically synced with `aria-label` across the app).

---

## 4. Visual Atmosphere, Wallpaper & Animated ASCII

In `High Contrast` (`data-theme="contrast"`) mode, the atmosphere layer is automatically disabled for maximum legibility. In `Dark` and `Light` modes, these layers are controlled under `Settings → Appearance` (`AppAtmosphereViewport.tsx`):

1. **Surface Style Presets (`data-mica="true"` / `false`):**
   - **Studio Matte:** Solid, high-contrast matte work surface (`enableMica = false`).
   - **Frosted Mica:** Semi-translucent sidebar/titlebar/header surfaces (`backdrop-filter: blur(...)`) over a crisp (`0px` blur) background.
   - **Soft Ambient:** Studio chrome with diffused ambient backdrop blur.
2. **Layer Controls:**
   - **Tint (`0%–100%`):** Infuses surfaces with the active accent color via `color-mix` and `--tint-*` variables.
   - **Backdrop blur (`0px–40px`):** Applied in place to the background layer via `backdropFilter` without distorting the `1:1` framing or causing zoom jumps.
   - **Visibility (`5%–100%`):** Opacity control for the wallpaper or ASCII background layer.
3. **Background Modes:**
   - **Animated ASCII Scenes:** Live scenes across 6 categories (`Nature`, `Camp`, `Ocean`, `Space`, `City`, `Studio`) with `Pause / Calm / Normal / Lively` speed presets. Scenic presets preserve their artistic palette consistently in Dark & Light modes; `Studio` technical presets adapt to the active theme palette.
   - **Uploaded Images:** High-resolution custom wallpaper gallery with one-click conversion into a live ASCII canvas (`imageAsAscii`).
4. **Legibility Protection:** When a background layer is active (`data-has-bg="true"`), center canvas surfaces apply `.audify-stage-surface` and `.audify-row-surface` so rows remain legible in both Dark and Light modes.

---

## 5. Window Chrome & Component Standards

- **Uniform Window Chrome (`Main`, `Settings`, `Mini Dock`):** All three window title bars share [`WindowCaptionControls`](src/components/WindowCaptionControls.tsx) (`11×11` pixel-crisp SVG glyphs, `shapeRendering="crispEdges"`, `strokeWidth="1"`, `Close` hover `bg-danger hover:text-white`) and consistent profile pill / typography geometry.
- **Main Studio Layout:**
  - `TopHeaderBar` + `TopTransportDeck` (`WaveformDeckCanvas` featuring `0dB` centerline, time ruler, ghost playhead, pitch/volume controls, and accent-themed In/Out slice region).
  - `LeftSidebar`: Icon rail + tree panels (`All Files / Favorites / Recent`, `Folders`, `Collections`, `Tags`, `Genres`, `Licenses`, `Session Bin`, `Quarantine Trash`).
  - `SampleTable`: `34px` virtualized rows, 12 reorderable/hideable columns (`class`, `name`, `waveform`, `artist`, `album`, `year`, `genre`, `bpm`, `key`, `tags`, `time`, `format`), inline `F2` rename, and multi-select batch bar (`SampleBatchActionBar`).
- **Mini Dock (`MiniDockShell`):** Always-on-top compact browser with `28px` virtualized rows sharing the exact theme tokens and native OS/NLE drag-and-drop pipeline of the main window.
- **Portals & Accessibility:** Context menus, popovers, and modals render via `createPortal(..., document.body)`; modals enforce `role="dialog"`, `aria-modal="true"`, and `Esc` dismissal.
- **Direct Drag-and-Drop:** No extra `DRAG WAV` / `DRAG SLICE` clutter buttons — dragging from a sample row or slice selection routes directly to in-app left-rail drop targets or external NLE/Explorer windows (`startNativeSampleDrag`, `startNativeSliceDrag`).
- **Protected Vault & Reversible Deletion:** `Protected Vault` libraries display an explicit lock badge; deletion and permanent removal actions require two-step confirmation (`InlineConfirmDeleteButton` / confirmation dialog).

---

## 6. Phase D (AI Tagger) Visual Guidelines

AI analysis, auto-tagging, and classification components introduced under Phase D must fit seamlessly into the existing design system:

- **Compact Status & Confidence Chips:** AI suggestions reuse the existing chip language (`rounded-xs`, `bg-surface-badge`, `border-line`, `font-mono tabular-nums`), visually distinguishing manual user entries (`is_manual`) from AI suggestions (`border-accent/40` or `text-info`).
- **Surface Hierarchy:** Batch AI analysis progress and model settings belong inside the dedicated `Settings` tab, compact top/bottom status strips, and subtle inline approve/dismiss row controls rather than giant floating overlays.
