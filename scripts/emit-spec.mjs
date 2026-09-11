/**
 * Emit a spec from a saved piece, using the board's OWN emitter.
 *
 * The board is the composer and the browser is where a piece gets scored — but for a
 * long piece, scraping 5,000 characters of markdown out of the DOM to hand to the CLI
 * is a transcription risk with no upside. This runs `lib/emit.ts` directly against the
 * same piece JSON and the same manifest, so the artifact is byte-identical to what the
 * Build spec button produces.
 *
 *   node scripts/emit-spec.mjs piece.json ../OpenMontage/projects/pl-curves/manifest.json out.spec.md
 *
 * This is a convenience for driving the renderer, not a second source of truth: it
 * imports the emitter rather than reimplementing it, so the two cannot drift.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { emitSpec } from "../lib/emit.ts";

const [, , piecePath, manifestPath, outPath] = process.argv;
if (!piecePath || !manifestPath || !outPath) {
  console.error("usage: node scripts/emit-spec.mjs <piece.json> <manifest.json> <out.spec.md>");
  process.exit(1);
}

const piece = JSON.parse(readFileSync(piecePath, "utf8"));
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));

const missing = piece.shots.flatMap((s) => s.sourceIds).filter(
  (id) => !manifest.assets.some((a) => a.id === id),
);
if (missing.length) {
  console.error("these ids are not in the manifest: " + [...new Set(missing)].join(", "));
  process.exit(1);
}

const md = emitSpec(piece, manifest.assets);
writeFileSync(outPath, md, "utf8");
console.log(`${piece.piece}: ${piece.shots.length} shots, ${md.length} chars -> ${outPath}`);
