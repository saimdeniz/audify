import React from "react";

export interface ModernToggleSwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  title?: string;
  disabled?: boolean;
}

/**
 * Industrial Studio rectangular ON/OFF toggle button (matches Audio & Rules toggles).
 */
export const ModernToggleSwitch: React.FC<ModernToggleSwitchProps> = ({
  checked,
  onChange,
  title,
  disabled,
}) => {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      title={title}
      className={`h-[22px] px-2 rounded-xs border font-mono text-[10px] font-bold inline-flex items-center space-x-1.5 transition-colors shrink-0 ${
        disabled ? "opacity-40 cursor-not-allowed" : "cursor-pointer"
      } ${
        checked
          ? "bg-accent-soft border-accent text-accent-fg"
          : "bg-surface-2 border-line-strong text-fg-2 hover:text-fg"
      }`}
    >
      <span
        className={`w-1.5 h-1.5 rounded-full shrink-0 ${
          checked ? "bg-accent" : "bg-fg-2"
        }`}
      />
      <span>{checked ? "ON" : "OFF"}</span>
    </button>
  );
};
