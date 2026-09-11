/**
 * The graph layer — spec §4 (Graph view), §5 (type system), §6 (node catalog).
 *
 * This file is the translation between two representations of the same thing:
 *
 *   canvas  ──toGraphNodes──▶  GraphNode[]  ──emit.ts──▶  the markdown spec
 *           ◀─fromGraphNodes─
 *
 * `GraphNode[]` is the contract step 3 already proved end to end against a real
 * CLI render. The canvas is a new way to author it, NOT a new format — so this
 * module round-trips rather than replacing anything. Opening a shot that has no
 * explicit graph seeds the canvas from `deriveGraph()`, which means the first
 * thing the founder sees is the real default wiring, laid out, editable.
 *
 * Nothing here computes pixels. Edges carry intent; the CLI evaluates (§5).
 */

import type { Asset, GraphNode, Shot, SocketType } from "./types.ts";
import { assetSocket } from "./types.ts";
import { deriveGraph } from "./emit.ts";

/* ─────────────────────────── the node catalog (§6) ─────────────────────────── */

export type NodeKind =
  | "source"
  | "blender_render"
  | "envelope_extract"
  | "remap"
  | "constant"
  | "layer"
  | "shot";

export interface PortSpec {
  id: string;
  label: string;
  /** Which socket types may land here. Strict — this is the validation (§5). */
  accepts: SocketType[];
  /** A port that takes many edges. Only the terminal has one. */
  multi?: boolean;
}

export interface ParamSpec {
  key: string;
  label: string;
  type: "number" | "select" | "range";
  options?: string[];
  min?: number;
  max?: number;
  step?: number;
}

export interface KindSpec {
  label: string;
  /** One line saying what it is for — shown in the params panel, not memorised. */
  why: string;
  inputs: PortSpec[];
  /** What this node's single output socket carries. `null` for the terminal. */
  output: SocketType | null;
  params: ParamSpec[];
  /** Rank orders emission when the dependency graph leaves a tie. Lower runs first. */
  rank: number;
}

const MEDIAISH: SocketType[] = ["Media", "Curve"];

export const KINDS: Record<NodeKind, KindSpec> = {
  source: {
    label: "Source",
    why: "A row of the library. The board reads the manifest and never writes it.",
    inputs: [],
    output: null, // resolved per-asset by assetSocket()
    params: [],
    rank: 0,
  },
  blender_render: {
    label: "Blender Render",
    why: "Geometry is not pixels yet. This is the stage that makes it Media, and it is never implicit.",
    inputs: [{ id: "model", label: "model", accepts: ["Model"] }],
    output: "Media",
    params: [],
    rank: 0,
  },
  envelope_extract: {
    label: "Envelope Extract",
    why: "Audio is the only source that produces motion from nothing. This is how it drives something.",
    inputs: [{ id: "audio", label: "audio", accepts: ["Audio"] }],
    output: "Value",
    params: [
      { key: "band", label: "band", type: "select", options: ["low", "mid", "high", "full"] },
      { key: "smooth", label: "smooth", type: "number", min: 0, max: 1, step: 0.05 },
      { key: "gain", label: "gain", type: "number", min: 0, max: 8, step: 0.1 },
    ],
    rank: 1,
  },
  remap: {
    label: "Remap",
    why: "Rescales a Value into the range a parameter actually wants.",
    inputs: [{ id: "value", label: "value", accepts: ["Value"] }],
    output: "Value",
    params: [
      { key: "in", label: "in", type: "range" },
      { key: "out", label: "out", type: "range" },
      { key: "ease", label: "ease", type: "select", options: ["linear", "ease-in", "ease-out", "ease-in-out"] },
    ],
    rank: 2,
  },
  constant: {
    label: "Constant",
    why: "A number with no source. A slider, an LFO and an envelope are all Value (§5).",
    inputs: [],
    output: "Value",
    params: [{ key: "value", label: "value", type: "number", step: 0.1 }],
    rank: 1,
  },
  layer: {
    label: "Layer",
    why: "Composites one source over another. Bind a Value to drive a parameter over time.",
    inputs: [
      { id: "base", label: "base", accepts: MEDIAISH },
      { id: "overlay", label: "overlay", accepts: MEDIAISH },
      { id: "opacity", label: "opacity", accepts: ["Value"] },
      { id: "width", label: "width", accepts: ["Value"] },
    ],
    output: "Shot",
    params: [
      {
        key: "blend",
        label: "blend",
        type: "select",
        // `screen` first because it is the default and the one the curve library was
        // built for — glowing linework on black needs no matting at all.
        options: ["screen", "add", "lighten", "normal", "overlay", "multiply"],
      },
      { key: "opacity", label: "opacity", type: "number", min: 0, max: 1, step: 0.05 },
    ],
    rank: 3,
  },
  shot: {
    label: "Shot",
    why: "What this card resolves to. Exactly one per card, and a graph can never contain another (§4).",
    inputs: [{ id: "layers", label: "layers", accepts: ["Shot"], multi: true }],
    output: null,
    params: [],
    rank: 4,
  },
};

