import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { Check, Headphones, RefreshCw, Volume2 } from "lucide-react";
import { Z_INDEX } from "../constants/zIndex";
import {
  nativeAudioListDevices,
  type AudioOutputDeviceInfo,
} from "../services/nativeAudioClient";
import { useSampleStore } from "../store/useSampleStore";

const FALLBACK_DEVICES: AudioOutputDeviceInfo[] = [
  { id: "default", name: "System Default", isDefault: true },
];

const HEADPHONE_NAME_RE = /headphone|headset|earphone|airpod|buds|kulakl/i;

function compactDeviceLabel(raw: string, isDefaultId: boolean): string {
  if (isDefaultId) {
    const match = /^System Default \((.+)\)$/.exec(raw.trim());
    if (match?.[1]) {
      return match[1].replace(/\s*\([^)]*\)\s*$/, "").trim() || "Default";
    }
    return "Default";
  }
  return raw.replace(/\s*\([^)]*\)\s*$/, "").trim() || raw;
}

/**
 * Compact 1-click WASAPI / OS audio output device switcher docked in BottomStatusBar
 * so sound designers can flip between Headphones and Studio Monitors without opening Settings.
 */
export const StatusBarAudioDeviceButton: React.FC = React.memo(() => {
  const audioOutputDeviceId = useSampleStore((s) => s.audioOutputDeviceId);
  const setAudioOutputDeviceId = useSampleStore(
    (s) => s.setAudioOutputDeviceId
  );

  const [devices, setDevices] =
    useState<AudioOutputDeviceInfo[]>(FALLBACK_DEVICES);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const [coords, setCoords] = useState<{
    bottom: number;
    right: number;
    width: number;
    maxHeight: number;
  } | null>(null);

  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const refreshBtnRef = useRef<HTMLButtonElement | null>(null);

  const currentId = audioOutputDeviceId || "default";

  const refreshDevices = useCallback(async () => {
    setLoading(true);
    try {
      const list = await nativeAudioListDevices();
      if (list.length > 0) {
        setDevices(list);
      }
    } catch {
      // Ignore outside Tauri runtime
    } finally {
      setLoading(false);
    }
  }, []);

  // Populate live WASAPI device labels on startup so non-default saved devices never show "(Disconnected)"
  useEffect(() => {
    void refreshDevices();
  }, [refreshDevices]);

  const items = useMemo(() => {
    const hasCurrent = devices.some((d) => d.id === currentId);
    if (!hasCurrent && currentId !== "default") {
      return [
        {
          id: currentId,
          name: `${currentId} (Disconnected)`,
          isDefault: false,
        },
        ...devices,
      ];
    }
    return devices;
  }, [devices, currentId]);

  const activeDevice = useMemo(
    () => items.find((d) => d.id === currentId) ?? items[0],
    [items, currentId]
  );

  const displayLabel = compactDeviceLabel(
    activeDevice?.name ?? "System Default",
    currentId === "default"
  );
  const isHeadphone = HEADPHONE_NAME_RE.test(activeDevice?.name ?? "");
  const Icon = isHeadphone ? Headphones : Volume2;

  const updatePosition = useCallback(() => {
    const btn = triggerRef.current;
    if (!btn) return;
    const rect = btn.getBoundingClientRect();
    const pad = 8;
    const maxViewportWidth = Math.max(160, window.innerWidth - pad * 2);
    const width = Math.min(280, maxViewportWidth);
    const maxRight = Math.max(pad, window.innerWidth - width - pad);
    const right = Math.min(maxRight, Math.max(pad, window.innerWidth - rect.right));
    const bottom = Math.max(pad, window.innerHeight - rect.top + 4);
    const maxHeight = Math.max(120, Math.min(240, rect.top - pad * 2));
    setCoords({ bottom, right, width, maxHeight });
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    updatePosition();
    const onResize = () => updatePosition();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [open, updatePosition]);

  const handleSelect = useCallback(
    (id: string) => {
      setAudioOutputDeviceId(id);
      setOpen(false);
      triggerRef.current?.focus();
    },
    [setAudioOutputDeviceId]
  );

  useEffect(() => {
    if (!open) return;
    const selectedIndex = items.findIndex((d) => d.id === currentId);
    setActiveIdx(selectedIndex >= 0 ? selectedIndex : 0);
  }, [open, items, currentId]);

  useEffect(() => {
    if (!open) return;
    const onMouseDown = (ev: MouseEvent) => {
      const target = ev.target as Node | null;
      if (!target) return;
      if (triggerRef.current?.contains(target)) return;
      if (menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKeyDown = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") {
        ev.preventDefault();
        ev.stopPropagation();
        setOpen(false);
        triggerRef.current?.focus();
        return;
      }
      if (items.length === 0) return;
      if (ev.key === "ArrowDown") {
        ev.preventDefault();
        ev.stopPropagation();
        setActiveIdx((i) => (i + 1) % items.length);
      } else if (ev.key === "ArrowUp") {
        ev.preventDefault();
        ev.stopPropagation();
        setActiveIdx((i) => (i - 1 + items.length) % items.length);
      } else if (ev.key === "Home") {
        ev.preventDefault();
        ev.stopPropagation();
        setActiveIdx(0);
      } else if (ev.key === "End") {
        ev.preventDefault();
        ev.stopPropagation();
        setActiveIdx(items.length - 1);
      } else if (ev.key === "Enter" || ev.key === " ") {
        const target = ev.target as Node | null;
        if (target && refreshBtnRef.current?.contains(target)) {
          return;
        }
        ev.preventDefault();
        ev.stopPropagation();
        const chosen = items[activeIdx] ?? items[0];
        if (chosen) handleSelect(chosen.id);
      }
    };
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [open, items, activeIdx, handleSelect]);

  const handleToggle = () => {
    setOpen((prev) => {
      const next = !prev;
      if (next) {
        void refreshDevices();
      }
      return next;
    });
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onMouseDown={(e) => e.preventDefault()}
        onClick={handleToggle}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Audio output device: ${activeDevice?.name ?? "System Default"}`}
        title={`Audio Output: ${activeDevice?.name ?? "System Default"} — Click to switch`}
        className={`h-[18px] px-1.5 rounded-xs border inline-flex items-center gap-1 max-w-[140px] cursor-pointer transition-colors ${
          open || currentId !== "default"
            ? "bg-accent-soft border-accent text-accent-fg"
            : "bg-surface-2 border-line text-fg-2 hover:text-fg hover:border-line-strong"
        }`}
      >
        <Icon className="w-2.5 h-2.5 shrink-0" />
        <span className="truncate font-mono text-[10px]">{displayLabel}</span>
      </button>

      {open &&
        coords &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            ref={menuRef}
            data-popover-portal="true"
            data-mica-overlay="true"
            style={{
              position: "fixed",
              bottom: coords.bottom,
              right: coords.right,
              width: coords.width,
              maxHeight: coords.maxHeight,
              zIndex: Z_INDEX.popoverFloating,
            }}
            className="bg-surface-2 border border-line-strong rounded-sm shadow-2xl flex flex-col overflow-hidden select-none"
          >
            <div className="h-[26px] px-2 border-b border-line bg-surface-header flex items-center justify-between shrink-0">
              <span className="font-mono text-[9.5px] uppercase tracking-wider font-semibold text-fg-head">
                Audio Output
              </span>
              <button
                ref={refreshBtnRef}
                type="button"
                onClick={() => void refreshDevices()}
                disabled={loading}
                title="Refresh audio devices"
                className="w-[18px] h-[18px] rounded-xs text-fg-2 hover:text-accent-fg hover:bg-surface-3 flex items-center justify-center transition-colors cursor-pointer disabled:opacity-40"
              >
                <RefreshCw className={`w-2.5 h-2.5 ${loading ? "animate-spin" : ""}`} />
              </button>
            </div>
            <div
              role="listbox"
              aria-label="Quick audio output switcher"
              className="flex-1 overflow-y-auto p-1 space-y-0.5"
            >
              {items.map((dev, idx) => {
                const isSelected = dev.id === currentId;
                const isActive = idx === activeIdx;
                return (
                  <button
                    key={dev.id}
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    title={dev.name}
                    onMouseEnter={() => setActiveIdx(idx)}
                    onClick={() => handleSelect(dev.id)}
                    className={`w-full px-2 py-1 rounded-xs text-left cursor-pointer transition-colors flex items-center gap-1.5 min-w-0 ${
                      isSelected
                        ? "bg-accent text-accent-on font-semibold"
                        : isActive
                          ? "bg-accent-soft text-accent-fg"
                          : "text-fg-2 hover:bg-surface-3 hover:text-fg"
                    }`}
                  >
                    <span className="w-3 shrink-0 flex items-center justify-center">
                      {isSelected && <Check className="w-3 h-3 stroke-[2.5]" />}
                    </span>
                    <span className="text-[10.5px] font-mono truncate flex-1">
                      {dev.name}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>,
          document.body
        )}
    </>
  );
});
