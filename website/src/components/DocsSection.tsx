import React, { useMemo, useState } from "react";
import { CheckCircle2, Terminal } from "lucide-react";
import { useI18n } from "../i18n";
import { Reveal } from "./Reveal";

/**
 * Unified Documentation & Studio Reference.
 * Strictly aligned to `.page-rail` (1200px) with fixed 248px + minmax(0, 1fr) track
 * and consistent min-height (440px) across all 5 tabs so switching tabs never shifts layout.
 */
export const DocsSection: React.FC = () => {
  const { messages } = useI18n();
  const tabs = messages.docs.tabs;
  const [activeTabId, setActiveTabId] = useState<string>(tabs[0].id);

  const activeTab = useMemo(
    () => tabs.find((t) => t.id === activeTabId) ?? tabs[0],
    [tabs, activeTabId]
  );

  return (
    <section id="docs" className="relative z-10 border-t border-line py-20 sm:py-24">
      <div className="page-rail">
        <Reveal>
          <div className="mb-10">
            <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.14em] text-accent-fg">
              {messages.docs.eyebrow}
            </div>
            <h2 className="text-2xl font-semibold tracking-tight text-fg sm:text-4xl">
              {messages.docs.title}
            </h2>
            <p className="mt-2.5 max-w-2xl text-[14px] leading-relaxed text-fg-2">
              {messages.docs.subtitle}
            </p>
          </div>
        </Reveal>

        <Reveal delayMs={80}>
          <div className="grid w-full grid-cols-1 items-start gap-5 lg:grid-cols-[248px_minmax(0,1fr)]">
            {/* Fixed-width Tab Selector Rail */}
            <div
              role="tablist"
              aria-label={messages.docs.title}
              className="surface-card-soft flex flex-row gap-1 overflow-x-auto rounded-md border border-line p-2 lg:flex-col"
            >
              {tabs.map((tab) => {
                const isActive = tab.id === activeTab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    role="tab"
                    aria-selected={isActive}
                    onClick={() => setActiveTabId(tab.id)}
                    className={`flex shrink-0 items-center gap-2.5 rounded-[4px] border px-3 py-2.5 text-left font-mono text-[11.5px] transition-colors duration-75 ${
                      isActive
                        ? "border-accent bg-accent-soft font-semibold text-accent-fg"
                        : "border-transparent text-fg-2 hover:bg-surface-hover hover:text-fg"
                    }`}
                  >
                    <span className={isActive ? "text-accent-fg" : "text-fg-faint"}>
                      {tab.code}
                    </span>
                    <span>·</span>
                    <span>{tab.label}</span>
                  </button>
                );
              })}
            </div>

            {/* Unified Fixed-Geometry Content Panel (zero width/height jump between tabs) */}
            <div
              role="tabpanel"
              className="surface-glass flex min-h-[440px] w-full flex-col justify-between rounded-md border border-line-strong p-6 sm:p-7 lg:min-h-[548px]"
            >
              <div>
                {/* Consistent Card Header */}
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line pb-4">
                  <div>
                    <h3 className="text-[17px] font-semibold tracking-tight text-fg">
                      {activeTab.heading}
                    </h3>
                    <p className="mt-1 text-[13px] leading-relaxed text-fg-3">
                      {activeTab.summary}
                    </p>
                  </div>
                  <span className="rounded-[3px] border border-line bg-surface-badge px-2 py-0.5 font-mono text-[10px] tracking-wider text-fg-3">
                    {activeTab.badge}
                  </span>
                </div>

                {/* Tab 01: Portable Directory Tree */}
                {"codeLines" in activeTab && activeTab.codeLines && (
                  <div className="mt-5 space-y-4">
                    <div className="overflow-x-auto rounded-sm border border-line bg-surface-0 p-4">
                      <div className="mb-2 flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-fg-3">
                        <Terminal className="h-3 w-3 text-accent-fg" />
                        <span>{activeTab.codeTitle}</span>
                      </div>
                      <pre className="font-mono text-[11px] leading-5 text-fg-2">
                        {activeTab.codeLines.join("\n")}
                      </pre>
                    </div>
                    <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                      {activeTab.notes.map((note) => (
                        <div
                          key={note}
                          className="flex items-start gap-2 rounded-sm border border-line bg-surface-1 p-3 text-[12px] leading-relaxed text-fg-2"
                        >
                          <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent-fg" />
                          <span>{note}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Tab 02: Search Syntax Rows */}
                {"rows" in activeTab && activeTab.rows && (
                  <div className="mt-5 flex flex-col gap-2">
                    {activeTab.rows.map((row) => (
                      <div
                        key={row.syntax}
                        className="grid grid-cols-1 items-center gap-2 rounded-sm border border-line bg-surface-1 px-3.5 py-2.5 sm:grid-cols-[200px_minmax(0,1fr)]"
                      >
                        <code className="inline-block w-fit rounded-[3px] border border-line-strong bg-surface-0 px-2 py-0.5 font-mono text-[11.5px] text-accent-fg">
                          {row.syntax}
                        </code>
                        <span className="text-[12.5px] leading-relaxed text-fg-2">{row.desc}</span>
                      </div>
                    ))}
                  </div>
                )}

                {/* Tab 03 & 05: Structured 2x2 Bullet Cards */}
                {"bullets" in activeTab && activeTab.bullets && (
                  <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
                    {activeTab.bullets.map((b) => (
                      <div
                        key={b.title}
                        className="rounded-sm border border-line bg-surface-1 p-4"
                      >
                        <h4 className="text-[13px] font-semibold text-fg">{b.title}</h4>
                        <p className="mt-1.5 text-[12px] leading-relaxed text-fg-3">{b.body}</p>
                      </div>
                    ))}
                  </div>
                )}

                {/* Tab 04: Studio Keyboard Cheatsheet (same full-width geometry!) */}
                {"shortcuts" in activeTab && activeTab.shortcuts && (
                  <div className="mt-5 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                    {activeTab.shortcuts.map((sc) => (
                      <div
                        key={sc.action}
                        className="flex items-center justify-between gap-3 rounded-sm border border-line bg-surface-1 px-3.5 py-2.5"
                      >
                        <span className="text-[12.5px] text-fg-2">{sc.action}</span>
                        <kbd className="shrink-0 rounded-[3px] border border-line-strong bg-surface-0 px-2 py-0.5 font-mono text-[11px] font-medium text-accent-fg">
                          {sc.keys}
                        </kbd>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Consistent Panel Footer Bar */}
              <div className="mt-6 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t border-line-subtle pt-3 font-mono text-[10px] text-fg-3">
                <span>AUDIFY REFERENCE · SECTION {activeTab.code} / 05</span>
                <span>WINDOWS 10/11 · PORTABLE</span>
              </div>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
};
