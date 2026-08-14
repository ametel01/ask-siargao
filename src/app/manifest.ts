import type { MetadataRoute } from "next";

const description =
  "Local Siargao travel advice for stays, routes, surf, weather, disruptions, and trip decisions.";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Ask Siargao",
    short_name: "Ask Siargao",
    description,
    start_url: "/",
    display: "standalone",
    background_color: "#05082a",
    theme_color: "#05082a",
    icons: [
      {
        src: "/icon-192.png",
        sizes: "192x192",
        type: "image/png",
      },
      {
        src: "/icon-512.png",
        sizes: "512x512",
        type: "image/png",
      },
      {
        src: "/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
