"use client";

import { useEffect, useMemo, useState } from "react";
import {
  type Asset,
  type Manifest,
  assetSocket,
  SOCKET_COLOR,
} from "@/lib/types";

/** Rows rendered at once. 5,509 assets is a real library; the DOM does not need all
 *  of it to answer "where is the obsidian bed". Filter narrows, this caps. No
 *  virtualization dependency until a real piece proves the cap is the problem. */
const PAGE = 60;

function bytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1048576).toFixed(1)} MB`;
  return `${(n / 1073741824).toFixed(2)} GB`;
}

export default function AssetBrowser({
  onPick,
  onLoad,
}: {
  onPick?: (a: Asset) => void;
  /** Hands the loaded manifest up so the page can resolve ids when emitting the
   *  spec. One fetch, one owner — the page does not re-request it. */
  onLoad?: (m: Manifest) => void;
}) {
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [error, setError] = useState<{ error: string; detail?: string } | null>(null);
  const [q, setQ] = useState("");
  const [catalog, setCatalog] = useState<string>("all");
  const [limit, setLimit] = useState(PAGE);

  useEffect(() => {
    fetch("/api/manifest")
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw j;
        return j as Manifest;
      })
      .then((m) => {
        setManifest(m);
        onLoad?.(m);
      })
      .catch((e) => setError(e?.error ? e : { error: "unreachable", detail: String(e) }));
    // Intentionally once on mount: the manifest is republished by the CLI, not by
    // anything this component does, so re-running on an onLoad identity change would
    // only refetch 5,500 rows for nothing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const catalogs = useMemo(() => {
    if (!manifest) return [];
    return manifest.roots.filter((r) => r.present && r.count > 0);
  }, [manifest]);

  const filtered = useMemo(() => {
    if (!manifest) return [];
    const needle = q.trim().toLowerCase();
    return manifest.assets.filter((a) => {
      if (catalog !== "all" && a.catalog !== catalog) return false;
      if (!needle) return true;
      return a.name.toLowerCase().includes(needle) || a.ext.includes(needle);
    });
  }, [manifest, q, catalog]);

  useEffect(() => setLimit(PAGE), [q, catalog]);

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
    return <div className="p-4 text-[var(--color-muted)]">Reading the library…</div>;
  }

  const missing = manifest.roots.filter((r) => !r.present);

  return (
    <div className="flex h-full flex-col">
      {/* Header: what this library actually is, in numbers. */}
      <div className="border-b rule px-3 py-2">
        <div className="flex items-baseline justify-between">
          <span className="text-[11px] uppercase tracking-[0.14em] text-[var(--color-text-dim)]">
            Library
          </span>
          <span className="num text-[11px] text-[var(--color-muted)]">
            {manifest.counts.total.toLocaleString()} assets
          </span>
        </div>
        <div className="num mt-0.5 text-[10px] text-[var(--color-muted)]">
          indexed {manifest.generated.replace("T", " ")}
          {!manifest.probed && " · durations not probed"}
        </div>
      </div>

      {/* An unmounted root is the one thing that must never be quiet: the library
          looks smaller, and nothing else on screen would say why. */}
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
            all <span className="num opacity-60">{manifest.counts.total}</span>
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
                    <span
                      aria-hidden
                      className="h-2 w-2 shrink-0 rounded-full"
                      style={{ background: SOCKET_COLOR[socket] }}
                    />
                    <span className="min-w-0 flex-1 truncate">{a.name}</span>
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
            onClick={() => setLimit((n) => n + PAGE * 4)}
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
  children: React.ReactNode;
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