/** Which params a freshly-dropped node starts with. Same values the derived wiring uses. */
export function defaultArgs(kind: NodeKind): Record<string, unknown> {
  switch (kind) {
    case "envelope_extract": return { band: "low", smooth: 0.3, gain: 1.0 };
    case "remap": return { in: [0.0, 1.0], out: [0.35, 1.0], ease: "linear" };
    case "constant": return { value: 1.0 };
    case "layer": return { blend: "screen", opacity: 1.0 };
    case "blender_render": return { fps: "@piece.fps", resolution: "@piece.resolution" };
    default: return {};
  }
}

/* ─────────────────────────── canvas node shape ─────────────────────────── */

/**
 * What rides on a React Flow node. Kept as a plain record (RF v12 requires an index
 * signature) but every field is real state that survives into the emitted spec.
 */
export interface GNodeData {
  kind: NodeKind;
  /** Sources only: which manifest row this is. */
  assetId?: string;
  /** The identifier this node's output is referred to by — `v_energy`, `m_blend_07`. */
  out?: string;
  args: Record<string, unknown>;
  [k: string]: unknown;
}

export interface GNode {
  id: string;
  type: "pl";
  position: { x: number; y: number };
  data: GNodeData;
}

export interface GEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
}

/** The socket type a node's output carries. Sources resolve through the manifest. */
export function outputType(data: GNodeData, byId: Map<string, Asset>): SocketType | null {
  if (data.kind === "source") {
    const a = data.assetId ? byId.get(data.assetId) : undefined;
    return a ? assetSocket(a.kind) : null;
  }
  return KINDS[data.kind].output;
}

/** How other nodes refer to this one's output inside the spec. */
function refOf(n: GNode): string {
  if (n.data.kind === "source") return n.data.assetId ?? n.id;
  return n.data.out ?? n.id;
}

/* ─────────────────────────── validation (§5) ─────────────────────────── */

/**
 * Strict typed connect. Three rules, all load-bearing:
 *   1. the source's socket type must be one the target port accepts,
 *   2. a non-multi port holds exactly one edge,
 *   3. no cycles — a cycle has no valid emission order, and the founder would only
 *      find out at render time.
 */
export function canConnect(
  conn: { source?: string | null; target?: string | null; sourceHandle?: string | null; targetHandle?: string | null },
  nodes: GNode[],
  edges: GEdge[],
  byId: Map<string, Asset>,
): { ok: boolean; reason?: string } {
  const src = nodes.find((n) => n.id === conn.source);
  const tgt = nodes.find((n) => n.id === conn.target);
  if (!src || !tgt) return { ok: false, reason: "unknown node" };
  if (src.id === tgt.id) return { ok: false, reason: "a node cannot feed itself" };

  const port = KINDS[tgt.data.kind].inputs.find((p) => p.id === conn.targetHandle);
  if (!port) return { ok: false, reason: "no such input" };

  const t = outputType(src.data, byId);
  if (!t) return { ok: false, reason: "this source is not in the current manifest" };
  if (!port.accepts.includes(t)) {
    return { ok: false, reason: `${port.label} takes ${port.accepts.join(" or ")}, not ${t}` };
  }
  if (!port.multi && edges.some((e) => e.target === tgt.id && e.targetHandle === port.id)) {
    return { ok: false, reason: `${port.label} already has a connection` };
  }
  if (reaches(tgt.id, src.id, edges)) return { ok: false, reason: "that would make a cycle" };
  return { ok: true };
}

/** Can `from` reach `to` by following edges forward? */
function reaches(from: string, to: string, edges: GEdge[]): boolean {
  const seen = new Set<string>();
  const stack = [from];
  while (stack.length) {
    const cur = stack.pop()!;
    if (cur === to) return true;
    if (seen.has(cur)) continue;
    seen.add(cur);
    for (const e of edges) if (e.source === cur) stack.push(e.target);
  }
  return false;
}

/* ─────────────────────────── canvas ▶ spec ─────────────────────────── */

/**
 * Serialise the canvas into the emitter's contract.
 *
 * Emission order is a topological sort (Kahn) with the catalog's `rank` breaking
 * ties, which reproduces the derived wiring's order exactly: renders, then the value
 * chain, then layers. Layers additionally tie-break on their position in the terminal's
 * input list, so composite order is the order they are wired — visible on each card.
 */
