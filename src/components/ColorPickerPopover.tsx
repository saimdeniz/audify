import React, { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, Copy, Shuffle } from "lucide-react";
import { STUDIO_COLOR_PALETTE } from "../constants/palettes";
import { Z_INDEX } from "../constants/zIndex";
import {
  getHexLuminance,
  hexToHsv,
  hsvToRgb,
  normalizeHex,
  parseSubmittedHex,
} from "./colorPickerHelpers";

interface ColorPickerPopoverProps {
  color: string;
  onChange: (hex: string) => void;
  className?: string;
  triggerSize?: "xs" | "sm" | "md";
  title?: string;
  align?: "left" | "right";
  customTrigger?: React.ReactNode;
}

export const ColorPickerPopover: React.FC<ColorPickerPopoverProps> = ({
  color,
  onChange,
  className = "",
  triggerSize = "sm",
  title = "Select Color",
  align = "right",
  customTrigger,
}) => {
  const safeColor = normalizeHex(color);
  const [isOpen, setIsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<"presets" | "custom">("presets");
  const [hexInput, setHexInput] = useState(safeColor);
  const [hsv, setHsv] = useState(() => hexToHsv(safeColor));
  const [copied, setCopied] = useState(false);
  const [popoverPos, setPopoverPos] = useState<{
    top: number;
    left: number;
  } | null>(null);

  const triggerRef = useRef<HTMLDivElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const satValRef = useRef<HTMLDivElement | null>(null);
  const hueRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const nextSafe = normalizeHex(color);
    setHexInput(nextSafe);
    setHsv(hexToHsv(nextSafe));
  }, [color]);

  const calculatePosition = useCallback((): {
    top: number;
    left: number;
  } | null => {
    if (!triggerRef.current) return null;
    const rect = triggerRef.current.getBoundingClientRect();
    const popoverWidth = 244;
    const popoverHeight = 224;
    const margin = 6;

    let top = rect.bottom + margin;
    if (
      top + popoverHeight > window.innerHeight - 8 &&
      rect.top - popoverHeight - margin > 8
    ) {
      top = rect.top - popoverHeight - margin;
    }

    let left = align === "right" ? rect.right - popoverWidth : rect.left;
    left = Math.max(8, Math.min(window.innerWidth - popoverWidth - 8, left));

    return { top, left };
  }, [align]);

  const updatePosition = useCallback(() => {
    const pos = calculatePosition();
    if (pos) {
      setPopoverPos(pos);
    }
  }, [calculatePosition]);

  const handleToggleOpen = () => {
    if (!isOpen) {
      const isPreset = STUDIO_COLOR_PALETTE.some(
        (c) => c.toLowerCase() === safeColor.toLowerCase()
      );
      setActiveTab(isPreset ? "presets" : "custom");
      setHexInput(safeColor);
      setHsv(hexToHsv(safeColor));

      const pos = calculatePosition();
      if (pos) {
        setPopoverPos(pos);
      }
      setIsOpen(true);
    } else {
      setIsOpen(false);
      setPopoverPos(null);
    }
  };

  useEffect(() => {
    if (!isOpen) return;

    updatePosition();

    const onDocClick = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        triggerRef.current &&
        !triggerRef.current.contains(target) &&
        popoverRef.current &&
        !popoverRef.current.contains(target)
      ) {
        setIsOpen(false);
      }
    };

    const onKeyDownCapture = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        setIsOpen(false);
        const btn = triggerRef.current?.querySelector<HTMLElement>("button, [tabindex]");
        btn?.focus();
      }
    };

    window.addEventListener("mousedown", onDocClick);
    window.addEventListener("keydown", onKeyDownCapture, true);
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);

    return () => {
      window.removeEventListener("mousedown", onDocClick);
      window.removeEventListener("keydown", onKeyDownCapture, true);
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [isOpen, updatePosition]);

  const handleHexSubmit = () => {
    const parsed = parseSubmittedHex(hexInput);
    if (parsed) {
      onChange(parsed);
      setHexInput(parsed);
      setHsv(hexToHsv(parsed));
    } else {
      setHexInput(safeColor);
    }
  };

  const pickRandom = (e: React.MouseEvent) => {
    e.stopPropagation();
    const available = STUDIO_COLOR_PALETTE.filter(
      (c) => c.toLowerCase() !== safeColor.toLowerCase()
    );
    const chosen = available[Math.floor(Math.random() * available.length)];
    if (chosen) {
      onChange(chosen);
      setHexInput(chosen);
      setHsv(hexToHsv(chosen));
    }
  };

  const handleCopyHex = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(safeColor);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      // Ignore clipboard error
    }
  };

  const updateSatValFromPointer = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const el = satValRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      const y = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
      const newHsv = { ...hsv, s: x, v: 1 - y };
      setHsv(newHsv);
      const newHex = hsvToRgb(newHsv.h, newHsv.s, newHsv.v);
      onChange(newHex);
      setHexInput(newHex);
    },
    [hsv, onChange]
  );

  const handleSatValDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
    } catch {
      // Ignore
    }
    updateSatValFromPointer(e);
  };

  const handleSatValMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.buttons !== 1) return;
    e.preventDefault();
    updateSatValFromPointer(e);
  };

  const updateHueFromPointer = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const el = hueRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      const newH = x >= 1 ? 0.9999 : x;
      const newHsv = { ...hsv, h: newH };
      setHsv(newHsv);
      const newHex = hsvToRgb(newHsv.h, newHsv.s, newHsv.v);
      onChange(newHex);
      setHexInput(newHex);
    },
    [hsv, onChange]
  );

  const handleHueDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
    } catch {
      // Ignore
    }
    updateHueFromPointer(e);
  };

  const handleHueMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.buttons !== 1) return;
    e.preventDefault();
    updateHueFromPointer(e);
  };

  const sizeClasses =
    triggerSize === "xs"
      ? "w-[20px] h-[20px]"
      : triggerSize === "md"
        ? "w-[28px] h-[28px]"
        : "w-[24px] h-[24px]";

  const baseHueHex = hsvToRgb(hsv.h, 1, 1);

  return (
    <div
      ref={triggerRef}
      className={`relative inline-flex items-center shrink-0 ${className}`}
      onClick={(e) => e.stopPropagation()}
    >
      {customTrigger ? (
        <div onClick={handleToggleOpen} className="w-full shrink-0">
          {customTrigger}
        </div>
      ) : (
        <button
          type="button"
          onClick={handleToggleOpen}
          className={`${sizeClasses} rounded-xs border border-line hover:border-accent flex items-center justify-center p-0.5 transition-all shadow-xs shrink-0 cursor-pointer`}
          title={title}
        >
          <span
            className="w-full h-full rounded-2xs border border-line-strong shadow-inner"
            style={{ backgroundColor: safeColor }}
          />
        </button>
      )}

      {isOpen &&
        popoverPos &&
        createPortal(
          <div
            ref={popoverRef}
            style={{
              position: "fixed",
              top: `${popoverPos.top}px`,
              left: `${popoverPos.left}px`,
              width: "244px",
              zIndex: Z_INDEX.popoverFloating,
            }}
            data-color-picker-portal="true"
            data-popover-portal="true"
            data-mica-overlay="true"
            className="bg-surface-2 border border-line-strong rounded-lg p-2.5 shadow-2xl space-y-2 select-none text-fg backdrop-blur-md"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header: Segmented Mode Selector & Theme-Safe Live Hex Pill */}
            <div className="flex items-center justify-between border-b border-line pb-1.5 h-[28px]">
              <div className="flex items-center p-0.5 bg-surface-3 rounded-xs border border-line w-[144px]">
                <button
                  type="button"
                  onClick={() => setActiveTab("presets")}
                  className={`flex-1 h-[20px] rounded-2xs font-mono text-[9.5px] uppercase tracking-wider font-semibold transition-colors cursor-pointer text-center ${
                    activeTab === "presets"
                      ? "bg-accent-soft text-accent-fg border border-accent/40 shadow-2xs"
                      : "text-fg-3 hover:text-fg border border-transparent"
                  }`}
                >
                  Palette
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab("custom")}
                  className={`flex-1 h-[20px] rounded-2xs font-mono text-[9.5px] uppercase tracking-wider font-semibold transition-colors cursor-pointer text-center ${
                    activeTab === "custom"
                      ? "bg-accent-soft text-accent-fg border border-accent/40 shadow-2xs"
                      : "text-fg-3 hover:text-fg border border-transparent"
                  }`}
                >
                  16M Custom
                </button>
              </div>

              <span className="inline-flex items-center gap-1 font-mono text-[9.5px] px-1.5 py-0.5 rounded-2xs font-semibold bg-surface-3 border border-line text-fg shadow-2xs shrink-0">
                <span
                  className="w-2 h-2 rounded-[2px] border border-line-strong shrink-0"
                  style={{ backgroundColor: safeColor }}
                />
                <span>{safeColor}</span>
              </span>
            </div>

            <div className="h-[128px] flex flex-col justify-center">
              {activeTab === "presets" && (
                <div className="grid grid-cols-8 gap-1.5 justify-center">
                  {STUDIO_COLOR_PALETTE.map((preset) => {
                    const isSelected =
                      safeColor.toLowerCase() === preset.toLowerCase();
                    const isBright = getHexLuminance(preset) > 0.62;
                    return (
                      <button
                        key={preset}
                        type="button"
                        onClick={() => {
                          onChange(preset);
                          setHexInput(preset);
                          setHsv(hexToHsv(preset));
                        }}
                        className={`w-[21px] h-[21px] rounded-xs border transition-all flex items-center justify-center shrink-0 hover:scale-115 cursor-pointer ${
                          isSelected
                            ? "border-fg ring-1 ring-fg scale-110 shadow-sm"
                            : "border-line-strong opacity-90 hover:opacity-100"
                        }`}
                        style={{ backgroundColor: preset }}
                        title={preset}
                      >
                        {isSelected && (
                          <Check
                            className="w-2.5 h-2.5 drop-shadow-sm stroke-[3]"
                            style={{ color: isBright ? "#0D0D0F" : "#FFFFFF" }}
                          />
                        )}
                      </button>
                    );
                  })}
                </div>
              )}

              {activeTab === "custom" && (
                <div className="space-y-2">
                  <div
                    ref={satValRef}
                    onPointerDown={handleSatValDown}
                    onPointerMove={handleSatValMove}
                    className="h-[102px] w-full rounded-xs relative cursor-crosshair overflow-hidden border border-line-strong shadow-inner select-none touch-none"
                    style={{ backgroundColor: baseHueHex }}
                    title="Click or drag to select saturation and brightness"
                  >
                    <div
                      className="absolute inset-0 pointer-events-none"
                      style={{
                        background:
                          "linear-gradient(to right, #FFFFFF 0%, rgba(255, 255, 255, 0) 100%)",
                      }}
                    />
                    <div
                      className="absolute inset-0 pointer-events-none"
                      style={{
                        background:
                          "linear-gradient(to bottom, rgba(0, 0, 0, 0) 0%, #000000 100%)",
                      }}
                    />
                    <div
                      className="absolute w-3.5 h-3.5 rounded-full border-2 border-fg shadow-md -translate-x-1/2 -translate-y-1/2 pointer-events-none ring-1 ring-surface-0"
                      style={{
                        left: `${Math.round(hsv.s * 100)}%`,
                        top: `${Math.round((1 - hsv.v) * 100)}%`,
                        backgroundColor: safeColor,
                      }}
                    />
                  </div>

                  <div
                    ref={hueRef}
                    onPointerDown={handleHueDown}
                    onPointerMove={handleHueMove}
                    className="h-[14px] w-full rounded-full relative cursor-pointer border border-line-strong shadow-inner select-none touch-none"
                    style={{
                      background:
                        "linear-gradient(to right, #ff0000 0%, #ffff00 17%, #00ff00 33%, #00ffff 50%, #0000ff 67%, #ff00ff 83%, #ff0000 100%)",
                    }}
                    title="Click or drag to choose hue spectrum"
                  >
                    <div
                      className="absolute w-3.5 h-3.5 rounded-full bg-surface-0 border-2 border-fg shadow-md -translate-x-1/2 top-1/2 -translate-y-1/2 pointer-events-none ring-1 ring-line-strong"
                      style={{
                        left: `${Math.round(hsv.h * 100)}%`,
                      }}
                    />
                  </div>
                </div>
              )}
            </div>

            <div className="pt-2 border-t border-line flex items-center space-x-1.5 h-[34px]">
              <button
                type="button"
                onClick={handleCopyHex}
                className={`w-[26px] h-[26px] box-border bg-surface-3 hover:bg-surface-1 border rounded-sm flex items-center justify-center transition-colors shrink-0 cursor-pointer ${
                  copied
                    ? "border-accent text-accent-fg bg-accent-soft"
                    : "border-line hover:border-accent text-fg-3 hover:text-fg"
                }`}
                title={
                  copied ? "Copied to clipboard!" : "Copy HEX code (#RRGGBB)"
                }
              >
                {copied ? (
                  <Check className="w-3 h-3 text-accent-fg stroke-[2.5]" />
                ) : (
                  <Copy className="w-3 h-3" />
                )}
              </button>

              <input
                type="text"
                value={hexInput}
                maxLength={7}
                onChange={(e) => setHexInput(e.target.value)}
                onBlur={handleHexSubmit}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleHexSubmit();
                  }
                }}
                placeholder="#HEX"
                className="flex-1 min-w-0 h-[26px] box-border leading-[24px] bg-surface-3 border border-line focus:border-accent px-2 text-center font-mono text-[11px] text-fg uppercase outline-none rounded-sm transition-colors"
                title="Enter custom HEX code (#RRGGBB) and press Enter"
              />

              <button
                type="button"
                onClick={pickRandom}
                className="w-[26px] h-[26px] box-border bg-surface-3 hover:bg-surface-1 border border-line hover:border-accent rounded-sm flex items-center justify-center text-fg-3 hover:text-accent-fg transition-colors shrink-0 cursor-pointer"
                title="Shuffle to random studio color"
              >
                <Shuffle className="w-3 h-3" />
              </button>
            </div>
          </div>,
          document.body
        )}
    </div>
  );
};
