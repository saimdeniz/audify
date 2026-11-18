import React, { Suspense, lazy, useLayoutEffect, useRef, useState } from "react";
import { Columns3 } from "lucide-react";
import { VisibleColumnsState } from "./tableLayout";

const LazyHeaderColumnPickerMenu = lazy(() =>
  import("./HeaderColumnPickerMenu").then((m) => ({
    default: m.HeaderColumnPickerMenu,
  }))
);

interface HeaderColumnPickerProps {
  showColumnPicker: boolean;
  setShowColumnPicker: React.Dispatch<React.SetStateAction<boolean>>;
  visibleCols: VisibleColumnsState;
  toggleVisibleCol: (key: keyof VisibleColumnsState) => void;
  resetTableLayout: () => void;
}

export const HeaderColumnPicker: React.FC<HeaderColumnPickerProps> = ({
  showColumnPicker,
  setShowColumnPicker,
  visibleCols,
  toggleVisibleCol,
  resetTableLayout,
}) => {
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const [menuPos, setMenuPos] = useState<{ top: number; right: number }>({
    top: 96,
    right: 8,
  });

  useLayoutEffect(() => {
    if (!showColumnPicker) return;
    const update = () => {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect || (rect.width === 0 && rect.height === 0)) return;
      const top = Math.min(window.innerHeight - 280, rect.bottom + 4);
      const right = Math.max(8, window.innerWidth - rect.right);
      setMenuPos({ top, right });
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [showColumnPicker]);

  return (
    <div
      className="w-[28px] h-full flex items-center justify-center shrink-0 border-l border-line-subtle bg-surface-header relative z-30"
      onClick={(e) => e.stopPropagation()}
    >
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setShowColumnPicker((v) => !v)}
        className={`w-[20px] h-[20px] rounded-xs flex items-center justify-center transition-colors ${
          showColumnPicker
            ? "bg-accent text-accent-on"
            : "text-fg-2 hover:text-fg hover:bg-surface-3"
        }`}
        title="Columns"
      >
        <Columns3 className="w-3.5 h-3.5" />
      </button>

      {showColumnPicker && (
        <Suspense fallback={null}>
          <LazyHeaderColumnPickerMenu
            menuPos={menuPos}
            visibleCols={visibleCols}
            toggleVisibleCol={toggleVisibleCol}
            resetTableLayout={resetTableLayout}
          />
        </Suspense>
      )}
    </div>
  );
};
