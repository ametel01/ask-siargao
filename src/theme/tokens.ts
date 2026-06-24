export const tokens = {
  colors: {
    navy: {
      980: { value: "#05082a" },
      950: { value: "#090d3a" },
      900: { value: "#10124a" },
      850: { value: "#17105a" },
      800: { value: "#20186b" },
    },
    violet: {
      700: { value: "#4c31b8" },
      650: { value: "#5d3ed1" },
      600: { value: "#6c46e8" },
      550: { value: "#7a51f0" },
      500: { value: "#875cf6" },
      400: { value: "#a486ff" },
    },
    lavender: {
      50: { value: "#fbfaff" },
      100: { value: "#f5f3ff" },
      150: { value: "#eeeafd" },
      200: { value: "#e2dcf7" },
      300: { value: "#cbc3ec" },
      400: { value: "#b8a6ff" },
    },
    sunset: {
      coral: { value: "#ff9b83" },
      peach: { value: "#ffc69a" },
      gold: { value: "#ffd65a" },
    },
    confidence: {
      high: { value: "#1e9f63" },
      highSoft: { value: "#e6f8ee" },
      medium: { value: "#d99b23" },
      mediumSoft: { value: "#fff4cf" },
    },
    surface: {
      DEFAULT: { value: "#ffffff" },
      soft: { value: "#fbfaff" },
      tint: { value: "#f7f5ff" },
      glass: { value: "rgba(255, 255, 255, 0.94)" },
      darkGlass: { value: "rgba(9, 13, 58, 0.72)" },
    },
    text: {
      strong: { value: "#0d104a" },
      DEFAULT: { value: "#17184f" },
      muted: { value: "#5f5f87" },
      soft: { value: "#8483a8" },
      onDark: { value: "#ffffff" },
      onDarkMuted: { value: "#d8d5f4" },
    },
    risk: {
      low: { value: "#60aa60" },
      lowDark: { value: "#2e8a38" },
      medium: { value: "#e6a928" },
      high: { value: "#d84b55" },
    },
    border: {
      DEFAULT: { value: "#ddd8ef" },
      strong: { value: "#c8bee9" },
      onDark: { value: "rgba(255, 255, 255, 0.34)" },
    },
    shadow: {
      DEFAULT: { value: "rgba(14, 12, 56, 0.16)" },
      strong: { value: "rgba(8, 8, 38, 0.32)" },
    },
  },
  gradients: {
    heroOverlay: {
      value:
        "linear-gradient(90deg, rgba(5, 8, 42, 0.96) 0%, rgba(16, 18, 74, 0.72) 46%, rgba(93, 62, 209, 0.22) 100%)",
    },
    coastalOverlay: {
      value:
        "linear-gradient(90deg, rgba(5, 8, 42, 0.94) 0%, rgba(9, 13, 58, 0.76) 48%, rgba(76, 49, 184, 0.34) 100%)",
    },
    cta: {
      value: "linear-gradient(135deg, #875cf6 0%, #6c46e8 56%, #4c31b8 100%)",
    },
    priceCard: {
      value: "linear-gradient(145deg, #271776 0%, #17105a 56%, #0c103f 100%)",
    },
    panel: {
      value:
        "linear-gradient(180deg, rgba(255, 255, 255, 0.98) 0%, rgba(248, 246, 255, 0.96) 100%)",
    },
  },
  fonts: {
    sans: { value: '"Avenir Next", "Segoe UI", system-ui, sans-serif' },
    display: { value: 'Georgia, "Times New Roman", serif' },
  },
  fontSizes: {
    "2xs": { value: "0.6875rem" },
    xs: { value: "0.75rem" },
    sm: { value: "0.875rem" },
    md: { value: "1rem" },
    lg: { value: "1.125rem" },
    xl: { value: "1.375rem" },
    "2xl": { value: "1.75rem" },
    "3xl": { value: "2.5rem" },
    "4xl": { value: "3rem" },
  },
  radii: {
    xs: { value: "0.25rem" },
    sm: { value: "0.375rem" },
    md: { value: "0.5rem" },
    lg: { value: "0.625rem" },
    xl: { value: "0.75rem" },
    pill: { value: "999px" },
  },
  shadows: {
    card: { value: "0 14px 36px rgba(14, 12, 56, 0.12)" },
    panel: { value: "0 18px 48px rgba(14, 12, 56, 0.16)" },
    strong: { value: "0 22px 54px rgba(8, 8, 38, 0.28)" },
    cta: { value: "0 10px 28px rgba(108, 70, 232, 0.34)" },
    violetGlow: { value: "0 18px 46px rgba(124, 81, 240, 0.38)" },
    coastalFrame: { value: "0 24px 80px rgba(0, 0, 0, 0.42)" },
  },
  spacing: {
    1: { value: "0.25rem" },
    2: { value: "0.5rem" },
    3: { value: "0.75rem" },
    4: { value: "1rem" },
    5: { value: "1.25rem" },
    6: { value: "1.5rem" },
    8: { value: "2rem" },
    10: { value: "2.5rem" },
    12: { value: "3rem" },
    16: { value: "4rem" },
  },
  easings: {
    standard: { value: "cubic-bezier(0.2, 0, 0, 1)" },
  },
  durations: {
    fast: { value: "140ms" },
    normal: { value: "220ms" },
    slow: { value: "360ms" },
  },
};
