"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import AssetBrowser from "@/components/AssetBrowser";
import SpecSheet from "@/components/SpecSheet";
import GraphCanvas, { GraphSummary } from "@/components/GraphCanvas";
import { emitSpec } from "@/lib/emit";
import {
  type Asset,
  type Manifest,
  type Piece,
  type Shot,
  DEFAULT_PIECE,
  SOCKET_COLOR,
  assetSocket,
  pieceDuration,
} from "@/lib/types";

/** { active, pieces: { id: Piece } } — more than one piece can exist (S263). */
const STORE = "pl-composer.pieces.v1";
/** The single-piece key this replaced. Read once, imported, never written again. */
const LEGACY = "pl-composer.piece.v1";

const newId = () => `p_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export default function Page() {
  const [pieces, setPieces] = useState<Record<string, Piece>>({});
  const [activeId, setActiveId] = useState<string>("");
  const [picking, setPicking] = useState(false);

  const piece = pieces[activeId] ?? DEFAULT_PIECE;

  /** Same signature the rest of this file already uses, so nothing else changes. */
  const setPiece = useCallback(
    (next: Piece | ((p: Piece) => Piece)) =>
      setPieces((all) => {
        const cur = all[activeId] ?? DEFAULT_PIECE;
        return { ...all, [activeId]: typeof next === "function" ? next(cur) : next };
      }),
    [activeId],
  );
  const [selected, setSelected] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [spec, setSpec] = useState<string | null>(null);
  /** Which shot's graph is open. Desktop only — the spec forbids a canvas on phone. */
  const [graphFor, setGraphFor] = useState<string | null>(null);
  /** id -> data URI. One fetch, shared by the library and the spine. A failure here
   *  costs pictures, never assets — the board stays usable without thumbnails. */
  const [thumbs, setThumbs] = useState<Record<string, string>>({});

  useEffect(() => {
    fetch("/api/thumbs")
      .then((r) => r.json() as Promise<{ thumbs?: Record<string, string> }>)
      .then((j) => setThumbs(j?.thumbs ?? {}))
      .catch(() => setThumbs({}));
  }, []);

  const onManifest = useCallback((m: Manifest) => setAssets(m.assets), []);
  const byId = useMemo(() => new Map(assets.map((a) => [a.id, a])), [assets]);

  // Per-viewer convenience only. The spec is the product; this is just so a piece
  // survives a refresh while it is being scored.
  useEffect(() => {
    let all: Record<string, Piece> = {};
    let active = "";
    try {
      const raw = localStorage.getItem(STORE);
      if (raw) {
        const saved = JSON.parse(raw) as { active?: string; pieces?: Record<string, Piece> };
        all = saved.pieces ?? {};
        active = saved.active && all[saved.active] ? saved.active : Object.keys(all)[0] ?? "";
      }
      // One-time import of the single-piece era. Read, never written back — but the old
      // key is LEFT IN PLACE rather than deleted, so a mistake here costs nothing.
      if (!Object.keys(all).length) {
        const old = localStorage.getItem(LEGACY);
        if (old) {
          const p: Piece = JSON.parse(old);
          active = newId();
          all = { [active]: p };
        }
      }
    } catch {}

    if (!Object.keys(all).length) {
      active = newId();
      all = { [active]: DEFAULT_PIECE };
    }
    setPieces(all);
    setActiveId(active);
    // Select the last shot on load. Without this, a restored piece comes back with
    // nothing selected and clicking an asset silently does nothing — which reads as a
    // broken library rather than "pick a shot first".
    const p = all[active];
    if (p?.shots.length) setSelected(p.shots[p.shots.length - 1].id);
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (!loaded || !activeId) return;
    try {
      localStorage.setItem(STORE, JSON.stringify({ active: activeId, pieces }));
    } catch {}
  }, [pieces, activeId, loaded]);

  const newPiece = () => {
    const id = newId();
    setPieces((all) => ({
      ...all,
      [id]: { ...DEFAULT_PIECE, piece: `untitled-${Object.keys(all).length + 1}`, shots: [] },
    }));
    setActiveId(id);
    setSelected(null);
    setGraphFor(null);
    setPicking(false);
  };

  const openPiece = (id: string) => {
    setActiveId(id);
    const p = pieces[id];
    setSelected(p?.shots.length ? p.shots[p.shots.length - 1].id : null);
    setGraphFor(null);
    setPicking(false);
  };

  const addShot = () => {
    const n = piece.shots.length + 1;
    const shot: Shot = {
      id: `shot_${String(n).padStart(2, "0")}`,
      title: "untitled shot",
      duration: 4,
      sourceIds: [],
    };
    setPiece((p) => ({ ...p, shots: [...p.shots, shot] }));
    setSelected(shot.id);
  };

  const patch = (id: string, next: Partial<Shot>) =>
    setPiece((p) => ({
      ...p,
      shots: p.shots.map((s) => (s.id === id ? { ...s, ...next } : s)),
    }));

  const move = (id: string, dir: -1 | 1) =>
    setPiece((p) => {
      const i = p.shots.findIndex((s) => s.id === id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= p.shots.length) return p;
      const shots = [...p.shots];
      [shots[i], shots[j]] = [shots[j], shots[i]];
      return { ...p, shots };
    });

  const remove = (id: string) => {
    setPiece((p) => ({ ...p, shots: p.shots.filter((s) => s.id !== id) }));
    setSelected((s) => (s === id ? null : s));
    setGraphFor((g) => (g === id ? null : g));
  };

  /** Attach to the selected shot, or the last one if nothing is selected. Falling
   *  back rather than returning early: a click that does nothing and says nothing is
   *  indistinguishable from a broken asset list. */
  const attach = (a: Asset) => {
    const target = selected ?? piece.shots[piece.shots.length - 1]?.id;
    if (!target) return;
    if (!selected) setSelected(target);
    const shot = piece.shots.find((s) => s.id === target);
    if (!shot || shot.sourceIds.includes(a.id)) return;
    patch(target, { sourceIds: [...shot.sourceIds, a.id] });
  };

  const total = pieceDuration(piece);
  const openShot = graphFor ? piece.shots.find((s) => s.id === graphFor) ?? null : null;

  return (
    <div className="flex h-dvh flex-col">
      {/* ── Piece header ─────────────────────────────────────────────── */}
      <header className="flex shrink-0 flex-wrap items-baseline gap-x-5 gap-y-1 border-b rule px-4 py-2.5">
        <input
          value={piece.piece}
          onChange={(e) => setPiece((p) => ({ ...p, piece: e.target.value }))}
          aria-label="Piece name"
          className="min-w-0 flex-1 bg-transparent text-[22px] leading-none focus:outline-none"
          style={{ fontFamily: "var(--font-display)" }}
        />
        {/* More than one piece can exist now. Before this, starting a second piece
            silently destroyed the first — the single worst thing on a board whose
            whole job is holding work in progress. */}
        <div className="relative shrink-0">
          <button
            onClick={() => setPicking((v) => !v)}
            className="border rule px-2 py-1 text-[11px] hover:bg-[var(--color-surface-2)]"
            title="Switch piece"
          >
            pieces <span className="num opacity-60">{Object.keys(pieces).length}</span> ▾
          </button>
          {picking && (
            <ul className="absolute left-0 top-full z-30 mt-1 max-h-[60vh] w-[260px] overflow-auto border rule bg-[var(--color-surface)] shadow-lg">
              {Object.entries(pieces).map(([id, p]) => (
                <li key={id}>
                  <button
                    onClick={() => openPiece(id)}
                    className={
                      "flex w-full items-baseline justify-between gap-2 px-2 py-1.5 text-left hover:bg-[var(--color-surface-2)] " +
                      (id === activeId ? "text-[var(--color-gold-dim)]" : "")
                    }
                  >
                    <span className="min-w-0 flex-1 truncate text-[12px]">{p.piece}</span>
                    <span className="num shrink-0 text-[10px] text-[var(--color-muted)]">
                      {p.shots.length} sh · {pieceDuration(p).toFixed(1)}s
                    </span>
                  </button>
                </li>
              ))}
              <li className="border-t rule">
                <button
                  onClick={newPiece}
                  className="w-full px-2 py-1.5 text-left text-[12px] text-[var(--color-gold-dim)] hover:bg-[var(--color-surface-2)]"
                >
                  + New piece
                </button>
              </li>
            </ul>
          )}
        </div>
        <Field label="shots" value={String(piece.shots.length)} />
        <Field label="duration" value={`${total.toFixed(1)}s`} />
        <Field label="fps" value={String(piece.fps)} />
        <Field label="resolution" value={piece.resolution} />
        <button
          disabled={piece.shots.length === 0}
          onClick={() => setSpec(emitSpec(piece, assets))}
          className="border border-[var(--color-gold)] bg-[var(--color-gold)]/12 px-3 py-1 text-[12px] text-[var(--color-text)] hover:bg-[var(--color-gold)]/20"
          title={piece.shots.length === 0 ? "Add a shot first" : "Emit the markdown spec"}
        >
          Build spec
        </button>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* ── Library. Desktop only: the spec forbids a graph on phone, and an
              asset browser beside a spine is the same density problem. ──── */}
        <aside className="hidden w-[300px] shrink-0 border-r rule md:block">
          <AssetBrowser onPick={attach} onLoad={onManifest} thumbs={thumbs} />
        </aside>

        {/* ── The spine, and under it the graph for whichever card is open ── */}
        <div className="flex min-w-0 flex-1 flex-col">
        <main
          className={
            openShot
              ? "shrink-0 overflow-x-auto px-3 py-2"
              : "min-w-0 flex-1 overflow-auto p-4"
          }
        >
          {piece.shots.length === 0 ? (
            <div className="max-w-md">
              <h2 className="text-[16px]" style={{ fontFamily: "var(--font-display)" }}>
                No shots yet
              </h2>
              <p className="mt-1 text-[var(--color-text-dim)]">
                A piece is a sequence of shots. Add one, then attach assets to it from
                the library.
              </p>
              <button
                onClick={addShot}
                className="mt-3 border rule px-3 py-1.5 hover:bg-[var(--color-surface-2)]"
              >
                Add shot
              </button>
            </div>
          ) : (
            <div className="flex flex-col gap-2 md:flex-row md:items-start md:gap-3">
              {piece.shots.map((s, i) => (
                <ShotCard
                  key={s.id}
                  shot={s}
                  index={i}
                  first={i === 0}
                  last={i === piece.shots.length - 1}
                  selected={selected === s.id}
                  graphOpen={graphFor === s.id}
                  compact={openShot !== null}
                  byId={byId}
                  thumbs={thumbs}
                  onSelect={() => setSelected(s.id)}
                  onOpenGraph={() => {
                    setSelected(s.id);
                    setGraphFor((g) => (g === s.id ? null : s.id));
                  }}
                  onPatch={(n) => patch(s.id, n)}
                  onMove={(d) => move(s.id, d)}
                  onRemove={() => remove(s.id)}
                  onDetach={(aid) =>
                    patch(s.id, { sourceIds: s.sourceIds.filter((x) => x !== aid) })
                  }
                />
              ))}
              <button
                onClick={addShot}
                className="shrink-0 border border-dashed rule px-4 py-3 text-[var(--color-text-dim)] hover:bg-[var(--color-surface-2)] md:w-[60px] md:self-stretch"
                title="Add shot"
              >
                +
              </button>
            </div>
          )}
        </main>

        {/* Desktop only. On phone the card shows a read-only list instead (§4). */}
        {openShot && (
          <div className="hidden min-h-0 flex-1 md:flex">
            <GraphCanvas
              key={openShot.id}
              shot={openShot}
              byId={byId}
              onPatch={(n) => patch(openShot.id, n)}
              onClose={() => setGraphFor(null)}
            />
          </div>
        )}
        </div>
      </div>

      {spec !== null && (
        <SpecSheet spec={spec} pieceName={piece.piece} onClose={() => setSpec(null)} />
      )}
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <span className="flex items-baseline gap-1.5">
      <span className="text-[10px] uppercase tracking-[0.12em] text-[var(--color-muted)]">
        {label}
      </span>
      <span className="num text-[12px]">{value}</span>
    </span>
  );
}

function ShotCard({
  shot,
  index,
  first,
  last,
  selected,
  graphOpen,
  compact,
  byId,
  thumbs,
  onSelect,
  onOpenGraph,
  onPatch,
  onMove,
  onRemove,
  onDetach,
}: {
  shot: Shot;
  index: number;
  first: boolean;
  last: boolean;
  selected: boolean;
  graphOpen: boolean;
  /** The spine becomes a strip once a graph is open — same cards, less of them shown. */
  compact: boolean;
  byId: Map<string, Asset>;
  thumbs: Record<string, string>;
  onSelect: () => void;
  onOpenGraph: () => void;
  onPatch: (n: Partial<Shot>) => void;
  onMove: (d: -1 | 1) => void;
  onRemove: () => void;
  onDetach: (assetId: string) => void;
}) {
  return (
    <div
      onClick={onSelect}
      className={
        "w-full shrink-0 border bg-[var(--color-surface)] md:w-[210px] " +
        (selected ? "border-[var(--color-gold)]" : "rule")
      }
    >
      <div className="flex items-center justify-between border-b rule px-2 py-1">
        {/* The number is real: shot order in the file is shot order in the piece. */}
        <span className="num text-[11px] text-[var(--color-muted)]">
          {String(index + 1).padStart(2, "0")}
        </span>
        <div className="flex items-center gap-0.5">
          {/* How a shot gets made. Desktop only — a node graph is never rendered on
              phone, so the affordance is not offered there either. */}
          <button
            title={graphOpen ? "Close graph" : "Open graph"}
            aria-label={graphOpen ? "Close graph" : "Open graph"}
            onClick={(e) => {
              e.stopPropagation();
              onOpenGraph();
            }}
            className={
              "hidden px-1 text-[12px] leading-none md:block " +
              (graphOpen
                ? "text-[var(--color-gold)]"
                : "text-[var(--color-text-dim)] hover:text-[var(--color-text)]")
            }
          >
            ⋔
          </button>
          <Icon label="Move earlier" onClick={() => onMove(-1)} disabled={first}>
            ←
          </Icon>
          <Icon label="Move later" onClick={() => onMove(1)} disabled={last}>
            →
          </Icon>
          <Icon label="Delete shot" onClick={onRemove}>
            ×
          </Icon>
        </div>
      </div>

      {/* Where a proxy thumbnail lands in build order step 6. Until then it holds
          its space rather than collapsing the card's proportions later — except in
          the strip, where the graph below is what the eye is on. */}
      {/* The card's picture is its FIRST visual source — the one the derived wiring
          makes the base, so the card shows what the shot is actually built on rather
          than a placeholder. */}
      {!compact && (() => {
        const firstVisual = shot.sourceIds.find(
          (id) => byId.get(id) && byId.get(id)!.kind !== "audio" && thumbs[id],
        );
        return firstVisual ? (
          <img
            src={thumbs[firstVisual]}
            alt=""
            className="aspect-video w-full object-cover"
            style={{ background: "var(--color-well)" }}
          />
        ) : (
          <div className="flex aspect-video items-center justify-center bg-[var(--color-surface-2)] text-[10px] text-[var(--color-muted)]">
            {shot.sourceIds.length === 0 ? "no sources" : "no preview"}
          </div>
        );
      })()}

      <div className="p-2">
        <input
          value={shot.title}
          onChange={(e) => onPatch({ title: e.target.value })}
          aria-label={`Title of shot ${index + 1}`}
          className="w-full bg-transparent focus:outline-none"
        />
        <div className="mt-1.5 flex items-center justify-between">
          <label className="flex items-center gap-1">
            <span className="text-[10px] uppercase tracking-[0.12em] text-[var(--color-muted)]">
              dur
            </span>
            <input
              type="number"
              min={0.1}
              step={0.1}
              value={shot.duration}
              onChange={(e) =>
                onPatch({ duration: Math.max(0.1, Number(e.target.value) || 0.1) })
              }
              aria-label={`Duration of shot ${index + 1} in seconds`}
              className="num w-14 border rule bg-[var(--color-bg)] px-1 py-0.5 text-[11px] focus:outline-none"
            />
          </label>
          <span className="num text-[10px] text-[var(--color-muted)]">
            {shot.sourceIds.length} src
          </span>
        </div>

        {/* What is actually attached. The card is where a wrong source gets caught,
            so the sources are named here rather than only counted. */}
        {shot.sourceIds.length > 0 && (
          <ul className="mt-2 border-t rule pt-1.5">
            {shot.sourceIds.map((aid) => {
              const a = byId.get(aid);
              return (
                <li key={aid} className="flex items-center gap-1.5 py-0.5">
                  <span
                    aria-hidden
                    className="h-1.5 w-1.5 shrink-0 rounded-full"
                    style={{
                      background: a ? SOCKET_COLOR[assetSocket(a.kind)] : "var(--color-danger)",
                    }}
                  />
                  <span
                    className="min-w-0 flex-1 truncate text-[11px]"
                    title={a ? a.path : "This id is not in the current manifest"}
                  >
                    {a ? a.name : `${aid} — missing`}
                  </span>
                  <button
                    aria-label="Remove source"
                    title="Remove source"
                    onClick={(e) => {
                      e.stopPropagation();
                      onDetach(aid);
                    }}
                    className="px-0.5 text-[11px] leading-none text-[var(--color-muted)] hover:text-[var(--color-danger)]"
                  >
                    ×
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        {/* Phone: the graph as a read-only list. No canvas, no pan-zoom, no gesture
            code — standing rule, and §4 names this exact fallback. */}
        {selected && (
          <div className="mt-2 border-t rule pt-1.5 md:hidden">
            <span className="text-[10px] uppercase tracking-[0.12em] text-[var(--color-muted)]">
              graph
            </span>
            <div className="mt-1">
              <GraphSummary shot={shot} byId={byId} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Icon({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className="px-1 text-[12px] leading-none text-[var(--color-text-dim)] hover:text-[var(--color-text)]"
    >
      {children}
    </button>
  );
}
