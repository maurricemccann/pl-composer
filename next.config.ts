import type { NextConfig } from "next";
import { execSync } from "node:child_process";

let buildId = "unknown";
try { buildId = execSync("git rev-parse --short HEAD").toString().trim(); } catch {}

// Same security baseline as pl-os, narrowed to what this surface actually calls.
// The Composer talks to nothing but itself and the manifest endpoint; there are no
// third-party iframes here (pl-os needs frame-src for curve-library previews, this
// does not), so frame-src stays 'none' rather than being copied across unexamined.
// 'unsafe-inline' on script/style is Next's inline hydration payload, same as pl-os.
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data: https:",
  "connect-src 'self' https://*.psychedluxuries.com",
  "frame-src 'none'",
  "worker-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "frame-ancestors 'none'",
].join("; ");

const SECURITY_HEADERS = [
  { key: "Content-Security-Policy", value: CSP },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Strict-Transport-Security", value: "max-age=31536000" },
];

const nextConfig: NextConfig = {
  env: { NEXT_PUBLIC_BUILD_ID: buildId },
  async headers() {
    return [{ source: "/(.*)", headers: SECURITY_HEADERS }];
  },
};

export default nextConfig;
