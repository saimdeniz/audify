import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, RefreshCw, Volume2 } from "lucide-react";
import { Z_INDEX } from "../../constants/zIndex";
import {
  nativeAudioListDevices,
  type AudioOutputDeviceInfo,
} from "../../services/nativeAudioClient";
import { useSampleStore } from "../../store/useSampleStore";

const FALLBACK_DEVICES: AudioOutputDeviceInfo[] = [
  { id: "default", name: "System Default", isDefault: true },
];

interface PopoverCoords {
  top: number;
  left: number;
  width: number;
  maxHeight: number;
}

interface DeviceOptionItem {
  id: string;
  title: string;
  subtitle?: string;
  fullLabel: string;
  isOsDefault: boolean;
  disconnected?: boolean;
}

function formatDeviceOption(dev: AudioOutputDeviceInfo): DeviceOptionItem {
  if (dev.id === "default") {
    const match = /^System Default \((.+)\)$/.exec(dev.name.trim());
    return {
      id: "default",
      title: "System Default",
      subtitle: match ? match[1] : undefined,
      fullLabel: dev.name,
      isOsDefault: false,
    };
  }
  return {
    id: dev.id,
    title: dev.name,
    fullLabel: dev.name,
    isOsDefault: dev.isDefault,
  };
}

/**
 * Modern theme-aware WASAPI / OS Audio Output Device selector inside Settings -> Audio.
 * Uses a viewport-clamped portal popover aligned flush with the control frame so long
 * Windows device names never overflow the Settings card or window edges.
 */
