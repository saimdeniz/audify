# Audify Engineering Rules (Always-On Workspace Guide)

This file defines binding engineering rules for developing Audify (`Tauri v2 + React 18/TypeScript + Rust/SQLite`) to prevent code bloat, spaghetti architecture, performance regressions, and security or theme regressions.

---

## 1. Modularity, File Size & Unidirectional Architecture

1. **File Size Thresholds (Anti-Bloat / Anti-Spaghetti)**
   - Keep React components and Zustand slice files under a target of **<= 450 lines**; do not accumulate new code beyond **600 lines** in a single file — split into subcomponents, hooks, or helper modules.
   - Target **<= 500 lines** for utility and Rust modules (excluding inline `#[cfg(test)]` blocks); always introduce major new features (e.g., Phase D `ai_tagger`, new preset categories) in dedicated submodules.
   - Break long or complex logic into small, single-purpose helper functions (shallow nesting + early returns).
2. **Layer Discipline (No Circular Dependencies)**
   - Dependency flow is strictly unidirectional: `components/` → `hooks/` / `services/` → `store/` → `utils/` → Rust `commands/`.
   - **FORBIDDEN:** Importing from `src/components/**` inside `src/store/**`. Shared concerns such as audio engine control live in the neutral `src/services/` layer.
   - **FORBIDDEN:** Embedding static data lists (`ASCII_PRESETS`, color palettes, default rules) or runtime functions inside `src/types.ts`; keep data constants under `src/constants/`.
3. **No Duplicate Logic (Single Source of Truth)**
   - Never re-implement helpers or UI pieces that already exist (e.g., Turkish character folding, path normalization, audio extension lists, hex validation, delete confirmation buttons, pitch/volume controls, window caption controls). Import from the shared module instead.
4. **Rust Separation of Concerns**
   - `commands/*.rs` files are responsible for IPC validation and coordination; extract complex SQL/FTS5 query builders, profile import/export heuristics, or DSP/AI logic into dedicated domain modules.

---

## 2. Performance, Memory & Bundle Optimization

1. **Zustand Selector Rules**
   - Parameterless `useSampleStore()` calls are **STRICTLY FORBIDDEN**.
   - Inside virtualized list rows (`SampleTableRow`, `MiniWaveform`), never subscribe to store actions (`useSampleStore.getState()` must be used), and pass shared theme/waveform settings to rows as a single memoized object or top-level memoized prop.
   - Side panels/toolbars must not subscribe directly to `allProfileSamples` (50k+ items) and run full-array scans inside `useMemo`; read precomputed counts and summaries from the store/filter engine.
2. **`React.memo` Integrity & Virtualized Table**
   - Never pass new inline arrow callbacks `() => ...`, new object literals `{}`, or new array literals `[]` in the render body to child components wrapped in `React.memo`.
   - Pass explicit width props directly to known fixed-width components (`MiniWaveform`); do not create unnecessary `ResizeObserver` instances on virtualized table rows.
3. **Animation & DOM Measurement Rules**
   - Never call `getBoundingClientRect()` inside `requestAnimationFrame` or scroll loops (prevents layout thrashing). Track size changes exclusively via `ResizeObserver`.
4. **Bundle Budget**
   - Load large subsystems (Settings, new preset categories, Phase D AI panel) dynamically via `import()` / `React.lazy`; keep the main `index-*.js` chunk under the `500 kB` budget.

---

## 3. Security, Data Integrity & Dual-Window Sync

1. **Rust Security Gate**
   - All file/directory Tauri commands must pass `security.rs` validation before disk access (UNC/SMB blocking, DOS device names, NTFS ADS `:`, symlink/junction rejection via `symlink_metadata`, and root-scope enforcement).
   - Color values (`#RRGGBB`), names, and path fields coming from user or JSON input must be validated for format and safety before persisting.
   - Errors returned to the client must never leak local user paths (`C:\Users\...`).
   - Never write unbounded full-table queries without a `WHERE` filter (`SELECT ... FROM samples/sample_tags`); chunk ID lists or use indexed queries.
2. **Type Safety & Hygiene**
   - `@ts-ignore`, `@ts-expect-error`, `: any`, `as any`, `dangerouslySetInnerHTML`, `innerHTML`, and `eval` are **STRICTLY FORBIDDEN** in TypeScript.
   - All `localStorage` reads must go through `safeGetItem`; manage all `audify_*` keys from one central constant module.
   - Whenever adding a new profile/settings field, update **all 3 places together**: `ProfileSettings` (`src/types.ts`), centralized key/persistence logic, and Rust `ALLOWED_PROFILE_SETTINGS_KEYS` (`src-tauri/src/security.rs`).
3. **Race Conditions & Atomic Undo/Redo**
   - Pop items from Undo/Redo stacks only after the underlying `await` operation succeeds.
   - Guard concurrent async DB writers (`persistActiveProfileSettings`, etc.) with a sequential `inFlight` lock.
   - During `Main ↔ Settings` synchronization, protect actively edited local keys from echo/snap-back using `isLocalKeyRecentlyEdited`.

---

## 4. UI Consistency, Theme (`Dark` / `Light` / `Contrast`) & Accessibility

1. **Uniform Window Chrome (`Main`, `Settings`, `Mini Dock`)**
   - Minimize, Maximize/Restore, and Close buttons inside `WindowCaptionControls` must use the same optical scale and stroke weight (crisp pixel-aligned SVG glyphs), consistent bar height, and consistent title/badge typography.
2. **Semantic Theme Token Mandate**
   - Styling classes must use semantic tokens (`bg-surface-*`, `text-fg*`, `border-line*`, `accent`). Never use raw `bg-black/*`, `bg-[#...]`, or `text-white` (except red Close button hover).
   - Never apply Tailwind opacity modifiers like `/80` to CSS custom properties that do not use `rgb(...)` triplets; do not write the forbidden `(surface-\d+|line|fg|accent-fg)/\d+` pattern.
   - Verify every style/overlay/modal change across all three modes: **`dark`**, **`light`**, and **`contrast`** (`data-theme="contrast"`).
3. **Portals, Accessibility & Layering**
   - All context menus and modals must use `createPortal(..., document.body)`; modals must provide `role="dialog"`, `aria-modal="true"`, `Esc` handling, and proper focus management; z-index layers must follow the shared constant hierarchy.
4. **Theme Accent Priority & Uniform Swatch Geometry**
   - Interactive controls (buttons, toggles, context menu actions, waveform slice selection/handles/Loop/FULL/Close UI, settings pills) MUST follow the active theme accent (`accent` / `bg-accent-soft` / `text-accent-fg` / `border-accent`), never hardcoded green (`ok`) or menu-item `danger` tones. Reserve `ok`/`warn`/`danger` strictly for passive status indicators, alerts, and destructive confirmation dialogs.
   - Color swatches (profile badges, Tags & Rules, Genres, filter pills, batch action bar, context submenus, inspector/color picker headers) MUST use uniform rounded squares (`rounded-[2px]` or `rounded-[3px]`), never `rounded-full` circles or oversized radii (`rounded-xs` on `8x8px` indicators).

---

## 5. Pre-Delivery Verification Gate

No task is complete after a code change until all applicable checks pass:
- Opacity token scan (`OPACITY_SCAN_OK`)
- `npx tsc --noEmit --noUnusedLocals --noUnusedParameters`
- `npx eslint src --max-warnings=0`
- `npm test` (`vitest run`)
- If Rust code changed: `cargo test --manifest-path src-tauri/Cargo.toml` and `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets`
