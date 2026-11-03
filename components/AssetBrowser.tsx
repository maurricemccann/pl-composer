"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  type Asset,
  type Manifest,
  assetSocket,
  SOCKET_COLOR,
} from "@/lib/types";
import { useDebouncedValue } from "@/lib/use-debounced-value";
import { dedup } from "@/lib/request-dedup";
import { fetchWithTimeout } from "@/lib/fetch-with-timeout";
import { Skeleton } from "@/components/Skeleton";

/** Rows rendered at once. 100 per page per founder ruling. */
const PAGE = 100;

/** m:ss — short enough to sit in a dense row without pushing the name out. */
function clock(sec: number): string {
  const s = Math.round(sec);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function bytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export default function AssetBrowser({
  onPick,
  onLoad,
  thumbs: thumbsProp,
  attachTo,
}: {
  onPick?: (a: Asset) => void;
  onLoad?: (m: Manifest) => void;
  thumbs?: Record<string, string>;
  attachTo?: string | null;
}) {
  const thumbs = thumbsProp ?? {};
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [error, setError] = useState<{ error: string; detail?: string } | null>(null);
  const [q, setQ] = useState("");
  const debouncedQ = useDebouncedValue(q);
  const [catalog, setCatalog] = useState<string>("all");
  const [limit, setLimit] = useState(PAGE);

  useEffect(() => {
    let active = true;
    const run = async () => {
      try {
        const m = await dedup("asset-browser-manifest", async () => {
          const r = await fetchWithTimeout("/api/manifest", { timeoutMs: 10000 });
          const j = await r.json();
          if (!r.ok) throw j;
          return j as Manifest;
        });
        if (!active) return;
        setManifest(m);
        onLoad?.(m);
      } catch (e: unknown) {
        if (!active) return;
        setError(
          e && typeof e === "object" && "error" in e
            ? (e as { error: string; detail?: string })
            : { error: "unreachable", detail: String(e) },
        );
      }
    };
    run();
    return () => { active = false; };
    // Intentionally once on mount: the manifest is republished by the CLI, not by
    // anything this component does, so re-running on an onLoad identity change would
    // only refetch 5,500 rows for nothing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Counts follow the TEXT filter. */
  const catalogs = useMemo(() => {
    if (!manifest) return [];
    const needle = debouncedQ.trim().toLowerCase();
    const tally = new Map<string, number>();
    for (const a of manifest.assets) {
      if (needle && !a.name.toLowerCase().includes(needle) && !a.ext.includes(needle)) continue;
      tally.set(a.catalog, (tally.get(a.catalog) ?? 0) + 1);
    }
    return manifest.roots
      .filter((r) => r.present && r.count > 0)
      .map((r) => ({ ...r, count: tally.get(r.catalog) ?? 0 }))
      .filter((r) => r.count > 0);
  }, [manifest, debouncedQ]);

  const totalShown = useMemo(() => {
    if (!manifest) return 0;
    const needle = debouncedQ.trim().toLowerCase();
    if (!needle) return manifest.counts.total;
    return manifest.assets.filter(
      (a) => a.name.toLowerCase().includes(needle) || a.ext.includes(needle),
    ).length;
  }, [manifest, debouncedQ]);

  const filtered = useMemo(() => {
    if (!manifest) return [];
    const needle = debouncedQ.trim().toLowerCase();
    return manifest.assets.filter((a) => {
      if (catalog !== "all" && a.catalog !== catalog) return false;
      if (!needle) return true;
      return a.name.toLowerCase().includes(needle) || a.ext.includes(needle);
    });
  }, [manifest, debouncedQ, catalog]);

  useEffect(() => setLimit(PAGE), [debouncedQ, catalog]);

  if (error) {
    return (
      <div className="p-4">
        <div className="border rule border-l-2 border-l-[var(--color-danger)] bg-[var(--color-surface)] p-3">
          <div className="font-medium text-[var(--color-danger)]">
            The library did not load
          </div>
          <div className="num mt-1 text-[11px] text-[var(--color-text-dim)]">{error.error}</div>
          {error.detail && (
            <div className="mt-2 text-[12px] text-[var(--color-text-dim)]">{error.detail}</div>
          )}
        </div>
      </div>
    );
  }

  if (!manifest) {
    return (
      <div className="p-4 flex flex-col items-center justify-center min-h-[300px]">
        <Skeleton count={4} variant="pulse" className="w-32" />
        <p className="mt-4 text-[var(--color-muted)]">Reading the library…</p>
      </div>
    );
  }

  const missing = manifest.roots.filter((r) => !r.present);

  return (
    <div className="flex h-full flex-col">
      <div className="border-b rule px-3 py-2">
        <div className="flex items-baseline justify-between">
          <span className="text-[11px] uppercase tracking-[0.14em] text-[var(--color-text-dim)]">
            Library
          </span>
          <span className="num text-[11px] text-[var(--color-muted)]">
            {totalShown.toLocaleString()}
            {totalShown !== manifest.counts.total &&
              ` of ${manifest.counts.total.toLocaleString()}`}{" "}
            assets
          </span>
        </div>
        <div className="num mt-0.5 text-[10px] text-[var(--color-muted)]">
          indexed {manifest.generated.replace("T", " ")}
          {!manifest.probed && " · durations not probed"}
        </div>
        <div className="mt-1 truncate text-[10px]">
          {attachTo ? (
            <span className="text-[var(--color-gold-dim)]">
              click an asset → attaches to <span className="num">{attachTo}</span>
            </span>
          ) : (
            <span className="text-[var(--color-muted)]">add a shot to attach assets</span>
          )}
        </div>
      </div>

      {missing.length > 0 && (
        <div className="border-b rule border-l-2 border-l-[var(--color-warn)] bg-[var(--color-surface-2)] px-3 py-2 text-[11px]">
          <span className="font-medium text-[var(--color-warn)]">
            {missing.length} root{missing.length > 1 ? "s" : ""} not mounted.
          </span>{" "}
          <span className="text-[var(--color-text-dim)]">
            This list is incomplete — {missing.map((r) => r.catalog).join(", ")}.
          </span>
        </div>
      )}

      <div className="border-b rule p-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Filter by name or extension"
          aria-label="Filter assets"
          className="w-full border rule bg-[var(--color-surface)] px-2 py-1.5 text-[12px] placeholder:text-[var(--color-muted)] focus:outline-none"
        />
        <div className="mt-2 flex flex-wrap gap-1">
          <Chip on={catalog === "all"} onClick={() => setCatalog("all")}>
            all <span className="num opacity-60">{totalShown}</span>
          </Chip>
          {catalogs.map((r) => (
            <Chip
              key={r.catalog}
              on={catalog === r.catalog}
              onClick={() => setCatalog(r.catalog)}
            >
              {r.catalog} <span className="num opacity-60">{r.count}</span>
            </Chip>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {filtered.length === 0 ? (
          <div className="p-4 text-[var(--color-muted)]">
            Nothing matches “{q}”. Clear the filter to see the whole library.
          </div>
        ) : (
          <ul>
            {filtered.slice(0, limit).map((a) => {
              const socket = assetSocket(a.kind);
              return (
                <li key={a.id}>
                  <button
                    onClick={() => onPick?.(a)}
                    title={`${a.path}\n\n${socket}`}
                    className="flex w-full items-center gap-2 border-b rule px-3 py-1.5 text-left hover:bg-[var(--color-surface-2)]"
                  >
                    {thumbs[a.id] ? (
                      <img
                        src={thumbs[a.id]}
                        alt=""
                        loading="lazy"
                        decoding="async"
                        className="h-7 w-7 shrink-0 rounded-[2px] border rule object-cover"
                        style={{ background: "var(--color-well)" }}
                      />
                    ) : (
                      <span
                        aria-hidden
                        title={socket}
                        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[2px] border rule text-[8px] uppercase tracking-wide"
                        style={{ color: SOCKET_COLOR[socket] }}
                      >
                        {socket.slice(0, 3)}
                      </span>
                    )}
                    <span className="min-w-0 flex-1 truncate">{a.name}</span>
                    {a.duration ? (
                      <span className="num shrink-0 text-[10px] text-[var(--color-gold-dim)]">
                        {clock(a.duration)}
                      </span>
                    ) : null}
                    <span className="num shrink-0 text-[10px] text-[var(--color-muted)]">
                      {a.ext.replace(".", "")}
                    </span>
                    <span className="num shrink-0 text-[10px] text-[var(--color-muted)]">
                      {bytes(a.bytes)}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        {filtered.length > limit && (
          <button
            onClick={() => setLimit((n) => n + PAGE)}
            className="w-full px-3 py-2 text-[12px] text-[var(--color-gold-dim)] hover:bg-[var(--color-surface-2)]"
          >
            Show more — {(filtered.length - limit).toLocaleString()} not shown
          </button>
        )}
      </div>
    </div>
  );
}

function Chip({
  on,
  onClick,
  children,
}: {
  on: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={on}
      className={
        "rounded-full border px-2 py-0.5 text-[11px] " +
        (on
          ? "border-[var(--color-gold)] bg-[var(--color-gold)]/12 text-[var(--color-text)]"
          : "rule text-[var(--color-text-dim)] hover:bg-[var(--color-surface-2)]")
      }
    >
      {children}
    </button>
  );
}
