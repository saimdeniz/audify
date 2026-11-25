import React, { useEffect, useLayoutEffect, useState } from "react";
import { AsciiAtmosphere } from "./components/AsciiAtmosphere";
import { AudifyLiveDemo } from "./components/demo/AudifyLiveDemo";
import { DocsSection } from "./components/DocsSection";
import { DownloadSection } from "./components/DownloadSection";
import { FaqSection } from "./components/FaqSection";
import { FeatureTourSection } from "./components/FeatureTourSection";
import { Footer } from "./components/Footer";
import { HeroSection } from "./components/HeroSection";
import { LightboxModal } from "./components/LightboxModal";
import { MetricsStripSection } from "./components/MetricsStripSection";
import { Navbar } from "./components/Navbar";
import { PortableWorkflowSection } from "./components/PortableWorkflowSection";
import { ScrollProgress } from "./components/ScrollProgress";
import { StudioMarquee } from "./components/StudioMarquee";
import { ThemeProvider } from "./context/ThemeContext";
import { useLatestRelease } from "./hooks/useLatestRelease";
import { I18nProvider } from "./i18n";

export const App: React.FC = () => {
  const [lightbox, setLightbox] = useState<{ src: string; caption: string } | null>(null);
  const release = useLatestRelease();

  // Instant pre-paint jump when opened directly with a hash (#faq, #docs, #workflow, etc.)
  // Temporarily overrides CSS `scroll-behavior: smooth` so new tabs land directly on the
  // target section instead of animating all the way down from the top.
  useLayoutEffect(() => {
    const hash = window.location.hash;
    if (!hash || hash.length < 2) return;
    const id = decodeURIComponent(hash.slice(1));
    const html = document.documentElement;

    const jumpInstant = () => {
      const target = document.getElementById(id);
      if (!target) return;
      const prev = html.style.scrollBehavior;
      html.style.scrollBehavior = "auto";
      target.scrollIntoView({ behavior: "instant" as ScrollBehavior, block: "start" });
      html.style.scrollBehavior = prev;
    };

    jumpInstant();
    const raf = window.requestAnimationFrame(jumpInstant);
    return () => window.cancelAnimationFrame(raf);
  }, []);

  useEffect(() => {
    const onHashChange = () => {
      const hash = window.location.hash;
      if (!hash || hash.length < 2) return;
      const target = document.getElementById(decodeURIComponent(hash.slice(1)));
      if (target) {
        target.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  const openLightbox = (src: string, caption: string) => {
    setLightbox({ src, caption });
  };

  return (
    <I18nProvider>
      <ThemeProvider>
        <div className="relative min-h-screen bg-surface-0 text-fg">
          <ScrollProgress />
          <AsciiAtmosphere />
          <Navbar version={release.version} />

          <main className="relative z-10">
            <HeroSection onOpenLightbox={openLightbox} />
            <StudioMarquee />
            <MetricsStripSection />
            <AudifyLiveDemo />
            <FeatureTourSection onOpenLightbox={openLightbox} />
            <PortableWorkflowSection />
            <DocsSection />
            <FaqSection />
            <DownloadSection release={release} />
          </main>

          <Footer release={release} />

          <LightboxModal
            src={lightbox?.src ?? null}
            caption={lightbox?.caption ?? ""}
            onClose={() => setLightbox(null)}
          />
        </div>
      </ThemeProvider>
    </I18nProvider>
  );
};

export default App;
