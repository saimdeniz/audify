import React, { useEffect, useRef, useState } from "react";
import { Cpu, Gauge, ShieldCheck } from "lucide-react";
import { useI18n } from "../i18n";
import { Reveal } from "./Reveal";
import { SpotlightCard } from "./SpotlightCard";

interface MetricSpec {
  id: "ram" | "ai" | "telemetry";
  target: number;
  decimals: number;
  prefix: string;
  suffix: string;
}

const METRIC_SPECS: readonly MetricSpec[] = [
  { id: "ram", target: 400, decimals: 0, prefix: "~", suffix: " MB" },
  { id: "ai", target: 0.2, decimals: 1, prefix: "", suffix: " ms" },
  { id: "telemetry", target: 0, decimals: 0, prefix: "", suffix: " bytes" },
] as const;

const METRIC_ICONS = [Gauge, Cpu, ShieldCheck] as const;

interface AnimatedMetricValueProps {
  spec: MetricSpec;
  active: boolean;
}

const AnimatedMetricValue: React.FC<AnimatedMetricValueProps> = ({ spec, active }) => {
  const [display, setDisplay] = useState<number>(() => (spec.target === 0 ? 0 : 0));
  const animatedRef = useRef(false);

  useEffect(() => {
    if (!active || animatedRef.current) return;
    animatedRef.current = true;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced || spec.target === 0) {
      setDisplay(spec.target);
      return;
    }

    const duration = 1250;
    const start = performance.now();
    let rafId = 0;

    const tick = (now: number) => {
      const k = Math.min(1, (now - start) / duration);
      // Exponential-out cubic matching studio hardware meters
      const eased = 1 - Math.pow(1 - k, 3);
      setDisplay(spec.target * eased);
      if (k < 1) {
        rafId = window.requestAnimationFrame(tick);
      } else {
        setDisplay(spec.target);
      }
    };

    rafId = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(rafId);
  }, [active, spec.target]);

  const formatted =
    spec.decimals > 0 ? display.toFixed(spec.decimals) : Math.round(display).toString();

  return (
    <span className="font-mono text-3xl font-semibold tracking-tight text-fg sm:text-4xl">
      {spec.prefix}
      {formatted}
      <span className="text-accent-fg">{spec.suffix}</span>
    </span>
  );
};

export const MetricsStripSection: React.FC = () => {
  const { messages } = useI18n();
  const sectionRef = useRef<HTMLElement | null>(null);
  const [inView, setInView] = useState<boolean>(() => Boolean(window.location.hash));

  useEffect(() => {
    if (inView) return;
    const el = sectionRef.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setInView(true);
          observer.disconnect();
        }
      },
      { threshold: 0.35 }
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [inView]);

  return (
    <section
      ref={sectionRef}
      aria-label={messages.metrics.eyebrow}
      className="relative z-10 border-b border-line py-10 sm:py-11"
    >
      <div className="page-rail">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-accent-fg">
            {messages.metrics.eyebrow}
          </span>
          <span className="font-mono text-[10px] text-fg-3">
            {messages.metrics.note}
          </span>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {METRIC_SPECS.map((spec, idx) => {
            const Icon = METRIC_ICONS[idx] ?? Gauge;
            const copy = messages.metrics.items[idx];
            return (
              <Reveal key={spec.id} delayMs={idx * 70}>
                <SpotlightCard className="studio-card-lift surface-card-soft group flex h-full flex-col justify-between rounded-md border border-line p-5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-[10px] uppercase tracking-wider text-fg-3">
                      {copy.label}
                    </span>
                    <span className="studio-icon-pop flex h-7 w-7 items-center justify-center rounded-[4px] border border-line bg-surface-1 text-accent-fg">
                      <Icon className="h-3.5 w-3.5" />
                    </span>
                  </div>

                  <div className="mt-4">
                    <AnimatedMetricValue spec={spec} active={inView} />
                    <p className="mt-2 text-[12.5px] leading-relaxed text-fg-3">
                      {copy.desc}
                    </p>
                  </div>
                </SpotlightCard>
              </Reveal>
            );
          })}
        </div>
      </div>
    </section>
  );
};
