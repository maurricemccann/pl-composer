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
        {/* Settings and the handbook, the PL Paint way: one quiet button each, bottom-right; the panel is the Design Kit's own. */}
        <div id="pl-corner" style={{ position: "fixed", right: 12, bottom: 12, zIndex: 40, display: "flex", gap: 6 }}>
          <a href="/handbook/index.html" target="_blank" rel="noreferrer" className="psybutton" title="The handbook (F1)" style={{ padding: "4px 10px", fontSize: 11 }}>Handbook</a>
          <button id="pl-settings-btn" className="psybutton" title="Settings" style={{ padding: "4px 10px", fontSize: 11 }}>Settings</button>
        </div>
        <div id="pl-settings-panel" className="psyglass psyglass--sheet" hidden style={{ position: "fixed", right: 12, bottom: 48, zIndex: 40, width: 360, maxHeight: "70vh", overflow: "auto", padding: 12 }}>
          <div id="psysettings" />
        </div>
        <script src="/psyglass.js" />
        <script dangerouslySetInnerHTML={{ __html: `window.addEventListener('DOMContentLoaded',()=>{if(window.psyglass)psyglass.auto(${GLASS_MAP});
const p=document.getElementById('pl-settings-panel'),b=document.getElementById('pl-settings-btn');
b.onclick=()=>{p.hidden=!p.hidden;if(!p.hidden&&window.psysettings&&!document.getElementById('psysettings').childElementCount)psysettings.mount(document.getElementById('psysettings'),{handFont:'/fonts/PL-Hand-V2.ttf',notifications:[]});};
addEventListener('keydown',e=>{if(e.key==='F1'){e.preventDefault();window.open('/handbook/index.html','_blank');}});});` }} />
      </body>
    </html>
  );
}
