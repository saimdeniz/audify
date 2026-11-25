import React, { useState } from "react";
import { Check, CheckCircle2, Copy, Download, ExternalLink, FolderOpen } from "lucide-react";
import { SITE_CONFIG } from "../config/siteConfig";
import type { LatestReleaseInfo } from "../hooks/useLatestRelease";
import { useI18n } from "../i18n";
import { Reveal } from "./Reveal";
import { SpotlightCard } from "./SpotlightCard";

interface DownloadSectionProps {
  release: LatestReleaseInfo;
}

export const DownloadSection: React.FC<DownloadSectionProps> = ({ release }) => {
  const { messages } = useI18n();
  const [copied, setCopied] = useState(false);

  const handleCopySha = async () => {
    if (!release.sha256) return;
    try {
      await navigator.clipboard.writeText(release.sha256);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard API unavailable
    }
  };

  return (
    <section id="download" className="relative z-10 border-t border-line py-20 sm:py-24">
      <div className="page-rail">
        <Reveal>
          <SpotlightCard className="surface-glass rounded-lg border border-line-strong p-6 sm:p-10">
            <div className="grid grid-cols-1 items-center gap-8 lg:grid-cols-[minmax(0,1fr)_400px]">
              {/* Left Copy + CTA */}
              <div>
                <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.14em] text-accent-fg">
                  {messages.download.eyebrow}
                </div>
                <h2 className="text-2xl font-semibold tracking-tight text-fg sm:text-4xl">
                  {messages.download.title}
                </h2>
                <p className="mt-3 max-w-xl text-[14px] leading-relaxed text-fg-2">
                  {messages.download.subtitle}
                </p>

                <ul className="mt-6 grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {messages.download.highlights.map((h) => (
                    <li
                      key={h}
                      className="flex items-start gap-2 text-[12.5px] text-fg-2"
                    >
                      <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent-fg" />
                      <span>{h}</span>
                    </li>
                  ))}
                </ul>

                <div className="mt-7 flex flex-wrap items-center gap-3">
                  <a
                    href={release.downloadUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex h-10 items-center gap-2 rounded-sm bg-accent px-5 text-[13px] font-semibold text-accent-on transition-all duration-100 hover:-translate-y-[1px] hover:bg-accent-hover"
                  >
                    <Download className="h-4 w-4" />
                    <span>
                      {messages.download.ctaDownload} ({release.version})
                    </span>
                  </a>
                  <a
                    href={release.releaseUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex h-10 items-center gap-1.5 rounded-sm border border-line-strong bg-surface-2 px-4 text-[12.5px] font-medium text-fg-2 transition-colors hover:border-accent hover:text-accent-fg"
                  >
                    <span>{messages.download.ctaGithub}</span>
                    <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                </div>
              </div>

              {/* Right Portable Build Spec Card */}
              <div className="rounded-md border border-line bg-surface-0 p-5">
                <div className="flex items-center justify-between gap-2 border-b border-line pb-3">
                  <div className="flex items-center gap-2">
                    <FolderOpen className="h-4 w-4 text-accent-fg" />
                    <span className="text-[13px] font-semibold text-fg">
                      {messages.download.cardTitle}
                    </span>
                  </div>
                  <span className="rounded-[3px] border border-accent/40 bg-accent-soft px-1.5 py-0.5 font-mono text-[9.5px] text-accent-fg">
                    {release.version}
                  </span>
                </div>

                <dl className="mt-3.5 space-y-2.5 font-mono text-[11px]">
                  <div className="flex items-center justify-between">
                    <dt className="text-fg-3">Platform</dt>
                    <dd className="text-fg">{SITE_CONFIG.platform}</dd>
                  </div>
                  <div className="flex items-center justify-between">
                    <dt className="text-fg-3">Distribution</dt>
                    <dd className="text-fg">{release.sizeLabel}</dd>
                  </div>
                  <div className="flex items-center justify-between">
                    <dt className="text-fg-3">Data Directory</dt>
                    <dd className="text-accent-fg">./user/ (beside .exe)</dd>
                  </div>
                  <div className="flex items-center justify-between">
                    <dt className="text-fg-3">License</dt>
                    <dd>
                      <a
                        href={SITE_CONFIG.licenseUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-fg hover:text-accent-fg hover:underline"
                      >
                        {SITE_CONFIG.licenseSpdx}
                      </a>
                    </dd>
                  </div>
                  <div className="flex items-center justify-between">
                    <dt className="text-fg-3">Telemetry</dt>
                    <dd className="text-fg">None (Offline-First)</dd>
                  </div>
                </dl>

                {/* SHA-256 Checksum Bar */}
                <div className="mt-4 rounded-[4px] border border-line bg-surface-1 p-2.5">
                  <div className="mb-1 flex items-center justify-between">
                    <span className="font-mono text-[9.5px] uppercase tracking-wider text-fg-3">
                      {messages.download.checksumLabel}
                    </span>
                    {release.sha256 ? (
                      <button
                        type="button"
                        onClick={() => void handleCopySha()}
                        className="inline-flex items-center gap-1 font-mono text-[10px] text-accent-fg hover:underline"
                      >
                        {copied ? (
                          <>
                            <Check className="h-3 w-3" />
                            <span>{messages.download.copied}</span>
                          </>
                        ) : (
                          <>
                            <Copy className="h-3 w-3" />
                            <span>{messages.download.copyChecksum}</span>
                          </>
                        )}
                      </button>
                    ) : (
                      <a
                        href={release.sha256Url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 font-mono text-[10px] text-accent-fg hover:underline"
                      >
                        <span>SHA256SUMS.txt</span>
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    )}
                  </div>
                  {release.sha256 ? (
                    <code className="block break-all font-mono text-[10px] leading-relaxed text-fg-2">
                      {release.sha256}
                    </code>
                  ) : (
                    <a
                      href={release.sha256Url}
                      target="_blank"
                      rel="noreferrer"
                      className="block truncate font-mono text-[10px] text-fg-3 hover:text-fg"
                    >
                      Verify latest checksum from GitHub Releases ({release.version})
                    </a>
                  )}
                </div>
              </div>
            </div>
          </SpotlightCard>
        </Reveal>
      </div>
    </section>
  );
};
