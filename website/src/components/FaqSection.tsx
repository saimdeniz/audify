import React, { useState } from "react";
import { Plus } from "lucide-react";
import { useI18n } from "../i18n";
import { Reveal } from "./Reveal";

interface FaqItemData {
  q: string;
  a: string;
}

interface FaqColumnProps {
  items: readonly FaqItemData[];
  colPrefix: string;
  openKey: string | null;
  onToggle: (key: string) => void;
}

const FaqColumn: React.FC<FaqColumnProps> = ({ items, colPrefix, openKey, onToggle }) => (
  <div className="flex flex-col gap-3">
    {items.map((item, idx) => {
      const key = `${colPrefix}-${idx}`;
      const isOpen = openKey === key;
      return (
        <div
          key={key}
          className={`surface-card-soft rounded-md border transition-colors duration-100 ${
            isOpen ? "border-accent" : "border-line hover:border-line-hover"
          }`}
        >
          <button
            type="button"
            aria-expanded={isOpen}
            onClick={() => onToggle(key)}
            className="flex w-full items-center justify-between gap-4 px-4 py-3.5 text-left"
          >
            <span className="text-[13.5px] font-medium text-fg">{item.q}</span>
            <Plus
              className={`h-4 w-4 shrink-0 text-accent-fg transition-transform duration-200 ${
                isOpen ? "rotate-45" : "rotate-0"
              }`}
            />
          </button>
          <div
            className="grid transition-[grid-template-rows] duration-200 ease-out"
            style={{ gridTemplateRows: isOpen ? "1fr" : "0fr" }}
          >
            <div className="overflow-hidden">
              <p className="border-t border-line-subtle px-4 pb-4 pt-3 text-[13px] leading-relaxed text-fg-2">
                {item.a}
              </p>
            </div>
          </div>
        </div>
      );
    })}
  </div>
);

/**
 * Independent 2-column flex-stack FAQ.
 * Expanding an item on the left NEVER stretches a shared CSS Grid row on the right!
 */
export const FaqSection: React.FC = () => {
  const { messages } = useI18n();
  const [openKey, setOpenKey] = useState<string | null>("left-0");

  const handleToggle = (key: string) => {
    setOpenKey((prev) => (prev === key ? null : key));
  };

  return (
    <section id="faq" className="relative z-10 border-t border-line py-20 sm:py-24">
      <div className="page-rail">
        <Reveal>
          <div className="mb-10">
            <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.14em] text-accent-fg">
              {messages.faq.eyebrow}
            </div>
            <h2 className="text-2xl font-semibold tracking-tight text-fg sm:text-4xl">
              {messages.faq.title}
            </h2>
            <p className="mt-2.5 max-w-2xl text-[14px] leading-relaxed text-fg-2">
              {messages.faq.subtitle}
            </p>
          </div>
        </Reveal>

        <Reveal delayMs={80}>
          <div className="grid grid-cols-1 items-start gap-3 md:grid-cols-2">
            <FaqColumn
              items={messages.faq.leftColumn}
              colPrefix="left"
              openKey={openKey}
              onToggle={handleToggle}
            />
            <FaqColumn
              items={messages.faq.rightColumn}
              colPrefix="right"
              openKey={openKey}
              onToggle={handleToggle}
            />
          </div>
        </Reveal>
      </div>
    </section>
  );
};