export const AudioOutputDeviceRow: React.FC = React.memo(() => {
  const audioOutputDeviceId = useSampleStore((s) => s.audioOutputDeviceId);
  const setAudioOutputDeviceId = useSampleStore(
    (s) => s.setAudioOutputDeviceId
  );

  const [devices, setDevices] =
    useState<AudioOutputDeviceInfo[]>(FALLBACK_DEVICES);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const [coords, setCoords] = useState<PopoverCoords | null>(null);

  const groupRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const refreshDevices = useCallback(async () => {
    setLoading(true);
    try {
      const list = await nativeAudioListDevices();
      setDevices(list.length > 0 ? list : FALLBACK_DEVICES);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshDevices();
  }, [refreshDevices]);

  const currentId = audioOutputDeviceId || "default";

  const items = useMemo<DeviceOptionItem[]>(() => {
    const formatted = devices.map(formatDeviceOption);
    const hasCurrent = formatted.some((d) => d.id === currentId);
    if (!hasCurrent && currentId !== "default") {
      return [
        {
          id: currentId,
          title: currentId,
          subtitle: "Disconnected — using System Default",
          fullLabel: `${currentId} (Disconnected — using System Default)`,
          isOsDefault: false,
          disconnected: true,
        },
        ...formatted,
      ];
    }
    return formatted;
  }, [devices, currentId]);

  const selectedItem = useMemo(
    () => items.find((i) => i.id === currentId) ?? items[0],
    [items, currentId]
  );

  const updatePosition = useCallback(() => {
    const btn = triggerRef.current;
    if (!btn) return;
    const btnRect = btn.getBoundingClientRect();
    const groupRect = groupRef.current?.getBoundingClientRect() ?? btnRect;
    const pad = 12;
    const maxViewportW = Math.max(180, window.innerWidth - pad * 2);
    const rightAnchor = Math.min(groupRect.right, window.innerWidth - pad);
    const availableLeft = Math.max(180, rightAnchor - pad);
    const width = Math.round(
      Math.min(Math.max(groupRect.width, 260), 340, maxViewportW, availableLeft)
    );
    const left = Math.round(
      Math.max(pad, Math.min(rightAnchor - width, window.innerWidth - width - pad))
    );

    const spaceBelow = window.innerHeight - btnRect.bottom - pad;
    const spaceAbove = btnRect.top - pad;
    const desiredH = 240;
    const openUp = spaceBelow < 150 && spaceAbove > spaceBelow;
    const maxHeight = Math.max(
      110,
      Math.min(desiredH, openUp ? spaceAbove : spaceBelow)
    );
    const top = Math.round(
      openUp
        ? Math.max(pad, btnRect.top - Math.min(desiredH, maxHeight) - 4)
        : btnRect.bottom + 4
    );

    setCoords({ top, left, width, maxHeight });
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    updatePosition();
    const onWinChange = () => updatePosition();
    window.addEventListener("resize", onWinChange);
    window.addEventListener("scroll", onWinChange, true);
    return () => {
      window.removeEventListener("resize", onWinChange);
      window.removeEventListener("scroll", onWinChange, true);
    };
  }, [open, updatePosition]);

  useEffect(() => {
    if (!open) return;
    const raf = requestAnimationFrame(() => {
      menuRef.current?.focus();
    });
    const onPointerDown = (ev: MouseEvent) => {
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
      }
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const handleToggleOpen = () => {
    setOpen((prev) => {
      const next = !prev;
      if (next) {
        const idx = Math.max(
          0,
          items.findIndex((i) => i.id === currentId)
        );
        setActiveIdx(idx);
      }
      return next;
    });
  };

  const handleSelect = (id: string) => {
    setAudioOutputDeviceId(id);
    setOpen(false);
    triggerRef.current?.focus();
  };

  const handleMenuKeyDown = (ev: React.KeyboardEvent) => {
    if (ev.key === "ArrowDown") {
      ev.preventDefault();
      setActiveIdx((i) => (items.length ? (i + 1) % items.length : 0));
    } else if (ev.key === "ArrowUp") {
      ev.preventDefault();
      setActiveIdx((i) =>
        items.length ? (i - 1 + items.length) % items.length : 0
      );
    } else if (ev.key === "Enter" && items[activeIdx]) {
      ev.preventDefault();
      handleSelect(items[activeIdx].id);
    }
  };

  return (
    <div className="h-[38px] px-3 flex items-center justify-between gap-3">
      <span className="text-[12px] font-medium text-fg shrink-0">
        Output device
      </span>
      <div
        ref={groupRef}
        className="flex items-center space-x-1.5 min-w-0 flex-1 max-w-[300px]"
      >
        <button
          ref={triggerRef}
          type="button"
          onClick={handleToggleOpen}
          aria-label="Audio output device"
          aria-haspopup="listbox"
          aria-expanded={open}
          title={selectedItem?.fullLabel ?? "System Default"}
          className={`flex-1 min-w-0 h-[24px] px-2 rounded-xs border text-[11px] font-mono inline-flex items-center justify-between gap-1.5 cursor-pointer transition-colors ${
            open
              ? "bg-surface-2 border-accent text-fg font-medium"
              : "bg-surface-2 hover:bg-surface-3 border-line hover:border-accent text-fg"
          }`}
        >
          <span className="inline-flex items-center gap-1.5 min-w-0">
            <Volume2 className="w-3 h-3 text-accent-fg shrink-0" />
            <span className="truncate">
              {selectedItem?.title ?? "System Default"}
            </span>
          </span>
          <ChevronDown
            className={`w-3 h-3 text-fg-3 shrink-0 transition-transform ${
              open ? "rotate-180 text-accent-fg" : ""
            }`}
          />
        </button>

        <button
          type="button"
          onClick={() => void refreshDevices()}
          disabled={loading}
          className="w-[24px] h-[24px] shrink-0 rounded-xs bg-surface-2 hover:bg-surface-3 hover:border-accent border border-line text-fg-2 hover:text-accent-fg disabled:opacity-45 flex items-center justify-center transition-colors cursor-pointer"
          title="Refresh audio output devices"
        >
          <RefreshCw className={`w-3 h-3 ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>

      {open &&
        coords &&
        createPortal(
          <div
            ref={menuRef}
            tabIndex={-1}
            aria-label="Audio output devices"
            data-popover-portal="true"
            data-popover-open="true"
            data-settings-dropdown-open="true"
            data-mica-overlay="true"
            onKeyDown={handleMenuKeyDown}
            style={{
              position: "fixed",
              top: coords.top,
              left: coords.left,
              width: coords.width,
              maxHeight: coords.maxHeight,
              zIndex: Z_INDEX.popoverFloating,
            }}
            className="bg-surface-2 backdrop-blur-md border border-line-strong rounded-sm shadow-lg flex flex-col overflow-hidden select-none focus:outline-none"
          >
            <div
              role="listbox"
              aria-label="Audio output device options"
              className="flex-1 overflow-y-auto p-1 space-y-0.5"
            >
              {items.map((item, idx) => {
                const isSelected = item.id === currentId;
                const isHighlighted = idx === activeIdx;
                return (
                  <button
                    key={item.id}
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    title={item.fullLabel}
                    onMouseEnter={() => setActiveIdx(idx)}
                    onClick={() => handleSelect(item.id)}
                    className={`w-full px-2 py-1.5 rounded-xs text-left cursor-pointer transition-colors flex items-center justify-between gap-2 min-w-0 ${
                      isSelected
                        ? "bg-accent text-accent-on font-semibold"
                        : isHighlighted
                          ? "bg-surface-3 text-fg"
                          : "text-fg-2 hover:bg-surface-3 hover:text-fg"
                    }`}
                  >
                    <span className="flex items-center gap-1.5 min-w-0 flex-1">
                      <span className="w-3 shrink-0 flex items-center justify-center">
                        {isSelected && (
                          <Check className="w-3 h-3 stroke-[2.5]" />
                        )}
                      </span>
                      <span className="min-w-0 flex-1 flex flex-col">
                        <span className="text-[11px] font-mono leading-tight truncate">
                          {item.title}
                        </span>
                        {item.subtitle && (
                          <span
                            className={`text-[9.5px] font-mono leading-tight truncate mt-0.5 ${
                              isSelected
                                ? "text-accent-on opacity-85"
                                : "text-fg-3"
                            }`}
                          >
                            {item.subtitle}
                          </span>
                        )}
                      </span>
                    </span>

                    {item.isOsDefault && (
                      <span
                        className={`text-[9px] font-mono uppercase tracking-wider px-1.5 py-[1px] rounded-xs border shrink-0 ${
                          isSelected
                            ? "border-accent-on text-accent-on"
                            : "bg-surface-1 border-line text-fg-3"
                        }`}
                      >
                        OS
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>,
          document.body
        )}
    </div>
  );
});
