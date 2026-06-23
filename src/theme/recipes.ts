import { defineRecipe } from "@pandacss/dev";

const pageShell = defineRecipe({
  className: "page-shell",
  base: {
    bg: "#f7f9ff",
    minH: "100vh",
    px: { base: "4", md: "5" },
    pb: { base: "4", md: "5" },
  },
});

const header = defineRecipe({
  className: "header",
  base: {
    alignItems: "center",
    display: "flex",
    gap: "6",
    justifyContent: "space-between",
    maxW: "1220px",
    minH: { base: "62px", md: "76px" },
    mx: "auto",
    position: "relative",
    zIndex: 2,
  },
});

const button = defineRecipe({
  className: "button",
  base: {
    alignItems: "center",
    borderRadius: "md",
    cursor: "pointer",
    display: "inline-flex",
    fontWeight: "700",
    gap: "2",
    justifyContent: "center",
    minH: "44px",
    px: "5",
    textDecoration: "none",
    transition:
      "background token(durations.fast) token(easings.standard), border-color token(durations.fast) token(easings.standard), box-shadow token(durations.fast) token(easings.standard), transform token(durations.fast) token(easings.standard)",
    _focusVisible: {
      outline: "3px solid token(colors.violet.400)",
      outlineOffset: "3px",
    },
    _hover: {
      transform: "translateY(-1px)",
    },
  },
  variants: {
    variant: {
      primary: {
        background: "linear-gradient(135deg, #875cf6 0%, #6c46e8 52%, #5d3ed1 100%)",
        borderWidth: "0",
        boxShadow: "cta",
        color: "text.onDark",
        _hover: {
          boxShadow: "strong",
        },
      },
      secondary: {
        bg: "transparent",
        borderColor: "violet.600",
        borderWidth: "1px",
        color: "violet.650",
      },
      ghost: {
        bg: "rgba(255, 255, 255, 0.12)",
        borderColor: "border.onDark",
        borderWidth: "1px",
        color: "text.onDark",
      },
    },
  },
  defaultVariants: {
    variant: "primary",
  },
});

const sectionPanel = defineRecipe({
  className: "section-panel",
  base: {
    background:
      "linear-gradient(180deg, rgba(255, 255, 255, 0.98) 0%, rgba(248, 246, 255, 0.96) 100%)",
    borderColor: "border",
    borderRadius: "0",
    borderWidth: "1px",
    color: "text",
    maxW: "1220px",
    mx: "auto",
  },
});

const cardBase = {
  bg: "surface",
  borderColor: "border",
  borderRadius: "md",
  borderWidth: "1px",
  color: "text",
  transition:
    "border-color token(durations.fast) token(easings.standard), box-shadow token(durations.fast) token(easings.standard), transform token(durations.fast) token(easings.standard)",
  _hover: {
    borderColor: "border.strong",
    boxShadow: "card",
  },
};

const miniFeatureCard = defineRecipe({
  className: "mini-feature-card",
  base: {
    ...cardBase,
    alignItems: "center",
    display: "grid",
    justifyItems: "center",
    minH: "132px",
    p: "4",
    textAlign: "center",
  },
});

const processCard = defineRecipe({
  className: "process-card",
  base: {
    bg: "transparent",
    borderWidth: "0",
    color: "text.onDark",
    minH: "150px",
    p: "2",
    position: "relative",
    textAlign: "center",
  },
});

const trustCard = defineRecipe({
  className: "trust-card",
  base: {
    ...cardBase,
    minH: "132px",
    p: "5",
  },
});

const riskPreviewCard = defineRecipe({
  className: "risk-preview-card",
  base: {
    bg: "rgba(255,255,255,0.16)",
    backdropFilter: "blur(20px)",
    borderColor: "rgba(255,255,255,0.42)",
    borderRadius: "md",
    borderWidth: "1px",
    boxShadow: "strong",
    color: "text.onDark",
    maxW: { base: "100%", md: "430px" },
    p: { base: "5", md: "6" },
    width: "100%",
  },
});

const riskGauge = defineRecipe({
  className: "risk-gauge",
  base: {
    alignItems: "center",
    aspectRatio: "2 / 1",
    display: "flex",
    justifyContent: "center",
    overflow: "hidden",
    position: "relative",
  },
});

const reportPreview = defineRecipe({
  className: "report-preview",
  base: {
    ...cardBase,
    boxShadow: "card",
    minH: "100%",
    minW: 0,
    p: { base: "4", md: "5" },
  },
});

const testimonialCard = defineRecipe({
  className: "testimonial-card",
  base: {
    ...cardBase,
    minH: "150px",
    p: "5",
  },
});

const pricingCard = defineRecipe({
  className: "pricing-card",
  base: {
    alignItems: { base: "start", md: "center" },
    background:
      "linear-gradient(90deg, rgba(5,8,42,0.9), rgba(43,28,115,0.78)), url('/images/siargao-sunset.png') center / cover",
    borderColor: "rgba(255,255,255,0.22)",
    borderRadius: "0",
    borderWidth: "1px",
    boxShadow: "strong",
    color: "text.onDark",
    display: { base: "grid", md: "flex" },
    gap: "6",
    justifyContent: "space-between",
    p: { base: "5", md: "6" },
  },
});

const faqAccordion = defineRecipe({
  className: "faq-accordion",
  base: {
    bg: "surface",
    borderColor: "border",
    borderRadius: "0",
    borderWidth: "1px",
    boxShadow: "card",
    color: "text",
    overflow: "hidden",
  },
});

const footer = defineRecipe({
  className: "footer",
  base: {
    bg: "rgba(5, 8, 42, 0.94)",
    borderColor: "rgba(255,255,255,0.12)",
    borderRadius: "0",
    borderWidth: "1px",
    color: "text.onDark",
    maxW: "1220px",
    mx: "auto",
    p: { base: "5", md: "7" },
  },
});

export const recipes = {
  pageShell,
  header,
  button,
  sectionPanel,
  panel: sectionPanel,
  miniFeatureCard,
  processCard,
  trustCard,
  riskPreviewCard,
  riskGauge,
  reportPreview,
  testimonialCard,
  pricingCard,
  faqAccordion,
  footer,
};
