"use client";
/**
 * The render board (S342, his rulings 11-02): one render job = one card, inside Composer, and a card that reaches the house renders
 * and files to /curate without him. Lanes: Sent → Rendering → Filed → Ruled (plus Failed, red). The board READS; the house moves
 * the cards (scripts/refresh/composer_jobs.py writes state, the render queue writes progress, his /curate marks write Ruled).
 * Polls every 10 s so a card walks the lanes without a reload.
 */
import { useEffect, useState } from "react";

export interface Card { id: string; piece: string; shot: string; look: string; path: string; bed: string | null; created: string; lane: string; progress?: string; file?: string; note?: string; at?: string; taste?: string | null }

const LANES: { id: string; label: string; why: string }[] = [
  { id: "sent", label: "Sent", why: "The card is written; the house has not picked it up yet." },
  { id: "rendering", label: "Rendering", why: "In the render queue, one job at a time." },
  { id: "rendered", label: "Mixing", why: "Rendered; the bed goes on and the word check runs." },
  { id: "filed", label: "Filed", why: "On /curate, unmarked. Rule it there." },
  { id: "ruled", label: "Ruled", why: "You marked it: keep, maybe or cut." },
  { id: "failed", label: "Failed", why: "The render or the mix stopped. The note says why." },
];

export function Board({ taste }: { taste?: (file: string) => string | null | undefined }) {
  const [cards, setCards] = useState<Card[]>([]);
  const [pulled, setPulled] = useState<string>("");
  const [err, setErr] = useState<string>("");
  useEffect(() => {
    let live = true;
    const pull = () => fetch("/api/board").then((r) => r.json() as Promise<{ error?: string; detail?: string; cards?: Card[]; pulled?: string }>).then((j) => {
      if (!live) return;
      if (j.error) { setErr(j.detail || j.error); return; }
      setErr(""); setCards(j.cards ?? []); setPulled(j.pulled ?? "");
    }).catch((e) => live && setErr(String(e)));
    pull(); const t = setInterval(pull, 10_000);
    return () => { live = false; clearInterval(t); };
  }, []);
  const laneOf = (c: Card) => (c.lane === "filed" && c.file && taste?.(c.file) ? "ruled" : c.lane);
  const age = pulled ? Math.round((Date.now() - new Date(pulled).getTime()) / 1000) : null;
  return (
    <section className="flex h-full min-h-0 flex-col gap-2 p-3">
      <div className="flex items-baseline justify-between text-[11px] text-[var(--color-muted)]">
        <span>{cards.length} card{cards.length === 1 ? "" : "s"} · the house moves them; you rule on /curate</span>
        <span>{err ? <span className="text-[var(--color-danger)]">{err}</span> : age !== null ? `pulled ${age}s ago` : "pulling…"}</span>
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-2 gap-2 overflow-auto md:grid-cols-6">
        {LANES.map((L) => {
          const inLane = cards.filter((c) => laneOf(c) === L.id);
          return (
            <div key={L.id} className="flex min-h-[160px] flex-col gap-1.5 border rule p-2" title={L.why}>
              <div className="flex items-baseline justify-between">
                <span className="text-[12px]" style={{ fontFamily: "var(--font-display)" }}>{L.label}</span>
                <span className="num text-[10px] text-[var(--color-muted)]">{inLane.length}</span>
              </div>
              {inLane.map((c) => (
                <div key={c.id} className={"border p-1.5 text-[11px] " + (L.id === "failed" ? "border-[var(--color-danger)]" : "rule")}>
                  <div className="truncate" title={c.id}>{c.piece} · {c.shot}</div>
                  <div className="truncate text-[var(--color-text-dim)]">{c.look}{c.bed ? ` + ${c.bed.replace(/\.(wav|mp3)$/i, "")}` : ""}</div>
                  {c.progress && L.id === "rendering" && <div className="num text-[10px]">{c.progress}</div>}
                  {c.file && <a className="block truncate underline" href={`https://pl-curve-library.psychedluxuries.workers.dev/curate`} target="_blank" rel="noreferrer" title={c.file}>{c.file.replace(/^pl-short-his-/, "")}</a>}
                  {c.file && taste?.(c.file) && <div className="text-[var(--color-gold)]">{taste(c.file)}</div>}
                  {c.note && <div className="text-[var(--color-danger)]" title={c.note}>{c.note.slice(0, 80)}</div>}
                  <div className="num text-[10px] text-[var(--color-muted)]">{(c.at ?? c.created ?? "").slice(5, 16).replace("T", " ")}</div>
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </section>
  );
}
