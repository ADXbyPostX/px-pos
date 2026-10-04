import type { MetadataRoute } from "next";

/** A private back office: keep every page out of search engines. */
export default function robots(): MetadataRoute.Robots {
  return { rules: { userAgent: "*", disallow: "/" } };
}
