import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "PL Composer",
  description: "Scoring surface for PL video. Composes a piece, emits a spec — the CLI renders.",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "Composer", statusBarStyle: "black-translucent" },
  icons: { icon: "/icons/icon-192.png", apple: "/icons/apple-touch-icon.png" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#0e0c09",
};

// S342 (his ruling: Composer gets the PL Paint treatment): psyglass + the shared Settings panel from the Design Kit, synced into
// public/ by pl-design-kit/sync.py. settings.js runs in the head so the saved theme applies before first paint; glass.js dresses the
// header, the asset browser and the spec sheet with the house glass once the page exists.
const GLASS_MAP = JSON.stringify({ "header": "psyglass psyglass--bar", "aside": "psyglass psyglass--card", "main > section, .card, .sheet": "psyglass psyglass--card", "button": "psybutton", "select": "psysegment", "input[type=range]": "psyslide" });

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-psyapp="composer">
      <head>
        <script src="/psysettings.js" />
        <link rel="stylesheet" href="/psyglass.css" />
      </head>
      <body>
        {children}
        <div id="psysettings" />
        <script src="/psyglass.js" />
        <script dangerouslySetInnerHTML={{ __html: `window.addEventListener('DOMContentLoaded',()=>{if(window.psyglass)psyglass.auto(${GLASS_MAP});});` }} />
      </body>
    </html>
  );
}
