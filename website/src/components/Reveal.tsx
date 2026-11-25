import React, { useEffect, useRef, useState } from "react";

interface RevealProps {
  children: React.ReactNode;
  className?: string;
  delayMs?: number;
}

export const Reveal: React.FC<RevealProps> = ({ children, className = "", delayMs = 0 }) => {
  const ref = useRef<HTMLDivElement | null>(null);
  // If page opened directly with a hash (#faq, #docs, etc.), skip entrance fade so the target renders immediately
  const [visible, setVisible] = useState<boolean>(() => Boolean(window.location.hash));

  useEffect(() => {
    if (visible) return;
    const el = ref.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { threshold: 0.08, rootMargin: "0px 0px -36px 0px" }
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [visible]);

  return (
    <div
      ref={ref}
      data-visible={visible ? "true" : "false"}
      style={delayMs > 0 ? { transitionDelay: `${delayMs}ms` } : undefined}
      className={`reveal-item ${className}`}
    >
      {children}
    </div>
  );
};
