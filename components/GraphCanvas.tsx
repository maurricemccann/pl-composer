"use client";

/**
 * The graph canvas — build order step 4, catalog step 5.
 *
 * This is *how one shot gets made*. One graph per card, no nesting, no node groups
 * (§4) — that hard constraint is what keeps the spine honest and the phone view a
 * flat list, so there is deliberately no way to put a Shot inside a Shot here.
 *
 * Ground: the chrome stays pl-os cream; the canvas interior is a recessed ink well.
 * Founder ruling S263, settling the tension §11 left open — the assets composited in
 * here are additive-on-black (screen/add/lighten is the default wiring and what the
 * curve library was built for), so a cream canvas would make every thumbnail lie
 * about the render. The well is the palette's own ink token, not a new colour.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  Position,
  addEdge,
  useEdgesState,
  useNodesState,
  type Connection,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import { type Asset, type Shot, SOCKET_COLOR, SOCKET_META, assetSocket } from "@/lib/types";
import {
  KINDS,
  canConnect,
  canvasFor,
  defaultArgs,
  nextOut,
  outputType,
  toGraphNodes,
  type GEdge,
  type GNode,
  type GNodeData,
  type NodeKind,
} from "@/lib/graph";

type RFNode = Node<GNodeData>;

/* ─────────────────────────── the node ─────────────────────────── */

const W = 186;
const HEAD = 26;
const ROW = 21;

function PLNode({ id, data, selected }: NodeProps<RFNode>) {
  const { assets } = useCtx();
  const byId = assets.byId;
  const spec = KINDS[data.kind];
  const asset = data.assetId ? byId.get(data.assetId) : undefined;
  const outT = outputType(data, byId);
  const accent = outT ? SOCKET_COLOR[outT] : "#6b5d48";

  const title =
    data.kind === "source" ? (asset?.name ?? "missing asset") : spec.label;
  const sub =
    data.kind === "source"
      ? asset
        ? `${asset.catalog}${asset.ext}`
        : `${data.assetId} — not in this manifest`
      : data.out ?? summarise(data);

  return (
    <div
      style={{
        width: W,
        background: "var(--color-node)",
        border: `1px solid ${selected ? accent : "var(--color-node-line)"}`,
        boxShadow: selected ? `0 0 0 1px ${accent}55` : "none",
        borderRadius: 3,
      }}
    >
      <div
        className="flex items-center gap-1.5 px-2"
        style={{ height: HEAD, borderBottom: "1px solid var(--color-node-line)" }}
      >
        <span aria-hidden style={{ width: 6, height: 6, borderRadius: 9, background: accent, flexShrink: 0 }} />
        <span className="min-w-0 flex-1 truncate text-[11px]" style={{ color: "var(--color-node-text)" }} title={title}>
          {title}
        </span>
        {outT && (
          <span className="num text-[9px] uppercase tracking-wide" style={{ color: accent }}>
            {outT}
          </span>
        )}
      </div>

      {/* Inputs: one row per port, each carrying its own typed socket. The label is
          the affordance — a dense graph is unreadable if you have to remember which
          stub is which. */}
      {spec.inputs.map((p) => (
        <div key={p.id} className="relative flex items-center px-2" style={{ height: ROW }}>
          <Handle
            type="target"
            id={p.id}
            position={Position.Left}
            style={{
              left: -5,
              top: "50%",
              width: 9,
              height: 9,
              borderRadius: 9,
              background: "var(--color-node)",
              border: `2px solid ${SOCKET_COLOR[p.accepts[0]]}`,
            }}
            title={`${p.label} — ${p.accepts.join(" or ")}`}
          />
          <span className="text-[10px]" style={{ color: "var(--color-node-dim)" }}>
            {p.label}
          </span>
        </div>
      ))}

      {data.kind !== "shot" && (
        <div className="relative flex items-center justify-end px-2" style={{ height: ROW }}>
          <span className="num truncate text-[10px]" style={{ color: "var(--color-node-dim)" }} title={sub}>
            {sub}
          </span>
          <Handle
            type="source"
            id="out"
            position={Position.Right}
            style={{
              right: -5,
              top: "50%",
              width: 9,
              height: 9,
              borderRadius: 9,
              background: accent,
              border: "2px solid var(--color-node)",
            }}
            title={outT ? `${outT} — ${SOCKET_META[outT].carries}` : "not in this manifest"}
          />
        </div>
      )}
      {data.kind === "shot" && (
        <div className="px-2 pb-1.5 text-[10px]" style={{ color: "var(--color-node-dim)" }}>
          composites in wired order
        </div>
      )}
    </div>
  );
}