export function toGraphNodes(nodes: GNode[], edges: GEdge[]): GraphNode[] {
  const byNodeId = new Map(nodes.map((n) => [n.id, n]));

  /** ref carried by whatever is wired into `port` of `nodeId`. */
  const inputRef = (nodeId: string, port: string): string | undefined => {
    const e = edges.find((x) => x.target === nodeId && x.targetHandle === port);
    if (!e) return undefined;
    const up = byNodeId.get(e.source);
    return up ? refOf(up) : undefined;
  };

  // Layer composite order = the order layers are wired into the terminal.
  const terminal = nodes.find((n) => n.data.kind === "shot");
  const layerOrder = new Map<string, number>();
  if (terminal) {
    edges
      .filter((e) => e.target === terminal.id)
      .forEach((e, i) => layerOrder.set(e.source, i));
  }

  const tiebreak = (n: GNode, i: number) =>
    n.data.kind === "layer" ? (layerOrder.get(n.id) ?? 1e6) : i;

  // Kahn, lowest (rank, tiebreak) first.
  const indeg = new Map<string, number>(nodes.map((n) => [n.id, 0]));
  for (const e of edges) if (indeg.has(e.target)) indeg.set(e.target, indeg.get(e.target)! + 1);

  const idx = new Map(nodes.map((n, i) => [n.id, i]));
  const ready = nodes.filter((n) => indeg.get(n.id) === 0);
  const order: GNode[] = [];
  while (ready.length) {
    ready.sort((a, b) => {
      const ra = KINDS[a.data.kind].rank - KINDS[b.data.kind].rank;
      return ra !== 0 ? ra : tiebreak(a, idx.get(a.id)!) - tiebreak(b, idx.get(b.id)!);
    });
    const n = ready.shift()!;
    order.push(n);
    for (const e of edges) {
      if (e.source !== n.id) continue;
      const d = (indeg.get(e.target) ?? 1) - 1;
      indeg.set(e.target, d);
      if (d === 0) {
        const t = byNodeId.get(e.target);
        if (t) ready.push(t);
      }
    }
  }

  const out: GraphNode[] = [];
  for (const n of order) {
    const { kind, args } = n.data;
    if (kind === "source" || kind === "shot") continue;

    if (kind === "blender_render") {
      const source = inputRef(n.id, "model");
      if (!source) continue; // an unwired render has nothing to say; the card flags it
      out.push({ op: "blender_render", out: n.data.out, args: { source, ...args } });
    } else if (kind === "envelope_extract") {
      const source = inputRef(n.id, "audio");
      if (!source) continue;
      out.push({ op: "envelope_extract", out: n.data.out, args: { source, ...args } });
    } else if (kind === "remap") {
      const source = inputRef(n.id, "value");
      if (!source) continue;
      out.push({ op: "remap", out: n.data.out, args: { source, ...args } });
    } else if (kind === "constant") {
      out.push({ op: "constant", out: n.data.out, args: { ...args } });
    } else if (kind === "layer") {
      const base = inputRef(n.id, "base");
      if (!base) continue; // a layer with no base is not a layer yet
      const overlay = inputRef(n.id, "overlay");
      const bind: Record<string, string> = {};
      for (const k of ["opacity", "width"]) {
        const r = inputRef(n.id, k);
        if (r) bind[k] = r;
      }
      out.push({
        op: "layer",
        args: {
          base,
          ...(overlay ? { overlay } : {}),
          ...(Object.keys(bind).length ? { bind } : {}),
          ...args,
        },
      });
    }
  }
  return out;
}

/* ─────────────────────────── spec ▶ canvas ─────────────────────────── */

const COL = 240;
const ROW = 132;

/**
 * Rebuild the canvas from a graph.
 *
 * Used two ways and deliberately only written once: re-opening a shot that already
 * carries an explicit graph, and seeding a shot that does not from `deriveGraph()`.
 * Both are the same operation, so a seeded canvas is never a different shape from a
 * saved one.
 */
