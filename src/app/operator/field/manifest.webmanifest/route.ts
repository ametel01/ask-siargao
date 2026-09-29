export function GET() {
  return Response.json(
    {
      background_color: "#fafaf9",
      description: "Protected offline fieldwork for authorized Ask Siargao Field Researchers.",
      display: "standalone",
      icons: [
        { sizes: "192x192", src: "/web-app-manifest-192x192.png", type: "image/png" },
        { sizes: "512x512", src: "/web-app-manifest-512x512.png", type: "image/png" },
      ],
      id: "/operator/field/",
      name: "Ask Siargao Field Workspace",
      scope: "/operator/field/",
      short_name: "Field Workspace",
      start_url: "/operator/field/offline-shell",
      theme_color: "#14532d",
    },
    {
      headers: {
        "cache-control": "private, no-store",
        "content-type": "application/manifest+json",
      },
    },
  );
}