/** The one-line params digest shown on an op node, so the canvas reads without clicking. */
function summarise(d: GNodeData): string {
  const a = d.args;
  if (d.kind === "layer") return `${a.blend} · ${Number(a.opacity ?? 1).toFixed(2)}`;
  if (d.kind === "matte") return a.threshold ? `cut @ ${a.threshold}` : "soft";
  if (d.kind === "constant") return String(a.value);
  return "";
}

const nodeTypes = { pl: PLNode };

/* A tiny context so the node can resolve asset names without prop-drilling through
   React Flow's internals. */
const Ctx = { current: { byId: new Map<string, Asset>() } };
function useCtx() {
  return { assets: Ctx.current };
}

/* ─────────────────────────── the canvas ─────────────────────────── */

export default function GraphCanvas({
  shot,
  byId,
  onPatch,
  onClose,
}: {
  shot: Shot;
  byId: Map<string, Asset>;
  onPatch: (n: Partial<Shot>) => void;
  onClose: () => void;
}) {
  Ctx.current.byId = byId;

  const seed = useMemo(() => canvasFor(shot, byId), [shot.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const [nodes, setNodes, onNodesChange] = useNodesState<RFNode>(seed.nodes as RFNode[]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(seed.edges as Edge[]);
  const [sel, setSel] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  /* Attaching an asset from the library while the graph is open must show up here —
     otherwise the browser appears to do nothing. Sources on the canvas ARE the shot's
     source list; there is no second source of truth. */
  useEffect(() => {
    setNodes((ns) => {
      const have = new Set(ns.filter((n) => n.data.kind === "source").map((n) => n.data.assetId));
      const missing = shot.sourceIds.filter((id) => !have.has(id));
      const gone = ns.filter((n) => n.data.kind === "source" && !shot.sourceIds.includes(n.data.assetId!));
      let next = ns.filter((n) => !gone.includes(n));
      if (gone.length) {
        const ids = new Set(gone.map((g) => g.id));
        setEdges((es) => es.filter((e) => !ids.has(e.source) && !ids.has(e.target)));
      }
      next = next.concat(
        missing.map((aid, i) => ({
          id: `src_new_${aid}`,
          type: "pl" as const,
          position: { x: 40, y: 32 + (have.size + i) * 132 },
          data: { kind: "source" as NodeKind, assetId: aid, args: {} },
        })),
      );
      return next;
    });
  }, [shot.sourceIds, setNodes, setEdges]);

  /* The canvas is the author; `shot.nodes` is the artifact. Written on every settled
     change so the emitted spec always matches what is on screen. */
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    onPatch({ nodes: toGraphNodes(nodes as GNode[], edges as GEdge[]) });
  }, [nodes, edges]); // eslint-disable-line react-hooks/exhaustive-deps

  const validate = useCallback(
    (c: Connection | Edge) => canConnect(c as Connection, nodes as GNode[], edges as GEdge[], byId).ok,
    [nodes, edges, byId],
  );

  const onConnect = useCallback(
    (c: Connection) => {
      const v = canConnect(c, nodes as GNode[], edges as GEdge[], byId);
      if (!v.ok) {
        setHint(v.reason ?? "that connection is not allowed");
        return;
      }
      setHint(null);
      setEdges((es) => addEdge({ ...c, animated: false }, es));
    },
    [nodes, edges, byId, setEdges],
  );

  const add = (kind: NodeKind) => {
    setAdding(false);
    const id = `${kind}_${Date.now().toString(36)}`;
    setNodes((ns) => [
      ...ns,
      {
        id,
        type: "pl",
        position: { x: 300, y: 40 + ns.length * 24 },
        data: { kind, args: defaultArgs(kind), out: nextOut(kind, ns as GNode[]) },
      } as RFNode,
    ]);
    setSel(id);
  };

  const selected = nodes.find((n) => n.id === sel) ?? null;
  const patchArgs = (k: string, v: unknown) =>
    setNodes((ns) =>
      ns.map((n) => (n.id === sel ? { ...n, data: { ...n.data, args: { ...n.data.args, [k]: v } } } : n)),
    );

  const ops = toGraphNodes(nodes as GNode[], edges as GEdge[]);

  return (
    <section className="flex min-h-0 flex-1 flex-col border-t rule">
      {/* ── chrome: cream, same house ─────────────────────────────── */}
      <header className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 bg-[var(--color-surface)] px-3 py-1.5">
        <span className="text-[10px] uppercase tracking-[0.12em] text-[var(--color-muted)]">graph</span>
        <span className="text-[13px]" style={{ fontFamily: "var(--font-display)" }}>
          {shot.title}
        </span>
        <span className="num text-[11px] text-[var(--color-muted)]">
          {ops.length} op{ops.length === 1 ? "" : "s"}
        </span>

        <div className="relative">
          <button
            onClick={() => setAdding((v) => !v)}
            className="border rule px-2 py-0.5 text-[11px] hover:bg-[var(--color-surface-2)]"
          >
            Add node ▾
          </button>
          {adding && (
            <ul className="absolute left-0 top-full z-20 mt-1 w-[210px] border rule bg-[var(--color-surface)] shadow-lg">
              {(["blender_render", "envelope_extract", "remap", "constant", "layer", "matte"] as NodeKind[]).map((k) => (
                <li key={k}>
                  <button
                    onClick={() => add(k)}
                    className="block w-full px-2 py-1 text-left text-[11px] hover:bg-[var(--color-surface-2)]"
                    title={KINDS[k].why}
                  >
                    <span
                      aria-hidden
                      className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full align-middle"
                      style={{ background: KINDS[k].output ? SOCKET_COLOR[KINDS[k].output] : "#888" }}
                    />
                    {KINDS[k].label}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {hint && <span className="text-[11px] text-[var(--color-danger)]">{hint}</span>}

        <button
          onClick={onClose}
          className="ml-auto border rule px-2 py-0.5 text-[11px] hover:bg-[var(--color-surface-2)]"
        >
          Close graph
        </button>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* ── the well ──────────────────────────────────────────────── */}
        <div className="min-w-0 flex-1" style={{ background: "var(--color-well)" }}>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            isValidConnection={validate}
            onSelectionChange={({ nodes: n }) => setSel(n[0]?.id ?? null)}
            colorMode="dark"
            fitView
            fitViewOptions={{ padding: 0.14, maxZoom: 1 }}
            /* React Flow's default minZoom is 0.5, and fitView will not go below it —
               so a wide graph silently opens CLIPPED rather than zoomed out. A full
               shot is ~1,300px across and the pane is ~530px once the library and the
               N-panel take their share, which needs ~0.39. Measured, not guessed. */
            minZoom={0.15}
            proOptions={{ hideAttribution: false }}
            defaultEdgeOptions={{ style: { stroke: "var(--color-edge)", strokeWidth: 1.5 } }}
            style={{ background: "var(--color-well)" }}
          >
            <Background variant={BackgroundVariant.Dots} gap={18} size={1} color="rgba(201,168,76,0.14)" />
            <Controls showInteractive={false} />
          </ReactFlow>
        </div>

        {/* ── N-panel: selection params (§4) ───────────────────────── */}
        <aside className="hidden w-[212px] shrink-0 overflow-auto border-l rule bg-[var(--color-surface)] p-2 lg:block">
          {!selected ? (
            <p className="text-[11px] text-[var(--color-text-dim)]">
              Select a node to edit its parameters. Drag from a socket to wire it —
              only matching types connect.
            </p>
          ) : (
            <>
              <h3 className="text-[13px]" style={{ fontFamily: "var(--font-display)" }}>
                {selected.data.kind === "source"
                  ? byId.get(selected.data.assetId!)?.name ?? "missing asset"
                  : KINDS[selected.data.kind].label}
              </h3>
              <p className="mt-0.5 text-[10px] leading-snug text-[var(--color-muted)]">
                {selected.data.kind === "source"
                  ? byId.get(selected.data.assetId!)?.path
                  : KINDS[selected.data.kind].why}
              </p>

              {selected.data.out && (
                <p className="num mt-1.5 text-[10px] text-[var(--color-text-dim)]">
                  out: {selected.data.out}
                </p>
              )}

              <div className="mt-2 flex flex-col gap-1.5">
                {KINDS[selected.data.kind].params.map((p) => {
                  const v = selected.data.args[p.key];
                  if (p.type === "select") {
                    return (
                      <label key={p.key} className="flex items-center justify-between gap-2">
                        <span className="text-[10px] uppercase tracking-[0.1em] text-[var(--color-muted)]">
                          {p.label}
                        </span>
                        <select
                          value={String(v ?? p.options?.[0])}
                          onChange={(e) => patchArgs(p.key, e.target.value)}
                          className="border rule bg-[var(--color-bg)] px-1 py-0.5 text-[11px]"
                        >
                          {p.options?.map((o) => (
                            <option key={o} value={o}>
                              {o}
                            </option>
                          ))}
                        </select>
                      </label>
                    );
                  }
                  if (p.type === "range") {
                    const arr = (Array.isArray(v) ? v : [0, 1]) as number[];
                    return (
                      <label key={p.key} className="flex items-center justify-between gap-2">
                        <span className="text-[10px] uppercase tracking-[0.1em] text-[var(--color-muted)]">
                          {p.label}
                        </span>
                        <span className="flex gap-1">
                          {[0, 1].map((i) => (
                            <input
                              key={i}
                              type="number"
                              step={0.05}
                              value={arr[i]}
                              onChange={(e) => {
                                const next = [...arr];
                                next[i] = Number(e.target.value);
                                patchArgs(p.key, next);
                              }}
                              className="num w-[52px] border rule bg-[var(--color-bg)] px-1 py-0.5 text-[11px]"
                            />
                          ))}
                        </span>
                      </label>
                    );
                  }
                  return (
                    <label key={p.key} className="flex items-center justify-between gap-2">
                      <span className="text-[10px] uppercase tracking-[0.1em] text-[var(--color-muted)]">
                        {p.label}
                      </span>
                      <input
                        type="number"
                        min={p.min}
                        max={p.max}
                        step={p.step ?? 0.1}
                        value={Number(v ?? 0)}
                        onChange={(e) => patchArgs(p.key, Number(e.target.value))}
                        className="num w-[70px] border rule bg-[var(--color-bg)] px-1 py-0.5 text-[11px]"
                      />
                    </label>
                  );
                })}
              </div>

              {selected.data.kind !== "source" && selected.data.kind !== "shot" && (
                <button
                  onClick={() => {
                    setNodes((ns) => ns.filter((n) => n.id !== sel));
                    setEdges((es) => es.filter((e) => e.source !== sel && e.target !== sel));
                    setSel(null);
                  }}
                  className="mt-3 w-full border rule px-2 py-1 text-[11px] text-[var(--color-text-dim)] hover:border-[var(--color-danger)] hover:text-[var(--color-danger)]"
                >
                  Delete node
                </button>
              )}
            </>
          )}
        </aside>
      </div>
    </section>
  );
}

/**
 * Phone: a read-only summary of the graph as a list (§4). No canvas, no pan-zoom, no
 * gesture code — that is a standing rule, not a v1 shortcut.
 */
export function GraphSummary({ shot, byId }: { shot: Shot; byId: Map<string, Asset> }) {
  const ops = shot.nodes && shot.nodes.length ? shot.nodes : [];
  if (ops.length === 0) {
    return (
      <p className="text-[11px] text-[var(--color-text-dim)]">
        Default wiring — open this shot on a desktop to score it by hand.
      </p>
    );
  }
  return (
    <ol className="flex flex-col gap-1">
      {ops.map((n, i) => (
        <li key={i} className="flex items-baseline gap-1.5">
          <span className="num text-[10px] text-[var(--color-muted)]">{String(i + 1).padStart(2, "0")}</span>
          <span className="text-[11px]">{n.op.replace("_", " ")}</span>
          {n.out && <span className="num text-[10px] text-[var(--color-text-dim)]">→ {n.out}</span>}
        </li>
      ))}
    </ol>
  );
}

export { assetSocket };