export function fromGraphNodes(
  graph: GraphNode[],
  sourceIds: string[],
  byId: Map<string, Asset>,
): { nodes: GNode[]; edges: GEdge[] } {
  const nodes: GNode[] = [];
  const edges: GEdge[] = [];
  /** ref (asset id or v_/m_ name) → the canvas node that produces it. */
  const producer = new Map<string, string>();
  let seq = 0;
  const nid = (k: string) => `${k}_${++seq}`;

  for (const aid of sourceIds) {
    const id = nid("src");
    nodes.push({ id, type: "pl", position: { x: 0, y: 0 }, data: { kind: "source", assetId: aid, args: {} } });
    producer.set(aid, id);
  }

  const link = (ref: unknown, target: string, port: string) => {
    const p = ref === undefined || ref === null ? undefined : producer.get(String(ref));
    if (!p) return;
    edges.push({ id: `e${edges.length}`, source: p, target, sourceHandle: "out", targetHandle: port });
  };

  const terminalId = nid("shot");
  const layerIds: string[] = [];

  for (const g of graph) {
    const { op, args } = g;
    const rest = { ...args };
    const id = nid(op);

    if (op === "blender_render") {
      delete rest.source;
      nodes.push({ id, type: "pl", position: { x: 0, y: 0 }, data: { kind: "blender_render", out: g.out, args: rest } });
      link(args.source, id, "model");
    } else if (op === "envelope_extract") {
      delete rest.source;
      nodes.push({ id, type: "pl", position: { x: 0, y: 0 }, data: { kind: "envelope_extract", out: g.out, args: rest } });
      link(args.source, id, "audio");
    } else if (op === "remap") {
      delete rest.source;
      nodes.push({ id, type: "pl", position: { x: 0, y: 0 }, data: { kind: "remap", out: g.out, args: rest } });
      link(args.source, id, "value");
    } else if (op === "constant") {
      nodes.push({ id, type: "pl", position: { x: 0, y: 0 }, data: { kind: "constant", out: g.out, args: rest } });
    } else if (op === "layer") {
      delete rest.base;
      delete rest.overlay;
      delete rest.bind;
      nodes.push({ id, type: "pl", position: { x: 0, y: 0 }, data: { kind: "layer", args: rest } });
      link(args.base, id, "base");
      link(args.overlay, id, "overlay");
      const bind = (args.bind ?? {}) as Record<string, unknown>;
      for (const k of ["opacity", "width"]) link(bind[k], id, k);
      layerIds.push(id);
    }
    if (g.out) producer.set(g.out, id);
  }

  nodes.push({ id: terminalId, type: "pl", position: { x: 0, y: 0 }, data: { kind: "shot", args: {} } });
  for (const l of layerIds) {
    edges.push({ id: `e${edges.length}`, source: l, target: terminalId, sourceHandle: "out", targetHandle: "layers" });
  }

  layout(nodes, edges);
  return { nodes, edges };
}

/**
 * Columns by dependency depth, rows by arrival. Deliberately not a dagre dependency —
 * this graph is a handful of nodes deep and the founder rearranges by hand anyway.
 */
function layout(nodes: GNode[], edges: GEdge[]) {
  const depth = new Map<string, number>();
  const inputs = (id: string) => edges.filter((e) => e.target === id).map((e) => e.source);

  const compute = (id: string, seen: Set<string>): number => {
    if (depth.has(id)) return depth.get(id)!;
    if (seen.has(id)) return 0;
    seen.add(id);
    const ups = inputs(id);
    const d = ups.length === 0 ? 0 : 1 + Math.max(...ups.map((u) => compute(u, seen)));
    depth.set(id, d);
    return d;
  };
  for (const n of nodes) compute(n.id, new Set());

  const rows = new Map<number, number>();
  for (const n of nodes) {
    const d = depth.get(n.id) ?? 0;
    const r = rows.get(d) ?? 0;
    rows.set(d, r + 1);
    n.position = { x: 40 + d * COL, y: 32 + r * ROW };
  }
}

/* ─────────────────────────── entry point ─────────────────────────── */

/** The canvas for a shot: its saved graph if it has one, the real default wiring if not. */
export function canvasFor(shot: Shot, byId: Map<string, Asset>) {
  const graph = shot.nodes && shot.nodes.length > 0 ? shot.nodes : deriveGraph(shot, byId);
  return fromGraphNodes(graph, shot.sourceIds, byId);
}

/** A fresh, unused `v_`/`m_` identifier. Names are for humans; uniqueness is for the CLI. */
export function nextOut(kind: NodeKind, nodes: GNode[], assetId?: string): string | undefined {
  if (kind === "layer" || kind === "source" || kind === "shot") return undefined;
  const base =
    kind === "blender_render" ? `m_${assetId ?? "render"}`
    : kind === "envelope_extract" ? "v_energy"
    : kind === "remap" ? "v_remap"
    : "v_const";
  const taken = new Set(nodes.map((n) => n.data.out).filter(Boolean) as string[]);
  if (!taken.has(base)) return base;
  for (let i = 2; ; i++) if (!taken.has(`${base}_${i}`)) return `${base}_${i}`;
}
