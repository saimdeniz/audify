import React, { useCallback, useEffect, useRef } from "react";

interface MagneticLinkProps extends React.AnchorHTMLAttributes<HTMLAnchorElement> {
  strengthX?: number;
  strengthY?: number;
}

/**
 * Tactile cursor-pull CTA link inspired by exponential-out hardware feel.
 * Automatically disables itself on coarse/touch pointers and reduced-motion preferences.
 */
export const MagneticLink: React.FC<MagneticLinkProps> = ({
  strengthX = 0.22,
  strengthY = 0.3,
  className = "",
  onMouseMove,
  onMouseLeave,
  children,
  ...rest
}) => {
  const ref = useRef<HTMLAnchorElement | null>(null);
  const rafRef = useRef<number>(0);
  const enabledRef = useRef<boolean>(false);

  useEffect(() => {
    const finePointer = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    enabledRef.current = finePointer && !reduced;
    return () => window.cancelAnimationFrame(rafRef.current);
  }, []);

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLAnchorElement>) => {
      onMouseMove?.(e);
      if (!enabledRef.current) return;
      const el = ref.current;
      if (!el) return;

      const rect = el.getBoundingClientRect();
      const dx = e.clientX - (rect.left + rect.width * 0.5);
      const dy = e.clientY - (rect.top + rect.height * 0.5);
      const tx = Math.max(-12, Math.min(12, dx * strengthX));
      const ty = Math.max(-8, Math.min(8, dy * strengthY));

      window.cancelAnimationFrame(rafRef.current);
      rafRef.current = window.requestAnimationFrame(() => {
        el.style.transform = `translate3d(${tx.toFixed(2)}px, ${ty.toFixed(2)}px, 0)`;
      });
    },
    [onMouseMove, strengthX, strengthY]
  );

  const handleMouseLeave = useCallback(
    (e: React.MouseEvent<HTMLAnchorElement>) => {
      onMouseLeave?.(e);
      const el = ref.current;
      if (!el) return;
      window.cancelAnimationFrame(rafRef.current);
      el.style.transform = "translate3d(0, 0, 0)";
    },
    [onMouseLeave]
  );

  return (
    <a
      ref={ref}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      className={`magnetic-cta ${className}`}
      {...rest}
    >
      {children}
    </a>
  );
};
