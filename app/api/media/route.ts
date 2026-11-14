import { getCloudflareContext } from "@opennextjs/cloudflare";
import { bearer, keyOk, MEDIA_ID, MEDIA_MAX, MEDIA_TYPES } from "@/lib/composer-key";

/**
 * The phone's upload door (S348 composer3). PL DEV sends each Photos source of a piece here before it sends the piece's spec card:
 *   POST /api/media?id=ph_xxxxxxxx&ext=jpg|png|mov|mp4     Authorization: Bearer <composer key>     body = the raw file
 * It lands in R2 composer/media/<id>.<ext>; composer_jobs.py on the PC pulls it from there. Public Worker, so: no key = 401, before
 * anything else is looked at. 100 MB cap (the Workers request-body limit on Free/Pro); a clip over it is refused with 413 and the phone says so.
 */
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let env: { VAULT?: R2Bucket; COMPOSER_KEY?: string };
  try { env = getCloudflareContext().env as typeof env; } catch { return Response.json({ error: "no-cloudflare-context", detail: "uploads go to R2; run `npm run preview`" }, { status: 503 }); }
  if (!keyOk(env.COMPOSER_KEY ?? "", bearer(req))) return Response.json({ error: "unauthorized" }, { status: 401 });
  if (!env.VAULT) return Response.json({ error: "no-r2" }, { status: 503 });

  const q = new URL(req.url).searchParams;
  const id = q.get("id") ?? "", ext = (q.get("ext") ?? "").toLowerCase();
  if (!MEDIA_ID.test(id)) return Response.json({ error: "bad id", detail: "ids look like ph_ then 6 to 16 lowercase letters or digits" }, { status: 400 });
  const type = MEDIA_TYPES[ext];
  if (!type) return Response.json({ error: "bad ext", detail: "jpg, png, mov or mp4" }, { status: 400 });

  const len = Number(req.headers.get("content-length"));
  if (!Number.isFinite(len) || len <= 0) return Response.json({ error: "length required" }, { status: 411 });
  if (len > MEDIA_MAX) return Response.json({ error: "too large", detail: `${Math.round(MEDIA_MAX / 1048576)} MB at most`, max: MEDIA_MAX }, { status: 413 });
  if (!req.body) return Response.json({ error: "empty body" }, { status: 400 });

  const key = `composer/media/${id}.${ext}`;
  try {
    // R2 wants a stream of known length; FixedLengthStream gives it one and fails loud if the body is not that long.
    const FLS = (globalThis as { FixedLengthStream?: new (n: number) => TransformStream<Uint8Array, Uint8Array> }).FixedLengthStream;
    if (FLS) {
      const { readable, writable } = new FLS(len);
      const piped = req.body.pipeTo(writable);
      await env.VAULT.put(key, readable, { httpMetadata: { contentType: type } });
      await piped;
    } else {
      await env.VAULT.put(key, await req.arrayBuffer(), { httpMetadata: { contentType: type } });
    }
    const head = await env.VAULT.head(key);
    if (!head || head.size !== len) { await env.VAULT.delete(key); return Response.json({ error: "short write", got: head?.size ?? 0, want: len }, { status: 502 }); }
    return Response.json({ ok: true, id, ext, bytes: head.size });
  } catch (e) {
    return Response.json({ error: "upload failed", detail: String(e).slice(0, 200) }, { status: 502 });
  }
}
