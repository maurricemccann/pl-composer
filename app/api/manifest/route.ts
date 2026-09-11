import { getCloudflareContext } from "@opennextjs/cloudflare";

/**
 * The read side of the manifest contract (spec §8).
 *
 * The CLI is the authority on the library: `OpenMontage/projects/pl-curves/asset_index.py`
 * walks the real asset roots and writes manifest.json, which is put in R2. This board
 * reads it and never writes it — there is no upload path here on purpose.
 *
 * Publish a fresh index with:
 *   python asset_index.py
 *   wrangler r2 object put pl-vault/composer/manifest.json --file manifest.json --remote
 */
export const dynamic = "force-dynamic";

const KEY = "composer/manifest.json";

export async function GET() {
  let bucket: R2Bucket | undefined;
  try {
    bucket = (getCloudflareContext().env as { VAULT?: R2Bucket }).VAULT;
  } catch {
    // Thrown by `next dev`, which has no Cloudflare context at all. Say so plainly
    // rather than returning an empty manifest — an asset browser showing 0 assets
    // because of a missing binding must never look like a library with 0 assets.
    return Response.json(
      { error: "no-cloudflare-context", detail: "Run `npm run preview`, not `next dev` — the manifest lives in R2." },
      { status: 503 },
    );
  }

  if (!bucket) {
    return Response.json(
      { error: "no-r2-binding", detail: "VAULT binding missing from wrangler.jsonc." },
      { status: 503 },
    );
  }

  const obj = await bucket.get(KEY);
  if (!obj) {
    return Response.json(
      {
        error: "manifest-not-published",
        detail: `No object at ${KEY}. Run asset_index.py, then wrangler r2 object put.`,
      },
      { status: 404 },
    );
  }

  return new Response(obj.body, {
    headers: {
      "Content-Type": "application/json",
      // The manifest changes only when the CLI republishes it. A short cache keeps
      // the browser snappy without letting a stale index linger past a re-index.
      "Cache-Control": "public, max-age=60",
    },
  });
}
