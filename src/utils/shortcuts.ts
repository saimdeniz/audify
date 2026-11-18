export type ShortcutKeyEvent = Pick<
  KeyboardEvent,
  "key" | "code" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey"
>;

interface ParsedShortcut {
  hasCtrl: boolean;
  hasCmdToken: boolean;
  hasAlt: boolean;
  hasShift: boolean;
  isChord: boolean;
  keyLower: string;
  keyRaw: string;
}

function normalizeCanonicalKeyToken(keyLower: string): string {
  if (keyLower === " " || keyLower === "space") return "space";
  if (keyLower === "del" || keyLower === "delete") return "delete";
  if (keyLower === "esc" || keyLower === "escape") return "escape";
  if (keyLower === "return" || keyLower === "enter") return "enter";
  return keyLower;
}

function parseShortcut(boundKey: string): ParsedShortcut | null {
  if (!boundKey) return null;

  // Crucial: DEFAULT_SHORTCUTS.playPause is " " (single space), whose .trim() is ""!
  // Handle literal space or "Space" BEFORE calling .trim().
  if (boundKey === " " || boundKey.trim().toLowerCase() === "space") {
    return {
      hasCtrl: false,
      hasCmdToken: false,
      hasAlt: false,
      hasShift: false,
      isChord: false,
      keyLower: "space",
      keyRaw: "space",
    };
  }

  let modPartRaw = "";
  let keyRaw = "";
  let isChord = false;

  if (/\+ $/.test(boundKey)) {
    modPartRaw = boundKey.slice(0, -2);
    keyRaw = " ";
    isChord = true;
  } else {
    const trimmed = boundKey.trim();
    if (!trimmed) return null;

    if (trimmed === "+") {
      keyRaw = "+";
    } else if (trimmed.includes("+")) {
      isChord = true;
      if (trimmed.endsWith("+")) {
        const plusKeyMatch = trimmed.match(/^(.*)\+\s*\+$/);
        if (!plusKeyMatch) return null;
        modPartRaw = plusKeyMatch[1];
        keyRaw = "+";
      } else {
        const lastPlus = trimmed.lastIndexOf("+");
        modPartRaw = trimmed.slice(0, lastPlus);
        keyRaw = trimmed.slice(lastPlus + 1).trim();
        if (!keyRaw) return null;
      }
    } else {
      keyRaw = trimmed;
    }
  }

  let hasCtrl = false;
  let hasCmdToken = false;
  let hasAlt = false;
  let hasShift = false;

  if (isChord) {
    const modTokens = modPartRaw
      .split("+")
      .map((p) => p.trim().toLowerCase())
      .filter(Boolean);
    for (const mod of modTokens) {
      if (mod === "ctrl" || mod === "control") {
        hasCtrl = true;
      } else if (mod === "cmd" || mod === "meta") {
        hasCtrl = true;
        hasCmdToken = true;
      } else if (mod === "alt") {
        hasAlt = true;
      } else if (mod === "shift") {
        hasShift = true;
      }
    }
  }

  const keyLower =
    keyRaw === " " ? "space" : keyRaw.trim().toLowerCase() || "space";

  return {
    hasCtrl,
    hasCmdToken,
    hasAlt,
    hasShift,
    isChord,
    keyLower,
    keyRaw: keyRaw === " " ? "space" : keyRaw.trim(),
  };
}

/**
 * Produces a canonical lowercase shortcut key (`"ctrl+shift+space"`, `"ctrl++"`)
 * for reliable collision checking across UI variants like `"Control+Space"` vs `"Ctrl+Space"`.
 */
export function canonicalizeShortcut(boundKey: string): string {
  const parsed = parseShortcut(boundKey);
  if (!parsed) return "";
  const canonicalKey = normalizeCanonicalKeyToken(parsed.keyLower);
  if (!parsed.isChord) return canonicalKey;
  return [
    ...(parsed.hasCtrl ? ["ctrl"] : []),
    ...(parsed.hasAlt ? ["alt"] : []),
    ...(parsed.hasShift ? ["shift"] : []),
    canonicalKey,
  ].join("+");
}

/**
 * Matches a keyboard event against a customizable Audify shortcut string.
 * Supports single Space (" " or "Space"), single keys ("f", "Escape", "+"), and
 * modifier chords ("Ctrl+M", "Ctrl+Space", "Shift+Space", "Ctrl++").
 */
export function matchesShortcut(
  e: ShortcutKeyEvent,
  boundKey: string
): boolean {
  const parsed = parseShortcut(boundKey);
  if (!parsed) return false;

  if (parsed.isChord) {
    if (Boolean(e.ctrlKey || e.metaKey) !== parsed.hasCtrl) return false;
    if (Boolean(e.altKey) !== parsed.hasAlt) return false;
    if (Boolean(e.shiftKey) !== parsed.hasShift) return false;
  } else {
    if (e.ctrlKey || e.metaKey || e.altKey) return false;
  }

  if (parsed.keyLower === "space") {
    return e.key === " " || e.code === "Space";
  }
  return e.key.toLowerCase() === parsed.keyLower;
}

