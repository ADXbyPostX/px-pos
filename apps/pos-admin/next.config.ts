import type { NextConfig } from "next";
import pkg from "./package.json";

const isDev = process.env.NODE_ENV === "development";
// Dev only: local Firebase emulators (see src/lib/firebase/client.ts).
const emu = process.env.NEXT_PUBLIC_FIREBASE_EMULATOR_HOST;
const emuFirestorePort = process.env.NEXT_PUBLIC_FIRESTORE_EMULATOR_PORT || "8080";

/**
 * Content Security Policy without nonces (pages stay static). The admin only talks to
 * Firebase (Auth + Firestore on *.googleapis.com); item photos are data: URIs; fonts are
 * self-hosted by next/font. The auth domain may be framed by Firebase Auth's helpers.
 */
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' blob: data:",
  "font-src 'self'",
  `connect-src 'self' https://*.googleapis.com https://*.firebaseio.com wss://*.firebaseio.com${emu ? ` http://${emu}:${emuFirestorePort} http://${emu}:9099` : ""}`,
  "frame-src https://*.firebaseapp.com",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "upgrade-insecure-requests",
].join("; ");

const nextConfig: NextConfig = {
  // Shown in the sidebar footer; bump `version` in package.json for each release.
  env: { NEXT_PUBLIC_APP_VERSION: pkg.version },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "Content-Security-Policy", value: csp },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
        ],
      },
    ];
  },
};

export default nextConfig;
