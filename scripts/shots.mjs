import { chromium } from 'playwright';

/**
 * shots.mjs — capture PL Composer screenshots for the handbook.
 *
 * Requires the Composer dev server running (npm run dev -- --webpack, port 3000).
 * Run from C:\dev\pl-headless (where playwright is installed):
 *   node C:\dev\pl-composer\scripts\shots.mjs
 *
 * Writes PNGs to C:\dev\pl-composer\public\handbook\shots\ and updates
 * C:\dev\pl-composer\public\handbook\shots.json with the mapping.
 */

const base = 'http://127.0.0.1:3000';

const shots = [
  ['/', 'composer-home'],
  ['/graph', 'composer-graph'],
  ['/library', 'composer-library'],
  ['/board', 'composer-board'],
  ['/settings', 'composer-settings'],
];

const SHOTS_DIR = 'C:/dev/pl-composer/public/handbook/shots';
const SHOTS_JSON = 'C:/dev/pl-composer/public/handbook/shots.json';

const browser = await chromium.launch();
const page = await browser.newPage();
await page.setViewportSize({ width: 1280, height: 720 });

const mapping = {};
for (const [route, name] of shots) {
  await page.goto(`${base}${route}`, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(2000);
  const path = `${SHOTS_DIR}/${name}.png`;
  await page.screenshot({ path, fullPage: true });
  mapping[name] = `handbook/shots/${name}.png`;
  console.log('shot', name);
}

await browser.close();

const fs = await import('fs');
fs.writeFileSync(SHOTS_JSON, JSON.stringify(mapping, null, 2));
console.log('wrote', SHOTS_JSON, Object.keys(mapping).length, 'shots');