/**
 * Returns true ONLY for genuine text-entry controls so sliders (`input[type="range"]`),
 * buttons, and checkboxes never swallow global studio shortcuts like Space or Up/Down.
 */
export function isTextEntryTarget(target: HTMLElement | null): boolean {
  if (!target) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  if (tag === "TEXTAREA" || tag === "SELECT") return true;
  if (tag === "INPUT") {
    const inputType = (
      (target as HTMLInputElement).type || "text"
    ).toLowerCase();
    return (
      inputType !== "range" &&
      inputType !== "button" &&
      inputType !== "checkbox" &&
      inputType !== "radio"
    );
  }
  return false;
}

/**
 * Formats a persisted shortcut string (e.g. " ", "Shift+Enter", "Delete", "Ctrl++") for UI display.
 * Use `{ compact: true }` in dense context menus ("Del", "Esc", "Space").
 */
export function formatShortcutDisplay(
  key?: string,
  opts?: { compact?: boolean }
): string {
  if (!key) return "";
  const parsed = parseShortcut(key);
  if (!parsed) return "";

  const formatSingleKey = (raw: string, lower: string): string => {
    if (lower === "space") return opts?.compact ? "Space" : "SPACE";
    if (lower === "delete" || lower === "del") {
      return opts?.compact ? "Del" : "Delete";
    }
    if (lower === "escape" || lower === "esc") {
      return opts?.compact ? "Esc" : "Escape";
    }
    if (lower === "enter" || lower === "return") return "Enter";
    if (raw.length === 1) return raw.toUpperCase();
    return raw.charAt(0).toUpperCase() + raw.slice(1);
  };

  const formattedKey = formatSingleKey(parsed.keyRaw, parsed.keyLower);
  if (!parsed.isChord) return formattedKey;

  const mods: string[] = [];
  if (parsed.hasCtrl) mods.push(parsed.hasCmdToken ? "Cmd" : "Ctrl");
  if (parsed.hasAlt) mods.push("Alt");
  if (parsed.hasShift) mods.push("Shift");
  return [...mods, formattedKey].join("+");
}

const HARDWARE_MEDIA_KEYS = new Set([
  "MediaPlayPause",
  "MediaPlay",
  "MediaPause",
  "MediaStop",
  "MediaTrackPrevious",
  "MediaTrackNext",
]);

const TEXT_EDITING_CHORDS = new Set([
  "ctrl+a",
  "ctrl+c",
  "ctrl+v",
  "ctrl+x",
  "ctrl+z",
  "ctrl+y",
  "ctrl+shift+z",
  "ctrl+backspace",
  "ctrl+delete",
  "ctrl+arrowleft",
  "ctrl+arrowright",
  "ctrl+home",
  "ctrl+end",
]);

export function isHardwareMediaKey(key: string): boolean {
  return HARDWARE_MEDIA_KEYS.has(key);
}

/**
 * Allows dedicated media keys, function keys (F1-F12), and non-editing modifier
 * chords (e.g. Ctrl+Space, Ctrl+M, Alt+P, Ctrl++) to trigger while typing in a search input,
 * while preventing bare Space or single-letter shortcuts from hijacking search text.
 */
export function isSafeGlobalShortcutInTextEntry(
  e: ShortcutKeyEvent,
  boundKey: string
): boolean {
  if (!boundKey || !matchesShortcut(e, boundKey)) return false;

  const trimmed = boundKey.trim();
  if (isHardwareMediaKey(e.key) || isHardwareMediaKey(trimmed)) {
    return true;
  }
  if (/^f([1-9]|1[0-2])$/i.test(trimmed)) {
    return true;
  }

  const parsed = parseShortcut(boundKey);
  if (!parsed || !parsed.isChord) {
    return false;
  }
  if (!parsed.hasCtrl && !parsed.hasAlt) {
    return false;
  }

  const canonical = [
    ...(parsed.hasCtrl ? ["ctrl"] : []),
    ...(parsed.hasAlt ? ["alt"] : []),
    ...(parsed.hasShift ? ["shift"] : []),
    normalizeCanonicalKeyToken(parsed.keyLower),
  ].join("+");

  return !TEXT_EDITING_CHORDS.has(canonical);
}

/**
 * Blurs an active track search input when the user clicks outside its search box
 * controls (e.g. clicking a sample row or transport button whose onMouseDown calls preventDefault()).
 */
export function shouldBlurSearchInputOnPointerDown(
  activeElement: Element | null,
  eventTarget: EventTarget | null
): activeElement is HTMLElement {
  if (
    typeof HTMLElement === "undefined" ||
    !(activeElement instanceof HTMLElement) ||
    activeElement.dataset?.searchInput !== "true"
  ) {
    return false;
  }

  const targetEl =
    typeof Element !== "undefined" && eventTarget instanceof Element
      ? eventTarget
      : typeof Node !== "undefined" && eventTarget instanceof Node
      ? eventTarget.parentElement
      : null;

  if (
    targetEl &&
    (targetEl === activeElement ||
      targetEl.closest('[data-search-keep-focus="true"]') !== null)
  ) {
    return false;
  }

  return true;
}
