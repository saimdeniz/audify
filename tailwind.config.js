/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: [
          "Inter",
          "-apple-system",
          "BlinkMacSystemFont",
          "Segoe UI",
          "Roboto",
          "sans-serif",
        ],
        mono: [
          "JetBrains Mono",
          "Cascadia Mono",
          "Fira Code",
          "Consolas",
          "ui-monospace",
          "SFMono-Regular",
          "monospace",
        ],
      },
      borderRadius: {
        "2xs": "3px",
        xs: "5px",
        sm: "6px",
        DEFAULT: "7px",
        md: "8px",
        lg: "10px",
        xl: "12px",
      },
      boxShadow: {
        "2xs": "0 1px 1px 0 rgb(0 0 0 / 0.14)",
        xs: "0 1px 2px 0 rgb(0 0 0 / 0.20)",
      },
      backdropBlur: {
        xs: "2px",
      },
      scale: {
        115: "1.15",
      },
      spacing: {
        "0.2": "1px",
      },
      colors: {
        surface: {
          0: "var(--c-surface-0)",
          1: "var(--c-surface-1)",
          2: "var(--c-surface-2)",
          3: "var(--c-surface-3)",
          rail: "var(--c-surface-rail)",
          header: "var(--c-surface-header)",
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
          hover: "var(--c-accent-hover)",
          fg: "rgb(var(--accent-fg-rgb) / <alpha-value>)",
          soft: "var(--signal-accent-bg)",
          on: "var(--c-accent-on)",
        },
        ok: {
          DEFAULT: "rgb(var(--ok-rgb) / <alpha-value>)",
          on: "var(--c-ok-on)",
        },
        warn: "rgb(var(--warn-rgb) / <alpha-value>)",
        info: "rgb(var(--info-rgb) / <alpha-value>)",
        danger: {
          DEFAULT: "rgb(var(--danger-rgb) / <alpha-value>)",
          on: "var(--c-danger-on)",
        },
      },
    },
  },
  plugins: [],
};
