/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Inter", "-apple-system", "BlinkMacSystemFont", '"Segoe UI"', "Roboto", "sans-serif"],
        mono: ['"JetBrains Mono"', "ui-monospace", "SFMono-Regular", "Menlo", "Consolas", "monospace"],
      },
      colors: {
        surface: {
          0: "var(--c-surface-0)",
          1: "var(--c-surface-1)",
          rail: "var(--c-surface-rail)",
          header: "var(--c-surface-header)",
          2: "var(--c-surface-2)",
          3: "var(--c-surface-3)",
          badge: "var(--c-surface-badge)",
          hover: "var(--c-surface-hover)",
        },
        line: {
          DEFAULT: "var(--c-line)",
          subtle: "var(--c-line-subtle)",
          strong: "var(--c-line-strong)",
          hover: "var(--c-line-hover)",
        },
        fg: {
          DEFAULT: "var(--c-fg)",
          2: "var(--c-fg-2)",
          3: "var(--c-fg-3)",
          head: "var(--c-fg-head)",
          faint: "var(--c-fg-faint)",
        },
        accent: {
          DEFAULT: "rgb(var(--accent-rgb) / <alpha-value>)",
          fg: "rgb(var(--accent-fg-rgb) / <alpha-value>)",
          on: "var(--c-accent-on)",
          soft: "var(--signal-accent-bg)",
          hover: "var(--c-accent-hover)",
        },
        ok: "rgb(var(--ok-rgb) / <alpha-value>)",
        warn: "rgb(var(--warn-rgb) / <alpha-value>)",
        info: "rgb(var(--info-rgb) / <alpha-value>)",
        danger: "rgb(var(--danger-rgb) / <alpha-value>)",
      },
      borderRadius: {
        "2xs": "3px",
        xs: "5px",
        sm: "6px",
        md: "8px",
        lg: "10px",
      },
    },
  },
  plugins: [],
};
