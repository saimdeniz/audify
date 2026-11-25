import React from "react";
import { FolderTree, HardDrive, Info, Layers, MoveUpRight } from "lucide-react";
import { useI18n } from "../i18n";
import { Reveal } from "./Reveal";
import { SpotlightCard } from "./SpotlightCard";

const STEP_ICONS = [HardDrive, FolderTree, Layers, MoveUpRight] as const;

export const PortableWorkflowSection: React.FC = () => {
  const { messages } = useI18n();

  return (
    <section id="workflow" className="relative z-10 border-t border-line py-20 sm:py-24">
      <div className="page-rail">
        <Reveal>
          <div className="mb-10">
            <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.14em] text-accent-fg">
              {messages.workflow.eyebrow}
            </div>
            <h2 className="max-w-3xl text-2xl font-semibold tracking-tight text-fg sm:text-4xl">
              {messages.workflow.title}
            </h2>
            <p className="mt-2.5 max-w-2xl text-[14px] leading-relaxed text-fg-2">
              {messages.workflow.subtitle}
            </p>
          </div>
        </Reveal>

        {/* 4-Step Connected Portable Architecture Grid with dashed studio signal rail */}
        <div className="relative grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute left-[12%] right-[12%] top-[36px] hidden border-t border-dashed border-line-strong lg:block"
          />
          {messages.workflow.steps.map((step, idx) => {
            const Icon = STEP_ICONS[idx] ?? HardDrive;
            return (
              <Reveal key={step.num} delayMs={idx * 70}>
                <SpotlightCard className="studio-card-lift surface-card-soft group relative z-10 flex h-full flex-col rounded-md border border-line p-5">
                  <div className="mb-4 flex items-center justify-between">
                    <span className="studio-icon-pop inline-flex h-8 w-8 items-center justify-center rounded-[4px] border border-line bg-surface-1 text-accent-fg">
                      <Icon className="h-4 w-4" />
                    </span>
                    <span className="font-mono text-[11px] font-semibold text-fg-faint transition-colors duration-200 group-hover:text-accent-fg">
                      {step.num}
                    </span>
                  </div>
                  <h3 className="text-[14px] font-semibold text-fg">{step.title}</h3>
                  <p className="mt-2 text-[12.5px] leading-relaxed text-fg-3">{step.desc}</p>
                </SpotlightCard>
              </Reveal>
            );
          })}
        </div>

        {/* Fallback architectural note */}
        <Reveal delayMs={260} className="mt-5">
          <div className="surface-card-soft flex items-start gap-2.5 rounded-md border border-line px-4 py-3 text-[12px] text-fg-2">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-accent-fg" />
            <span>{messages.workflow.fallbackNote}</span>
          </div>
        </Reveal>
      </div>
    </section>
  );
};
