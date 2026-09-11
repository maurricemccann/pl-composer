"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import AssetBrowser from "@/components/AssetBrowser";
import SpecSheet from "@/components/SpecSheet";
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

const STORE = "pl-composer.piece.v1";

export default function Page() {
  const [piece, setPiece] = useState<Piece>(DEFAULT_PIECE);
  const [selected, setSelected] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [spec, setSpec] = useState<string | null>(null);

  const onManifest = useCallback((m: Manifest) => setAssets(m.assets), []);
  const byId = useMemo(() => new Map(assets.map((a) => [a.id, a])), [assets]);

  // Per-viewer convenience only. The spec is the product; this is just so a piece
  // survives a refresh while it is being scored.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORE);
      if (raw) setPiece(JSON.parse(raw));
    } catch {}
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (!loaded) return;
    try {
      localStorage.setItem(STORE, JSON.stringify(piece));
    } catch {}
  }, [piece, loaded]);

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
  };

  const attach = (a: Asset) => {
    if (!selected) return;
    const shot = piece.shots.find((s) => s.id === selected);
    if (!shot || shot.sourceIds.includes(a.id)) return;
    patch(selected, { sourceIds: [...shot.sourceIds, a.id] });
  };

  const total = pieceDuration(piece);

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
          <AssetBrowser onPick={attach} onLoad={onManifest} />
        </aside>

        {/* ── The spine ────────────────────────────────────────────────── */}
        <main className="min-w-0 flex-1 overflow-auto p-4">
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
                  byId={byId}
                  onSelect={() => setSelected(s.id)}
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
  byId,
  onSelect,
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
  byId: Map<string, Asset>;
  onSelect: () => void;
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
          its space rather than collapsing the card's proportions later. */}
      <div className="flex aspect-video items-center justify-center bg-[var(--color-surface-2)] text-[10px] text-[var(--color-muted)]">
        no preview
      </div>

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
