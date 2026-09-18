/**
 * Carry the founder's curve-library verdicts into PL Composer's own asset manifest.
 *
 * The composer does NOT read the curve library — it reads its own index
 * (OpenMontage/projects/pl-curves/manifest.json, 5,703 assets) produced by
 * asset_index.py. But 158 of those assets point straight into
 * pl-curves-gallery/public/, so a piece he cut in /curate was still being offered
 * here. This removes exactly those.
 *
 *   node scripts/apply-gallery-cuts.mjs [--dry]
 *
 * Re-run after asset_index.py regenerates the manifest — regeneration undoes this by
 * design, because the manifest is generated and this is a filter over it, not a source.
 * A .bak is written every run, so a bad filter is one copy away from undone.
 *
 * Founder ruling S282·c4d9. Matching is by filename STEM: the manifest stores
 * "pl-ambient-loop-v1", the library index stores "pl-ambient-loop-v1.mp4".
 */
import { readFileSync, writeFileSync, copyFileSync, existsSync } from 'node:fs';

const MANIFEST = process.env.PL_COMPOSER_MANIFEST
  || String.raw`C:\dev\OpenMontage\projects\pl-curves\manifest.json`;
const GALLERY = 'https://pl-curve-library.psychedluxuries.workers.dev';
const DRY = process.argv.includes('--dry');

if (!existsSync(MANIFEST)) throw new Error(`manifest not found: ${MANIFEST}`);

const [taste, index] = await Promise.all([
  fetch(`${GALLERY}/api/taste`).then(r => r.json()),
  fetch(`${GALLERY}/library-index.json`).then(r => r.json()),
]);

const marks = taste?.marks ?? {};
if (!Object.keys(marks).length) throw new Error('no taste marks returned — refusing to filter the manifest');

const rows = Array.isArray(index) ? index : (index.items ?? []);
if (!rows.length) throw new Error('library index empty — refusing to filter');

const stem = (s) => String(s || '').replace(/\.[^./\\]+$/, '').toLowerCase();
const cutStems = new Set(
  rows.filter(r => marks[r.vault_id]?.v === 'cut' && r.name).map(r => stem(r.name))
);
console.log(`gallery cuts: ${cutStems.size} distinct names`);

const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
const assets = manifest.assets ?? [];
const before = assets.length;

// Only touch assets that actually live in the gallery's public tree. The 3D, vault and
// photo catalogues were never curated and must not be filtered by a name collision.
const kept = assets.filter(a => {
  const inGallery = String(a.path || '').includes('pl-curves-gallery');
  return !(inGallery && cutStems.has(stem(a.name)));
});
const removed = before - kept.length;

console.log(`manifest assets: ${before} -> ${kept.length}  (removed ${removed})`);
if (removed === 0) console.log('nothing matched — either already filtered, or no cut asset is shared');

if (DRY) { console.log('--dry: nothing written'); process.exit(0); }

copyFileSync(MANIFEST, MANIFEST + '.bak');
manifest.assets = kept;
manifest.counts = { ...(manifest.counts || {}), assets: kept.length };
manifest.gallery_cuts_applied = { at: new Date().toISOString(), removed, source: 'S282·c4d9' };
writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2));
console.log(`wrote manifest (backup at ${MANIFEST}.bak)`);
