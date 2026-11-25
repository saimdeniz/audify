import React from "react";
import { useI18n } from "../i18n";

export const StudioMarquee: React.FC = () => {
  const { messages } = useI18n();
  const items = messages.marquee.items;

  return (
    <section
      aria-label={messages.marquee.label}
      className="relative z-10 border-y border-line bg-surface-1 py-4"
    >
      <div className="page-rail mb-2.5 flex items-center justify-between">
        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-fg-3">
          {messages.marquee.label}
        </span>
        <span className="font-mono text-[10px] text-fg-faint">NATIVE OLE DRAG · WASAPI · FTS5</span>
      </div>

      <div className="relative overflow-hidden">
        <div className="marquee-track flex items-center gap-3">
          {[...items, ...items].map((item, idx) => (
            <div
              key={`${item}-${idx}`}
              className="inline-flex shrink-0 items-center gap-2 rounded-[3px] border border-line bg-surface-2 px-3 py-1.5 font-mono text-[11px] text-fg-2"
            >
              <span className="h-1.5 w-1.5 rounded-[2px] bg-accent" />
              <span>{item}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};
