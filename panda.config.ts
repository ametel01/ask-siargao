import { defineConfig } from "@pandacss/dev";

import { recipes } from "./src/theme/recipes";
import { tokens } from "./src/theme/tokens";

export default defineConfig({
  preflight: true,
  include: ["./src/**/*.{ts,tsx}", "./tests/**/*.{ts,tsx}"],
  exclude: [],
  outdir: "styled-system",
  jsxFramework: "react",
  theme: {
    extend: {
      tokens,
      recipes,
    },
  },
});
