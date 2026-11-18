# Audify

**Audify** is a high-density, low-latency desktop audio sample, SFX, and music library manager built for **video editors (NLEs)** and **sound designers / music producers (DAWs)**.

Built with **Tauri v2**, **React 18 / TypeScript**, and **Rust / SQLite (FTS5 + WAL)**, Audify is engineered to manage **50,000+ to 100,000+ audio files** with instant search, 60 FPS waveform scrubbing, ~400 MB RAM usage, and direct drag-and-drop slicing into **DaVinci Resolve, Premiere Pro, Reaper, Ableton Live, FL Studio, Logic Pro, and Pro Tools**.

<img width="1919" height="1032" alt="dark" src="https://github.com/user-attachments/assets/cd25ecf1-e947-4b81-9ef7-e58bceea995b" />
<img width="1919" height="1032" alt="light" src="https://github.com/user-attachments/assets/ebf82412-b874-44d0-8c2b-3cf6118b4252" />
<img width="1919" height="1033" alt="ascii" src="https://github.com/user-attachments/assets/711d2a04-ff07-4979-a27e-36d757979bec" />

---

## Table of Contents

1. [What Audify Solves](#1-what-audify-solves)
2. [Core Features](#2-core-features)
3. [Performance & Memory Architecture](#3-performance--memory-architecture)
4. [Security & Privacy Architecture](#4-security--privacy-architecture)
5. [Project Architecture](#5-project-architecture)
6. [Getting Started & Building Locally](#6-getting-started--building-locally)
7. [Automated GitHub Actions CI & Releases](#7-automated-github-actions-ci--releases)

---

## 1. What Audify Solves

Traditional OS file explorers lack waveform previews, acoustic similarity search, BPM/key filtering, and region slicing. Heavy Electron-based sample managers often consume `1 GB+` of RAM, lag on libraries over `50,000` files, or lock users into cloud subscriptions.

**Audify** provides a **100% local, offline-first, portable studio workstation**:
- Instant full-text and operator-based search across tens of thousands of tracks.
- Real-time waveform region selection (`In` / `Out`) and pitch shifting with direct native drag-and-drop (`CF_HDROP`) into any NLE or DAW timeline.
- Independent multi-profile workspaces (e.g., *Film SFX*, *Music Production*, *Client Project*) with automatic drive relinking, license credit generation, and local AI sound similarity.

---

## 2. Core Features

### High-Density Virtualized Sample Table
- **50k+ Row Virtualization:** Smooth 60 FPS scrolling across massive catalogs with customizable, resizable, and reorderable columns:
  - `File Name`, `Mini Waveform`, `Duration`, `Tags`, `Genre`, `BPM`, `Musical Key` (Standard & Camelot `8A`/`8B`), `Sample Rate`, `Channels`, `Bitrate`, `Format`, `Year`, `Folder`, `Date Modified`, and `Date Added`.
- **Supported Audio Formats:** `.wav`, `.mp3`, `.flac`, `.ogg`, `.aif`, `.aiff`, `.m4a`, `.opus`, and `.aac`.

### Smart Search & Bilingual SFX Thesaurus (SQLite FTS5)
- **Inline Search Operators:** Combine free-text queries with structured studio filters directly in the search bar:
  - **Duration:** `<2s`, `>10s`, `dur:1-5s`
  - **Tempo (BPM):** `bpm:120` (±2 BPM tolerance), `bpm:90-130`
  - **Musical Key & Harmonic Mixing:** `key:Am`, `key:8A`, `key:~8A` *(automatically matches Camelot harmonic neighbors: `8A`, `7A`, `9A`, `8B`)*
  - **Taxonomy & Path Scopes:** `tag:impact`, `genre:cinematic`, `folder:whoosh`, `ext:wav`
  - **State & Exclusions:** `is:fav`, `is:loop`, `is:oneshot`, `-loop`, `-music`
- **Built-in & Custom SFX Synonym Expansion:** Searching `"whoosh"` automatically expands to `"swish"`, `"swoosh"`, `"passby"`, etc., with full Turkish/English character folding (`ı/i`, `İ/i`, `ş/s`, `ğ/g`, `ü/u`, `ö/o`, `ç/c`) and user-editable synonym clusters.

### Interactive Waveform Deck, Varispeed Pitch & Direct NLE/DAW Drag
- **Dual-Canvas Waveform Deck:** High-resolution interactive waveform with zoom, click-to-seek, loop toggle, and draggable `In` / `Out` slice handles.
- **Varispeed Pitch Shifting:** Audition and export samples pitched between `-12` and `+12` semitones.
- **On-the-Fly Sliced WAV Export (`DRAG TO NLE`):** Dragging a selected waveform region (or pitched sample) directly from Audify into an NLE/DAW automatically renders a collision-free, `3 ms` micro-faded WAV slice and hands it to the target application via native Windows `CF_HDROP` / OLE `IDataObject`.

### Mini Dock Mode (Companion Overlay)
- Toggle **Mini Dock** (`Ctrl+M`) to collapse Audify into a compact, always-on-top floating strip beside a full-screen NLE or DAW window — complete with search, filter pills, mini waveforms, transport controls, keyboard navigation, and direct drag-to-timeline.

### Multi-Profile Workspaces, Relink & Full Snapshots
- **Profile Isolation:** Each profile maintains its own assigned libraries, per-profile favorites (`profile_favorites`), collections, tags, genres, auto-tag rules, license templates, shortcuts, and theme settings.
- **Smart Library Relinking:** If an external SSD changes drive letters or folders move, Audify relinks samples using relative path matching and filename/size/duration fingerprints without losing favorites, tags, or collection items.
- **Share-Safe `.audify-profile` Packages:** Export and import lightweight profile archives (`.audify-profile`) with automatic personal path scrubbing.
- **Full Library Snapshots (`.audify-backup.zip`):** One-click atomic SQLite `VACUUM INTO` snapshots bundling the database, profile configurations, and custom backdrops with manifest verification and safe restore.

### Pure-Rust DSP & Optional 100% Offline Local AI
- **Multi-Threaded Rust DSP:** Parallel (`Rayon` + `Symphonia`) BPM detection and Krumhansl-Schmuckler chroma key / Camelot analysis.
- **Local YAMNet ONNX Auto-Tagger:** Optional local inference (`yamnet.onnx` + `onnxruntime.dll`) mapping `521` AudioSet classes into studio SFX tags without sending a single byte of audio to the cloud.
- **128-D Acoustic Similarity Search (`Shift+Enter`):** Instant cosine-similarity search across `50,000+` embeddings to find acoustically similar kicks, whooshes, or textures.
- **k-NN Custom Tag Learning:** Learns your personal tagging vocabulary from manually labeled samples (`is_manual = 1`) and suggests matching custom tags across similar sounds.

### Physical File Operations & Non-Destructive Trash Vault
- **Batch Rename Studio (`F2`):** Live preview table with Find & Replace, Regex, Prefix/Suffix, numbering (`_01`, `_02`), case conversion, and automatic sibling conflict detection.
- **Physical Subfolder Management:** Create, rename, move, or import external folders directly from the sidebar folder tree with duplicate file detection (`Skip`, `Overwrite`, `Keep Both`).
- **Audify Trash Vault & Atomic Undo/Redo (`Ctrl+Z` / `Ctrl+Y`):** Trashed files move to a managed vault while preserving their database IDs, favorites, tags, genres, and collection memberships so restoring a file restores all of its metadata.

### License & Attribution Credits Manager
- Group libraries or subfolders by license tier (e.g., *CC-BY 4.0*, *Epidemic*, *Artlist*, *Custom*) with tokenized attribution templates (`{title}`, `{artist}`, `{file_name}`, `{folder}`).
- Press `Ctrl+Shift+C` (`Copy Credits`) on any selection or Session Bin to copy formatted attribution text to the clipboard.

### Studio Themes, Mica Glass & Procedural Backdrops
- **3 Precision Themes:** Instant switching between **Dark**, **Light**, and **High Contrast** (`data-theme="contrast"`), plus Windows **Mica** frosted glass and customizable accent tinting.
- **Custom & Procedural Backdrops:** Support for static images, videos, GIFs, **108 built-in procedural ASCII scenes** across 9 categories (*Nature, Camp, Zen, Ocean, Space, Cyber, City, Retro, Studio*), and an isolated **ASCII Magic** catalog runner.

---

## 3. Performance & Memory Architecture

Audify is engineered to stay responsive and lightweight (~`400–500 MB` RAM on a `55,000`-track library):

- **SQLite WAL + Fine-Grained Lock Scope:**
  - Uses `PRAGMA journal_mode = WAL`, `synchronous = NORMAL`, a `64 MB` page cache, and `256 MB` memory-mapped I/O (`mmap_size`).
  - Heavy disk, ZIP, `WalkDir`, and audio DSP operations execute **outside** the SQLite connection mutex so UI queries never stall during background tasks.
  - Schema `v13` maintains composite and expression indexes (`LOWER(file_path)`, `LOWER(path)`, `collection_items(sample_id)`, `profile_libraries(library_id)`, `ai_tag_suggestions(sample_id)`) for `O(log N)` lookups.
- **Two-Phase Startup & Epoch-Guarded Backfill:**
  - Phase 1 hydrates only the initial `150` visible rows with waveform peaks for an immediate first paint; Phase 2 streams the full catalog and incrementally backfills `file_modified_at` timestamps with automatic `profileEpoch` cancellation if the user switches profiles.
- **Zero-Allocation UI & Instant Theme Switching:**
  - Virtualized table rows (`SampleTableRow`, `MiniWaveform`) never subscribe to store actions or create per-row `ResizeObserver` instances.
  - Waveform scrubbing uses `ResizeObserver`-cached bounding rects (`0` `getBoundingClientRect()` layout thrashing in `mousemove` / `requestAnimationFrame` loops).
  - Theme switching uses a lightweight `"live-visual"` cross-window channel, static JS canvas palettes (avoiding synchronous `getComputedStyle` reflows), and double-`requestAnimationFrame` CSS transition suppression (`[data-theme-switching="true"]`).
- **Bounded Memory Caches:**
  - Waveform peak cache (`MAX_CACHE_ENTRIES = 2000`), backdrop blob preview cache (`6` entries), ASCII color ramp caches (`4096` entries), and an automatic **AI Vector Cache Idle Reaper** that unloads in-memory embeddings after inactivity.

---

## 4. Security & Privacy Architecture

Audify is hardened for both local desktop safety and public open-source distribution:

- **Zero Telemetry & Offline-First CSP:**
  - Audify contains **zero** analytics, tracking, or background network requests.
  - WebView Content Security Policy (`tauri.conf.json`) restricts scripts and assets to local Tauri protocols (`'self'`, `asset:`, `ipc:`). The only outbound HTTPS connections are explicit user-initiated downloads for the optional local AI model (`huggingface.co` / `files.pythonhosted.org`) or ASCII catalog sync (`www.ascii-magic.com`).
- **Filesystem Security Gate (`src-tauri/src/security/`):**
  - **UNC / SMB Blocking:** Rejects `\\server\share` and `//` paths across all commands to prevent Windows NTLM credential/hash leak attacks.
  - **Symlink & Junction Containment:** Verifies `fs::symlink_metadata` and canonicalized parent boundaries (`ensure_inside`, `is_dir_inside_library_root`) before creating directories, moving files, or restoring from trash.
  - **NTFS ADS & DOS Device Rejection:** Blocks NTFS Alternate Data Streams (`file.wav:stream`), path traversal (`..`), and reserved Windows device names (`CON`, `PRN`, `AUX`, `NUL`, `COM1`–`COM9`, `LPT1`–`LPT9`).
- **Cryptographic AI & Archive Verification:**
  - Mandatory **SHA-256 verification** before loading `onnxruntime.dll` (`ort::init_from`) or `yamnet.onnx`, plus checked tensor multiplication (`checked_mul`) to prevent out-of-bounds panics.
  - Snapshot and profile ZIP imports enforce bounded stream reads (`copy_bounded_from_zip`), ZIP-slip path rejection, image magic-byte verification (`PNG`, `JPEG`, `WEBP`, `GIF`), `SQLITE_DBCONFIG_DEFENSIVE`, and `PRAGMA trusted_schema = OFF`.
- **Sandboxed ASCII Magic Execution:**
  - External ASCII scenes run inside a dedicated `ascii-sandbox:` custom protocol iframe with `connect-src 'none'`, strict `postMessage` origin verification, and a multi-pass JS token validator blocking prototype pollution, `eval`/`Function`, dynamic imports, and string/escape concatenation bypasses.
- **PII-Free Exports & Release Binaries:**
  - Client-facing error messages pass through `sanitize_err` so local OS user paths (`C:\Users\...`) are never leaked.
  - Share-safe `.audify-profile` and `.audify-settings.json` exports automatically scrub personal directory paths.
  - Release builds strip debug symbols (`strip = true`) and dynamically remap compiler paths (`--remap-path-prefix`) so compiled `.exe` binaries contain zero developer machine paths.

---

## 5. Project Architecture

```text
Audify/
├── .github/workflows/
│   └── build-and-release.yml   # Automated CI verification, portable .exe build & GitHub Releases
├── public/
│   ├── audify-icon.png
│   └── fonts/Inter-Variable.ttf # Bundled variable UI font for consistent cross-machine typography
├── src/                        # React 18 + TypeScript Frontend (strictly unidirectional layers)
│   ├── components/             # UI components (SampleTable, MiniDock, Settings, Transport, Modals)
│   ├── hooks/                  # Global shortcuts, drag-and-drop, and interaction hooks
│   ├── services/               # Neutral audio engine & cross-layer services
│   ├── store/                  # Zustand state slices, filter engine & dual-window sync bridges
│   ├── constants/              # Centralized storage keys, theme palettes, shortcuts & ASCII presets
│   ├── types/                  # Domain TypeScript interfaces
│   ├── utils/                  # Smart search parser, SFX thesaurus, peak cache & format helpers
│   └── styles/                 # Theme tokens, Mica glass & high-contrast stylesheets
└── src-tauri/                  # Rust Backend (Tauri v2 + SQLite FTS5)
    └── src/
        ├── ai_tagger/          # Offline YAMNet ONNX runner, 128-D similarity & k-NN tag learner
        ├── ascii_magic/        # Sandboxed custom protocol, catalog manager & JS security gate
        ├── audio/              # Symphonia decode, waveform peak extraction & atomic WAV slice export
        ├── commands/           # Modular IPC handlers (samples, libraries, profiles, file_ops, snapshot)
        ├── db/                 # SQLite schema (v13), migrations, FTS5 triggers & WAL pool
        ├── dsp_analysis/       # Pure-Rust multi-threaded BPM & Camelot musical key analyzer
        ├── scanner/            # Parallel directory walker, metadata extractor & auto-tag matcher
        ├── security/           # Path guards, settings whitelist, magic-byte & OS shell validators
        └── win_drag.rs         # Native Windows OLE/COM IDropSource & CF_HDROP drag-to-NLE engine
```

---

## 6. Getting Started & Building Locally

### Prerequisites
- **Node.js** `20+`
- **Rust** `stable` (`x86_64-pc-windows-msvc` on Windows)
- **WebView2 Runtime** (pre-installed on Windows 10 / 11)

### Local Development & Verification

```powershell
# 1. Install frontend dependencies
npm install

# 2. Launch Audify in development mode
npm run tauri dev

# 3. Run the full verification suite
npx tsc --noEmit --noUnusedLocals --noUnusedParameters
npx eslint src --max-warnings=0
npm test
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml -- --test-threads=1

# 4. Build optimized portable release binary (outputs ./Audify.exe)
npm run build:exe
```

> **Portable Mode:** Place `Audify.exe` in any writable folder. Audify stores its SQLite database (`samples.db`), backups, custom backdrops, and optional AI models locally inside `./user/` next to the executable.

---

## 7. Automated GitHub Actions CI & Releases

Audify includes [`.github/workflows/build-and-release.yml`](.github/workflows/build-and-release.yml) for zero-touch cloud compilation on GitHub's clean `windows-latest` runners:

1. **Continuous Verification & Portable Artifact (`push` / `pull_request` / `workflow_dispatch`):**
   - Runs TypeScript, ESLint, Vitest (`152` tests), Cargo Clippy, and Cargo unit tests (`84` tests).
   - Compiles the optimized portable `Audify.exe` with path-prefix remapping and uploads `Audify-Windows-x64-Portable` (`Audify.exe` + `SHA256SUMS.txt`) to the workflow run's **Artifacts** tab.
2. **One-Click Manual Cloud Build:**
   - Open **Actions → Build, Verify & Release (Windows x64) → Run workflow** on GitHub to build a fresh `Audify.exe` in the cloud at any time.
3. **Automated GitHub Releases (`v*` Tags):**
   - Pushing a version tag (e.g. `git tag v0.2.0 && git push origin v0.2.0`) or creating a release tag on GitHub automatically compiles `Audify.exe` and attaches `Audify.exe` + `SHA256SUMS.txt` to the public **GitHub Release**.
