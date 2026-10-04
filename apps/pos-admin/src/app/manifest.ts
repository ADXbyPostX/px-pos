import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "PX POS",
    short_name: "PX POS",
    description: "PostX point of sale — back office",
    start_url: "/",
    display: "standalone",
    background_color: "#000000",
    theme_color: "#000000",
    icons: [
      { src: "/brand/favicon/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/brand/favicon/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  };
}
