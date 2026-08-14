import { describe, expect, test } from "bun:test";

import manifest from "@/app/manifest";

describe("application icon metadata", () => {
  test("publishes an installable manifest with standard and maskable icons", () => {
    expect(manifest()).toMatchObject({
      name: "Ask Siargao",
      short_name: "Ask Siargao",
      start_url: "/",
      display: "standalone",
      background_color: "#05082a",
      theme_color: "#05082a",
      icons: [
        { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
        { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
        {
          src: "/icon-512.png",
          sizes: "512x512",
          type: "image/png",
          purpose: "maskable",
        },
      ],
    });
  });

  test("ships browser, Apple, and installable app icon files", async () => {
    for (const path of [
      new URL("./favicon.ico", import.meta.url),
      new URL("./apple-icon.png", import.meta.url),
      new URL("../../public/icon-192.png", import.meta.url),
      new URL("../../public/icon-512.png", import.meta.url),
    ]) {
      expect(await Bun.file(path).exists(), path.pathname).toBe(true);
    }
  });
});
