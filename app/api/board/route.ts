/**
 * The render board (S342, his rulings 11-02: one render job = one card; the board lives in Composer; a card that reaches the house
 * renders and files to /curate without him). Local-first: this route reads the house's files straight off this PC:
 *   C:/dev/pl-tracers-hf/composer-jobs/<id>.json   one file per card (written by POST here)
 *   C:/dev/pl-tracers-hf/composer-jobs/state.json  the lane each card is in (written by scripts/refresh/composer_jobs.py)
 *   C:/Users/maurr/PSYCHED LUXURIES/_Jarvis/render-queue.json   live render progress
 * On Cloudflare there is no disk: GET answers with the last state file published to R2 (composer/board.json), read-only.
 */
import { bearer, keyOk, MEDIA_ID, MEDIA_TYPES } from "@/lib/composer-key";

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
  const raw = await req.json().catch(() => null) as null | Record<string, unknown>;
  if (raw?.kind === "spec") return postSpec(req, raw);
  const body = raw as null | { piece: string; shot: string; render: { look: string; path_dir: string; seed?: number }; bed: { track: string } | null; card: Record<string, string> };
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
    // S348·9a3e: no disk (the public Worker). A card sent from PL DEV with the composer key waits in R2 composer/inbox.json until the
    // PC's composer_jobs.py loop pulls it into composer-jobs/. Without the key it is refused: the Worker is public.
    try {
      const { getCloudflareContext } = await import("@opennextjs/cloudflare");
      const env = getCloudflareContext().env as { VAULT?: R2Bucket; COMPOSER_KEY?: string };
      const want = env.COMPOSER_KEY ?? "";
      const got = bearer(req);
      if (!keyOk(want, got)) return Response.json({ error: "unauthorized" }, { status: 401 });
      if (!env.VAULT) return Response.json({ error: "no-disk-no-r2", detail: String(e) }, { status: 503 });
      const id = `${new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "")}-${body.render.look}-${body.shot}`.replace(/[^A-Za-z0-9_-]/g, "");
      const job = { id, piece: body.piece, shot: body.shot, created: new Date().toISOString(), render: body.render, bed: body.bed ?? null, card: body.card ?? {} };
      const cur = await env.VAULT.get("composer/inbox.json");
      const inbox = cur ? ((await cur.json()) as unknown[]) : [];
      inbox.push(job);
      await env.VAULT.put("composer/inbox.json", JSON.stringify(inbox), { httpMetadata: { contentType: "application/json" } });
      return Response.json({ ok: true, id, waiting: "inbox" });
    } catch (e2) {
      return Response.json({ error: "no-disk", detail: String(e2) }, { status: 503 });
    }
  }
}

/**
 * A whole piece from the phone (S348 composer3): { kind: "spec", piece, spec: "<the .spec.md text>", media: ["ph_xxxxxxxx", ...] }.
 * Always keyed (the Worker is public) and always through R2: every media id must already be uploaded (POST /api/media), else 409 names
 * the missing ones so the phone can send just those and try again. Lands in the same composer/inbox.json the tracer cards use.
 */
async function postSpec(req: Request, b: Record<string, unknown>) {
  let env: { VAULT?: R2Bucket; COMPOSER_KEY?: string };
  try { const { getCloudflareContext } = await import("@opennextjs/cloudflare"); env = getCloudflareContext().env as typeof env; }
  catch { return Response.json({ error: "no-cloudflare-context" }, { status: 503 }); }
  if (!keyOk(env.COMPOSER_KEY ?? "", bearer(req))) return Response.json({ error: "unauthorized" }, { status: 401 });
  if (!env.VAULT) return Response.json({ error: "no-r2" }, { status: 503 });
  const piece = typeof b.piece === "string" ? b.piece.trim() : "", spec = typeof b.spec === "string" ? b.spec : "";
  const ids = Array.isArray(b.media) ? (b.media as unknown[]) : [];
  if (!piece || piece.length > 120) return Response.json({ error: "a spec card needs a piece name (120 characters at most)" }, { status: 400 });
  if (!spec.startsWith("---") || spec.length > 300_000 || !/^## Shot /m.test(spec)) return Response.json({ error: "spec is not a Composer spec" }, { status: 400 });
  if (ids.length > 60 || !ids.every((x) => typeof x === "string" && MEDIA_ID.test(x))) return Response.json({ error: "bad media ids" }, { status: 400 });
  const media: { id: string; ext: string }[] = [], missing: string[] = [];
  for (const id of new Set(ids as string[])) {
    let hit = "";
    for (const ext of Object.keys(MEDIA_TYPES)) if (await env.VAULT.head(`composer/media/${id}.${ext}`)) { hit = ext; break; }
    if (hit) media.push({ id, ext: hit }); else missing.push(id);
  }
  if (missing.length) return Response.json({ error: "media not uploaded", missing }, { status: 409 });
  const slug = piece.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "piece";
  const rnd = Array.from(crypto.getRandomValues(new Uint8Array(2)), (x) => x.toString(16).padStart(2, "0")).join("");
  const id = `${new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "")}-spec-${slug}-${rnd}`;
  const job = { id, kind: "spec", piece, shot: "the piece", created: new Date().toISOString(), spec, media, render: { look: "spec", path_dir: "" }, bed: null, card: {} };
  const cur = await env.VAULT.get("composer/inbox.json");
  const inbox = cur ? ((await cur.json()) as unknown[]) : [];
  inbox.push(job);
  await env.VAULT.put("composer/inbox.json", JSON.stringify(inbox), { httpMetadata: { contentType: "application/json" } });
  return Response.json({ ok: true, id, waiting: "inbox", media: media.length });
}
