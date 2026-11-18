import React from "react";
import { ModernToggleSwitch } from "./ModernToggleSwitch";

export interface ToggleRowProps {
  label: React.ReactNode;
  description?: React.ReactNode;
  checked: boolean;
  onChange: (next: boolean) => void;
  title?: string;
  disabled?: boolean;
  compact?: boolean;
}

/**
 * Shared Settings switch row pairing a label (with optional sub-description)
 * and a `ModernToggleSwitch`.
 */
export const ToggleRow: React.FC<ToggleRowProps> = ({
  label,
  description,
  checked,
  onChange,
  title,
  disabled,
  compact = false,
}) => {
  if (description) {
    return (
      <div className="py-2 px-3 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[12px] font-medium text-fg">{label}</div>
          <div className="text-[11px] text-fg-2">{description}</div>
        </div>
        <ModernToggleSwitch
          checked={checked}
          onChange={onChange}
          title={title}
          disabled={disabled}
        />
      </div>
    );
  }

  return (
    <div
      className={`${
        compact ? "h-[36px]" : "h-[38px]"
      } px-3 flex items-center justify-between gap-3`}
    >
      <span className="text-[12px] font-medium text-fg truncate">{label}</span>
      <ModernToggleSwitch
        checked={checked}
        onChange={onChange}
        title={title}
        disabled={disabled}
      />
    </div>
  );
};
