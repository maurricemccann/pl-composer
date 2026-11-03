/**
 * The render board (S342, his rulings 11-02: one render job = one card; the board lives in Composer; a card that reaches the house
 * renders and files to /curate without him). Local-first: this route reads the house's files straight off this PC:
 *   C:/dev/pl-tracers-hf/composer-jobs/<id>.json   one file per card (written by POST here)
 *   C:/dev/pl-tracers-hf/composer-jobs/state.json  the lane each card is in (written by scripts/refresh/composer_jobs.py)
 *   C:/Users/maurr/PSYCHED LUXURIES/_Jarvis/render-queue.json   live render progress
 * On Cloudflare there is no disk: GET answers with the last state file published to R2 (composer/board.json), read-only.
 */
export const dynamic = "force-dynamic";

const JOBS = process.env.PL_COMPOSER_JOBS ?? "C:/dev/pl-tracers-hf/composer-jobs";
const QUEUE = process.env.PL_RENDER_QUEUE ?? "C:/Users/maurr/PSYCHED LUXURIES/_Jarvis/render-queue.json";

type Lane = "drafted" | "sent" | "rendering" | "rendered" | "filed" | "failed";
export interface Card { id: string; piece: string; shot: string; look: string; path: string; bed: string | null; created: string; lane: Lane; progress?: string; file?: string; note?: string; at?: string }

async function fsmod() { return await import("node:fs/promises"); }

export async function GET() {
  try {
    const fs = await fsmod();
    const dir = await fs.readdir(JOBS).catch(() => null);
    if (!dir) return fromR2();
    const names = dir.filter((n) => n.endsWith(".json") && n !== "state.json");
    let state: Record<string, Record<string, unknown>> = {};
    try { state = JSON.parse(await fs.readFile(`${JOBS}/state.json`, "utf8")); } catch { /* no card has moved yet */ }
    let queue: Record<string, { frames?: number; total?: number; status?: string; note?: string }> = {};
    try {
      const q = JSON.parse(await fs.readFile(QUEUE, "utf8")) as { jobs: { name: string; frames?: number; total?: number; status?: string; note?: string }[] };
      for (const j of q.jobs) queue[j.name] = j;
    } catch { /* no queue file: progress stays unknown */ }
    const cards: Card[] = [];
    for (const n of names) {
      const job = JSON.parse(await fs.readFile(`${JOBS}/${n}`, "utf8"));
      const st = (state[job.id] ?? {}) as Record<string, string>;
      const q = st.queue_name ? queue[st.queue_name] : undefined;
      cards.push({ id: job.id, piece: job.piece, shot: job.shot, look: job.render?.look, path: job.render?.path_dir, bed: job.bed?.track ?? null, created: job.created,
        lane: (st.lane as Lane) ?? "sent", progress: q ? `${q.frames ?? 0}/${q.total ?? "?"}` : st.progress, file: st.file, note: st.note ?? q?.note, at: st.at });
    }
    cards.sort((a, b) => (b.created ?? "").localeCompare(a.created ?? ""));
    return Response.json({ source: "disk", pulled: new Date().toISOString(), cards });
  } catch {
    return fromR2();
  }
}

/** No disk (Cloudflare): the last board the PC published (composer_jobs.py publish), read-only. */
async function fromR2() {
  try {
    const { getCloudflareContext } = await import("@opennextjs/cloudflare");
    const bucket = (getCloudflareContext().env as { VAULT?: R2Bucket }).VAULT;
    const obj = bucket ? await bucket.get("composer/board.json") : null;
    if (!obj) return Response.json({ source: "r2", cards: [], note: "nothing published yet" });
    return new Response(obj.body, { headers: { "content-type": "application/json", "cache-control": "no-store" } });
  } catch (e) {
    return Response.json({ error: "no-disk-no-r2", detail: String(e) }, { status: 503 });
  }
}

/** Create a card: one render job. Body = { piece, shot, render: {look, path_dir, seed?}, bed: {track} | null, card: {...} }. */
export async function POST(req: Request) {
  const body = await req.json().catch(() => null) as null | { piece: string; shot: string; render: { look: string; path_dir: string; seed?: number }; bed: { track: string } | null; card: Record<string, string> };
  if (!body?.render?.look || !body.render.path_dir || !body.piece || !body.shot) return Response.json({ error: "a card needs piece, shot, render.look and render.path_dir" }, { status: 400 });
  if (/[\\/]\.\.|[<>"|?*]/.test(body.render.path_dir)) return Response.json({ error: "bad path" }, { status: 400 });
  try {
    const fs = await fsmod();
    await fs.mkdir(JOBS, { recursive: true });
    const id = `${new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "")}-${body.render.look}-${body.shot}`.replace(/[^A-Za-z0-9_-]/g, "");
    const job = { id, piece: body.piece, shot: body.shot, created: new Date().toISOString(), render: body.render, bed: body.bed ?? null, card: body.card ?? {} };
    await fs.writeFile(`${JOBS}/${id}.json`, JSON.stringify(job, null, 1), "utf8");
    return Response.json({ ok: true, id });
  } catch (e) {
    return Response.json({ error: "no-disk", detail: String(e) }, { status: 503 });
  }
}
