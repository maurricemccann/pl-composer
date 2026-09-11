/**
 * The one check this layer has to pass: a graph survives the round trip.
 *
 *   deriveGraph ──▶ canvas ──▶ toGraphNodes  ===  deriveGraph
 *
 * If that holds, the canvas is a new way to AUTHOR the contract step 3 proved
 * against a real CLI render — not a second, diverging format. If it ever breaks,
 * a shot will render differently after being opened than before, which is the
 * worst class of bug this surface could have: silent, and only visible downstream.
 *
 * Run:  node lib/graph.test.ts      (node 24 strips the types itself — no dep)
 */

import assert from "node:assert/strict";
import type { Asset, Piece, Shot } from "./types.ts";
import { DEFAULT_PIECE } from "./types.ts";
import { deriveGraph, emitSpec } from "./emit.ts";
import { fromGraphNodes, toGraphNodes, canConnect } from "./graph.ts";

function asset(id: string, kind: Asset["kind"], name: string): Asset {
  return {
    id, kind, name, catalog: "test", path: `X:/${name}`, ext: ".x",
    bytes: 1, mtime: 0, width: null, height: null, duration: null,
    tags: [], thumb_url: null,
  };
}

const ASSETS: Asset[] = [
  asset("img_1183", "media", "chrome-seal-22"),
  asset("crv_0142", "curve", "ribbon-fold-3"),
  asset("aud_0007", "audio", "atelier-pad-01"),
  asset("mdl_0031", "model", "glyph-guy"),
];
const byId = new Map(ASSETS.map((a) => [a.id, a]));

/** Key-order-insensitive deep compare — arg order is style, not contract. */
const norm = (v: unknown): unknown =>
  Array.isArray(v) ? v.map(norm)
  : v && typeof v === "object"
    ? Object.fromEntries(Object.entries(v as object).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, norm(x)]))
    : v;

function shot(sourceIds: string[]): Shot {
  return { id: "shot_01", title: "t", duration: 4, sourceIds };
}

function roundTrip(sourceIds: string[], label: string) {
  const s = shot(sourceIds);
  const derived = deriveGraph(s, byId);
  const { nodes, edges } = fromGraphNodes(derived, s.sourceIds, byId);
  const back = toGraphNodes(nodes, edges);
  assert.deepEqual(norm(back), norm(derived), `${label}: graph changed across the round trip`);
  console.log(`  ok  ${label}  (${derived.length} ops, ${nodes.length} nodes, ${edges.length} edges)`);
}

console.log("round trip — derived wiring survives the canvas");
roundTrip([], "empty shot");
roundTrip(["img_1183"], "one media");
roundTrip(["img_1183", "crv_0142"], "media + curve");
roundTrip(["img_1183", "crv_0142", "aud_0007"], "audio drives opacity");
roundTrip(["mdl_0031"], "model alone (render stage is explicit)");
roundTrip(["img_1183", "crv_0142", "aud_0007", "mdl_0031"], "everything at once");

// The render stage must never be skipped: a Model may not be used as pixels.
{
  const s = shot(["img_1183", "mdl_0031"]);
  const g = deriveGraph(s, byId);
  const layer = g.find((n) => n.op === "layer")!;
  assert.equal(layer.args.overlay, "m_mdl_0031", "a model must reach a layer through blender_render");
  console.log("  ok  model reaches a layer only as rendered media");
}

console.log("connect validation — the load-bearing rule (§5)");
{
  const s = shot(["img_1183", "crv_0142", "aud_0007", "mdl_0031"]);
  const { nodes, edges } = fromGraphNodes(deriveGraph(s, byId), s.sourceIds, byId);
  const find = (kind: string) => nodes.find((n) => n.data.kind === kind)!;
  const src = (aid: string) => nodes.find((n) => n.data.assetId === aid)!;

  const bad = canConnect(
    { source: src("aud_0007").id, target: find("layer").id, targetHandle: "base" },
    nodes, edges, byId,
  );
  assert.equal(bad.ok, false, "Audio must not connect to a Media port");

  const taken = canConnect(
    { source: src("img_1183").id, target: find("layer").id, targetHandle: "base" },
    nodes, edges, byId,
  );
  assert.equal(taken.ok, false, "an occupied single port must refuse a second edge");

  const cycle = canConnect(
    { source: find("layer").id, target: find("envelope_extract").id, targetHandle: "audio" },
    nodes, edges, byId,
  );
  assert.equal(cycle.ok, false, "a cycle has no emission order and must be refused");

  const good = canConnect(
    { source: src("crv_0142").id, target: find("shot").id, targetHandle: "layers" },
    nodes, edges, byId,
  );
  assert.equal(good.ok, false, "a Curve is not a Shot");
  console.log("  ok  wrong type, occupied port, and cycle all refused");
}

/**
 * The other half of the round trip: an edit made on the canvas has to reach the
 * markdown. The N-panel writes straight into `node.data.args`, so asserting that a
 * changed arg survives toGraphNodes → emitSpec covers the whole authoring path in
 * one check — and keeps covering it, which a one-off click in a browser does not.
 */
console.log("canvas edits reach the emitted spec");
{
  const s = shot(["img_1183", "crv_0142", "aud_0007"]);
  const { nodes, edges } = fromGraphNodes(deriveGraph(s, byId), s.sourceIds, byId);

  const layer = nodes.find((n) => n.data.kind === "layer")!;
  assert.equal(layer.data.args.blend, "screen", "the derived default is screen");
  layer.data.args = { ...layer.data.args, blend: "multiply", opacity: 0.42 };

  const piece: Piece = { ...DEFAULT_PIECE, shots: [{ ...s, nodes: toGraphNodes(nodes, edges) }] };
  const md = emitSpec(piece, ASSETS);

  assert.match(md, /blend: multiply/, "a blend changed on the canvas must reach the spec");
  assert.match(md, /opacity: 0\.42/, "a numeric param changed on the canvas must reach the spec");
  assert.match(md, /bind: \{ opacity: v_opacity \}/, "the audio binding must survive the edit");
  console.log("  ok  blend, opacity and the audio bind all land in the markdown");
}

console.log("\nall checks passed");
