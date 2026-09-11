/**
 * The Composer type system — spec §5.
 *
 * This is the load-bearing part. Edges are typed and strictly validated; get the
 * types right and the spec emission writes itself. Everything here describes
 * INTENT. Nothing in this file computes pixels — the CLI evaluates.
 */

/**
 * The socket types. Order matters only for display.
 *
 * `Model` is the seventh, added S263 on the founder's ruling ("nothing left out, I
 * want us to be able to use everything") after phase 1 shipped with 153 indexed
 * .blend files that no socket could accept. It is deliberately NOT interchangeable
 * with Media: geometry has to be rendered before it is pixels, and the `BlenderRender`
 * deriver is the only edge out of it. That keeps the spec honest about which stage
 * produced what — the same separation that makes Curve distinct from Media.
 */
export const SOCKET_TYPES = ["Media", "Curve", "Audio", "Value", "Model", "Shot", "Spec"] as const;
export type SocketType = (typeof SOCKET_TYPES)[number];

/**
 * What each socket carries, and the one-line reason it exists as its own type.
 * Kept as data rather than comments so the UI can show it on hover instead of the
 * founder having to remember six rules.
 */
export const SOCKET_META: Record<SocketType, { carries: string; why: string }> = {
  Media: { carries: "File-backed pixels", why: "Stills and video. Baked." },
  Curve: {
    carries: "A curves-library element",
    why: "Parametric, not baked — it can be driven. That is why it is not Media.",
  },
  Audio: { carries: "A track", why: "The only source that produces motion from nothing." },
  Value: {
    carries: "A number, constant or time-varying",
    why: "An envelope, a slider and an LFO are all Value. Envelope is a flavour, not a type.",
  },
  Model: {
    carries: "Geometry — a .blend, .glb, .fbx",
    why: "Not pixels yet. Render it to get Media; that stage is never implicit.",
  },
  Shot: { carries: "What a card resolves to", why: "Exactly one per card." },
  Spec: { carries: "Terminal", why: "The markdown." },
};

/**
 * Socket colours. The graph canvas is the one place the spec allows boldness to be
 * spent (§11), and typed sockets being colour-coded is what makes a dense graph
 * readable at a glance. Values are pl-os palette tokens, not new invented hues.
 */
export const SOCKET_COLOR: Record<SocketType, string> = {
  Media: "#c9a84c", // gold — the house accent, for the most common source
  Curve: "#9b72cf", // philosophy violet — the parametric one
  Audio: "#2d8a6e", // process green — the one that generates motion
  Value: "#5f93a3", // info slate — numbers, deliberately the quietest
  Model: "#b07d2a", // warn amber — geometry, one render away from being usable
  Shot: "#c0392b", // proof red — a resolved shot is an assertion
  Spec: "#1a1510", // ink — terminal
};

/* ─────────────────────────── assets (read-only) ─────────────────────────── */

/**
 * One row of the CLI-produced manifest. The board reads this and never writes it.
 * `kind` is lowercase here because it is the CLI's vocabulary, not the socket
 * vocabulary — `assetSocket()` below is the single place they are mapped.
 */
export type AssetKind = "media" | "audio" | "curve" | "model";

export interface Asset {
  id: string;
  kind: AssetKind;
  name: string;
  catalog: string;
  path: string;
  ext: string;
  bytes: number;
  mtime: number;
  width: number | null;
  height: number | null;
  duration: number | null;
  tags: string[];
  thumb_url: string | null;
}

export interface ManifestRoot {
  catalog: string;
  path: string;
  present: boolean;
  count: number;
  reason: string | null;
}

export interface Manifest {
  manifest_version: number;
  generated: string;
  probed: boolean;
  roots: ManifestRoot[];
  counts: { total: number; by_kind: Record<string, number> };
  assets: Asset[];
}

/** Which socket an asset plugs into. Every indexed kind now has one (S263). */
export function assetSocket(kind: AssetKind): SocketType {
  switch (kind) {
    case "media": return "Media";
    case "curve": return "Curve";
    case "audio": return "Audio";
    case "model": return "Model";
  }
}

/* ─────────────────────────── the piece ─────────────────────────── */

/**
 * How a shot enters — it crossfades out of the shot before it (S264).
 *
 * `cut` is the default and the honest one: most boundaries in this house want
 * nothing. The rest exist because a cut between two stills reads as a jolt where a
 * cut between two moving clips reads as an edit.
 *
 * Deliberately six words, not ffmpeg's fifty. Nearly all of the rest are gimmicks
 * that would read as somebody else's brand. `dissolve` maps to ffmpeg's `fade`, not
 * its `dissolve` — that one is a noisy random-pixel effect, which is not what the
 * word means to anyone.
 */
export const TRANSITIONS = ["cut", "dissolve", "black", "white", "wipe", "slide"] as const;
export type Transition = (typeof TRANSITIONS)[number];

/** What each one does, for the picker — nobody should have to render to find out. */
export const TRANSITION_WHY: Record<Transition, string> = {
  cut: "Nothing. The next shot is simply there.",
  dissolve: "One picture becomes the other.",
  black: "Out through black, then in. The longest pause.",
  white: "Out through white. Louder than black — use it once.",
  wipe: "The next shot pushes up over this one.",
  slide: "Both move together, upward.",
};

/** The house default when a piece asks for transitions without saying how long. */
export const TRANSITION_SECONDS = 0.4;

export interface Piece {
  piece: string;
  target: string;
  fps: number;
  resolution: string;
  /** Piece-wide default every shot inherits unless it overrides. Absent = all cuts. */
  transition?: string;
  shots: Shot[];
}

/**
 * One operation in a shot's graph. Lives here rather than in emit.ts so a Shot can
 * carry its own graph without the type system importing the serialiser.
 */
export interface GraphNode {
  op: "envelope_extract" | "remap" | "constant" | "blender_render" | "layer" | "matte";
  /** Node-local value identifier this node produces, e.g. "v_energy". */
  out?: string;
  args: Record<string, unknown>;
}

export interface Shot {
  id: string;
  title: string;
  duration: number;
  /** How this shot ENTERS — `dissolve 0.5`, `black`, `cut`. Shot 01's is ignored:
   *  it has nothing to come from, and a fade in from black is a different decision
   *  that should be asked for, not inferred. Absent = inherit the piece's. */
  transition?: string;
  /** Asset ids this shot draws on. The graph is what wires them; this is the summary
   *  the spine card and the phone read-only view render without touching graph state. */
  sourceIds: string[];
  /** Set once the graph canvas exists (build order step 4). While it is absent the
   *  emitter derives a real default wiring from the sources — not a placeholder. */
  nodes?: GraphNode[];
}

export const DEFAULT_PIECE: Piece = {
  piece: "untitled-piece",
  target: "remotion → openmontage",
  fps: 30,
  resolution: "1080x1920",
  shots: [],
};

/** Total runtime. The spine header shows this; the emitted spec records it. */
export function pieceDuration(p: Piece): number {
  return p.shots.reduce((n, s) => n + s.duration, 0);
}
