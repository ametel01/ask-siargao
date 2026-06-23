import { defineRecipe } from "@pandacss/dev";

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
    minH: "11",
    px: "5",
    textDecoration: "none",
    transition: "background 160ms ease, border-color 160ms ease, transform 160ms ease",
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
        bg: "violet.600",
        color: "text.onDark",
        _hover: {
          bg: "violet.500",
        },
      },
      secondary: {
        bg: "surface.glass",
        borderColor: "border.onDark",
        borderWidth: "1px",
        color: "text.strong",
      },
    },
  },
  defaultVariants: {
    variant: "primary",
  },
});

const panel = defineRecipe({
  className: "panel",
  base: {
    bg: "surface.glass",
    borderColor: "border",
    borderRadius: "xl",
    borderWidth: "1px",
    boxShadow: "panel",
    color: "text",
  },
});

export const recipes = {
  button,
  panel,
};
