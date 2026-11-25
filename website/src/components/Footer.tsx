import React from "react";
import { SITE_CONFIG } from "../config/siteConfig";
import type { LatestReleaseInfo } from "../hooks/useLatestRelease";
import { useI18n } from "../i18n";

interface FooterProps {
  release: LatestReleaseInfo;
}

export const Footer: React.FC<FooterProps> = ({ release }) => {
  const { messages } = useI18n();

  return (
    <footer className="relative z-10 overflow-hidden border-t border-line bg-surface-1 pb-10 pt-10 md:pb-12 md:pt-14">
      {/* Subtle accent top glow */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-px"
        style={{
          background:
            "linear-gradient(90deg, transparent 0%, rgb(var(--accent-rgb) / 0.55) 50%, transparent 100%)",
        }}
      />

      <div className="page-rail">
        <div className="grid grid-cols-1 gap-8 md:grid-cols-[minmax(0,1.4fr)_minmax(0,2.2fr)] md:gap-10">
          {/* Brand */}
          <div>
            <div className="flex items-center gap-2">
              <img
                src="./audify-icon.png"
                alt=""
                aria-hidden="true"
                className="h-6 w-6 rounded-[5px] object-contain"
              />
              <span className="text-[14px] font-semibold text-fg">{SITE_CONFIG.appName}</span>
              <span className="rounded-[3px] border border-line bg-surface-badge px-1.5 py-0.5 font-mono text-[10px] text-fg-3">
                {release.version}
              </span>
            </div>
            <p className="mt-3 max-w-xs text-[12.5px] leading-relaxed text-fg-3">
              {messages.footer.tagline}
            </p>
          </div>

          {/* 3 Compact Link Columns — side-by-side even on mobile so footer never becomes a tall tower */}
          <div className="grid grid-cols-2 gap-x-6 gap-y-6 min-[440px]:grid-cols-3">
            {/* Product */}
            <div>
              <h4 className="font-mono text-[10px] uppercase tracking-wider text-fg-head">
                {messages.footer.colProduct}
              </h4>
              <ul className="mt-2.5 space-y-1.5 text-[12.5px] text-fg-3">
                <li>
                  <a href="#overview" className="hover:text-accent-fg">
                    {messages.nav.overview}
                  </a>
                </li>
                <li>
                  <a href="#demo" className="hover:text-accent-fg">
                    {messages.nav.demo}
                  </a>
                </li>
                <li>
                  <a href="#features" className="hover:text-accent-fg">
                    {messages.nav.features}
                  </a>
                </li>
                <li>
                  <a href="#download" className="hover:text-accent-fg">
                    {messages.nav.download}
                  </a>
                </li>
              </ul>
            </div>

            {/* Reference */}
            <div>
              <h4 className="font-mono text-[10px] uppercase tracking-wider text-fg-head">
                {messages.footer.colResources}
              </h4>
              <ul className="mt-2.5 space-y-1.5 text-[12.5px] text-fg-3">
                <li>
                  <a href="#workflow" className="hover:text-accent-fg">
                    {messages.nav.workflow}
                  </a>
                </li>
                <li>
                  <a href="#docs" className="hover:text-accent-fg">
                    {messages.nav.docs}
                  </a>
                </li>
                <li>
                  <a href="#faq" className="hover:text-accent-fg">
                    {messages.nav.faq}
                  </a>
                </li>
                <li>
                  <a
                    href={SITE_CONFIG.githubRepoUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="hover:text-accent-fg"
                  >
                    GitHub Repository
                  </a>
                </li>
              </ul>
            </div>

            {/* Open Source */}
            <div className="col-span-2 min-[440px]:col-span-1">
              <h4 className="font-mono text-[10px] uppercase tracking-wider text-fg-head">
                {messages.footer.colAudio}
              </h4>
              <ul className="mt-2.5 space-y-1.5 text-[12.5px] text-fg-3">
                <li>
                  <a
                    href={SITE_CONFIG.licenseUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="hover:text-accent-fg"
                  >
                    {SITE_CONFIG.licenseSpdx} License
                  </a>
                </li>
                <li>
                  <a
                    href={SITE_CONFIG.thirdPartyNoticesUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="hover:text-accent-fg"
                  >
                    Third-Party Notices
                  </a>
                </li>
                <li>
                  <a
                    href={release.releaseUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="hover:text-accent-fg"
                  >
                    Latest Release ({release.version})
                  </a>
                </li>
                <li>
                  <a
                    href="https://creativecommons.org/publicdomain/zero/1.0/"
                    target="_blank"
                    rel="noreferrer"
                    className="hover:text-accent-fg"
                  >
                    {messages.footer.demoAudioShort}
                  </a>
                </li>
              </ul>
            </div>
          </div>
        </div>

        <div className="mt-8 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-5 font-mono text-[11px] text-fg-3">
          <span>{messages.footer.copyright}</span>
          <span>
            {SITE_CONFIG.appName} {release.version} · {release.publishedYear}
          </span>
        </div>
      </div>
    </footer>
  );
};
