/**
 * Spec emission — the deliverable (spec §9).
 *
 * The markdown IS the product. The board composes; this writes the instruction;
 * the CLI (`OpenMontage/projects/pl-curves/compose_render.py`) reads it and renders.
 * Nothing here computes pixels, and nothing here reaches for ffmpeg.
 *
 * Build order puts emission (step 3) BEFORE the graph canvas (step 4) on purpose:
 * the output contract has to be proven against a real CLI run before anything is
 * built on top of it. So until the canvas exists, a shot's graph is DERIVED from the
 * assets attached to it — a real default wiring, not a placeholder — and a shot that
 * later carries an explicit `nodes` array uses that instead. Same emitter, both ways.
 */

import type { Asset, GraphNode, Piece, Shot } from "./types.ts";

export type { GraphNode };

/* ─────────────────────────── default wiring ─────────────────────────── */

/**
 * Derive a real graph from what is attached to a shot.
 *
 * The rules are the ones S262 actually proved on this machine, not invented here:
 *
 *  - The FIRST media asset is the base. Everything after it is an overlay.
 *  - Overlays blend `screen`. That session's load-bearing finding was that the curve
 *    library is glowing linework on black, and screen drops black to nothing — so a
 *    large class of composites needs no matting at all.
 *  - A model is rendered to media FIRST (blender_render), then treated as any other
 *    layer. The render stage is never implicit.
 *  - Audio drives. If a track is attached, its low-band envelope is extracted and
 *    remapped to overlay opacity — the same "audio drives the motion" principle the
 *    existing curve pipeline already uses in flow_zoom.py, applied to compositing.
 */
export function deriveGraph(shot: Shot, byId: Map<string, Asset>): GraphNode[] {
  const assets = shot.sourceIds.map((id) => byId.get(id)).filter(Boolean) as Asset[];
  const nodes: GraphNode[] = [];

  const models = assets.filter((a) => a.kind === "model");
  const audio = assets.filter((a) => a.kind === "audio");
  // A rendered model becomes a media layer, ordered after the real media so a
  // reconstruction sits over its own source footage rather than under it.
  const media = [
    ...assets.filter((a) => a.kind === "media" || a.kind === "curve"),
    ...models,
  ];

  for (const m of models) {
    nodes.push({
      op: "blender_render",
      out: `m_${m.id}`,
      args: { source: m.id, fps: "@piece.fps", resolution: "@piece.resolution" },
    });
  }

  let bind: Record<string, string> | null = null;
  if (audio.length > 0) {
    const a = audio[0];
    nodes.push({
      op: "envelope_extract",
      out: "v_energy",
      args: { source: a.id, band: "low", smooth: 0.3, gain: 1.0 },
    });
    nodes.push({
      op: "remap",
      out: "v_opacity",
      args: { source: "v_energy", in: [0.0, 1.0], out: [0.35, 1.0], ease: "linear" },
    });
    bind = { opacity: "v_opacity" };
  }

  if (media.length > 0) {
    const base = media[0];
    const baseRef = base.kind === "model" ? `m_${base.id}` : base.id;
    for (const ov of media.slice(1)) {
      nodes.push({
        op: "layer",
        args: {
          base: baseRef,
          overlay: ov.kind === "model" ? `m_${ov.id}` : ov.id,
          blend: "screen",
          opacity: 1.0,
          ...(bind ? { bind } : {}),
        },
      });
    }
    if (media.length === 1) {
      // A single source is still a layer — one base, no overlay. Emitting it keeps
      // every shot the same shape for the CLI instead of a special case.
      //
      // `blend` here has no overlay to act on — the CLI's `layer` op only calls
      // `composite()` when `overlay` is set, so this value renders as pure `base_clip`
      // either way. But it is not harmless: `normal` is compose_render.py's own
      // documented broken mode (a transparent region becomes opaque black), and this
      // is dead data only until someone drags a second source onto the shot, at which
      // point it becomes live and wrong. `screen` matches what every other derived
      // default already uses (S263 use-notes §1.2).
      nodes.push({
        op: "layer",
        args: { base: baseRef, blend: "screen", opacity: 1.0, ...(bind ? { bind } : {}) },
      });
    }
  }

  return nodes;
}

/* ─────────────────────────── serialisation ─────────────────────────── */

function val(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map((x) => (typeof x === "number" ? x.toFixed(2) : String(x))).join(", ")}]`;
  if (v && typeof v === "object") {
    const inner = Object.entries(v as Record<string, unknown>)
      .map(([k, x]) => `${k}: ${val(x)}`)
      .join(", ");
    return `{ ${inner} }`;
  }
  return String(v);
}

function nodeLines(n: GraphNode, byId: Map<string, Asset>): string[] {
  const name = (id: unknown) => {
    const a = byId.get(String(id));
    return a ? `   # ${a.name}` : "";
  };

  if (n.op === "envelope_extract") {
    const src = n.args.source;
    const out: string[] = [`  - envelope_extract: ${src} -> ${n.out}${name(src)}`];
    for (const k of ["band", "smooth", "gain"]) out.push(`      ${k}: ${val(n.args[k])}`);
    return out;
  }
  if (n.op === "remap") {
    return [
      `  - remap: ${n.args.source} -> ${n.out}`,
      `      in: ${val(n.args.in)}`,
      `      out: ${val(n.args.out)}`,
      `      ease: ${val(n.args.ease)}`,
    ];
  }
  if (n.op === "constant") {
    return [`  - constant: -> ${n.out}`, `      value: ${val(n.args.value)}`];
  }
  if (n.op === "blender_render") {
    const src = n.args.source;
    return [
      `  - blender_render: ${src} -> ${n.out}${name(src)}`,
      `      fps: ${val(n.args.fps)}`,
      `      resolution: ${val(n.args.resolution)}`,
    ];
  }
  if (n.op === "matte") {
    // Not a blend: the base is seen only INSIDE the shape's marks. No blend mode can
    // express that, which is why it is its own op rather than a layer variant.
    const out: string[] = ["  - matte:"];
    out.push(`      base: ${n.args.base}${name(n.args.base)}`);
    out.push(`      shape: ${n.args.shape}${name(n.args.shape)}`);
    for (const k of ["invert", "threshold", "feather", "ground"]) {
      if (n.args[k] !== undefined && n.args[k] !== null && n.args[k] !== "") {
        out.push(`      ${k}: ${val(n.args[k])}`);
      }
    }
    return out;
  }

  // layer
  const out: string[] = ["  - layer:"];
  out.push(`      base: ${n.args.base}${name(n.args.base)}`);
  if (n.args.overlay) out.push(`      overlay: ${n.args.overlay}${name(n.args.overlay)}`);
  if (n.args.bind) out.push(`      bind: ${val(n.args.bind)}`);
  out.push(`      blend: ${val(n.args.blend)}`);
  out.push(`      opacity: ${val(n.args.opacity)}`);
  return out;
}

/** ISO-ish local stamp, e.g. "2026-09-10 17:42 PT". The house writes PT. */
function stamp(now = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())} ${p(now.getHours())}:${p(now.getMinutes())} PT`;
}

/**
 * The whole spec. Shot order in the file is shot order in the piece — that ordering
 * is the contract, not a convenience, so nothing here sorts.
 */
export function emitSpec(piece: Piece, assets: Asset[], now = new Date()): string {
  const byId = new Map(assets.map((a) => [a.id, a]));
  const total = piece.shots.reduce((n, s) => n + s.duration, 0);

  const out: string[] = [
    "---",
    "spec_version: 1",
    `piece: ${piece.piece}`,
    `created: ${stamp(now)}`,
    `target: ${piece.target}`,
    `fps: ${piece.fps}`,
    `resolution: ${piece.resolution}`,
    // Omitted entirely when unset, so a cuts-only piece emits the byte-identical
    // spec it always did and takes the renderer's stream-copy join (S264).
    ...(piece.transition ? [`transition: ${piece.transition}`] : []),
    `duration: ${total.toFixed(1)}`,
    "---",
    "",
  ];

  piece.shots.forEach((shot, i) => {
    const n = String(i + 1).padStart(2, "0");
    out.push(`## Shot ${n} — ${shot.title}`);
    out.push(`duration: ${shot.duration.toFixed(1)}`);
    // Shot 01 has nothing to come from, so its transition is never written — the
    // renderer ignores it anyway, and emitting it would read as a fade from black
    // that will not happen.
    if (shot.transition && i > 0) out.push(`transition: ${shot.transition}`);

    const resolved = shot.sourceIds.map((id) => byId.get(id)).filter(Boolean) as Asset[];
    if (resolved.length === 0) {
      // Say it out loud in the artifact. A shot with no sources renders as black,
      // and the spec is the only place that fact can be noticed before the render.
      out.push("sources: []   # no sources attached — this shot renders black");
    } else {
      out.push("sources:");
      for (const a of resolved) out.push(`  - ${a.kind}: ${a.id}   # ${a.name}${a.ext}`);
    }

    const graph = shot.nodes && shot.nodes.length > 0 ? shot.nodes : deriveGraph(shot, byId);
    if (graph.length > 0) {
      out.push("graph:");
      for (const node of graph) out.push(...nodeLines(node, byId));
    }

    out.push(`-> ${shot.id}`);
    out.push("");
  });

  return out.join("\n");
}
