import { getCloudflareContext } from "@opennextjs/cloudflare";

/**
 * Thumbnails — build order step 6, the preview layer, in its cheapest honest form.
 *
 * ONE object, not one per asset. The CLI builds `thumbs.json`, a map of asset id to a
 * small JPEG data URI, and it is published exactly like the manifest. That means one
 * upload, one fetch, and no request per library row — which matters because the board
 * renders a scrolling list over thousands of assets.
 *
 * Why this exists at all (S263): the first real piece was composed entirely by reading
 * FILENAMES, and one shot rendered pure black because the asset behind the name was
 * black ink that vanished on a black ground. Nobody could have seen that coming from
 * `curve-comp-05.svg`. A thumbnail would have.
 *
 * Publish with:
 *   python asset_index.py --thumbs
 *   wrangler r2 object put pl-vault/composer/thumbs.json --file thumbs.json --remote
 *
 * Missing thumbnails are NOT an error. Models have no cheap picture and the 3d catalog
 * is deliberately not thumbnailed at all, so the board falls back to a type badge. A
 * 404 here means "no thumbnails published yet", and the library still works.
 */
export const dynamic = "force-dynamic";

const KEY = "composer/thumbs.json";

export async function GET() {
  let bucket: R2Bucket | undefined;
  try {
    bucket = (getCloudflareContext().env as { VAULT?: R2Bucket }).VAULT;
  } catch {
    return Response.json({ thumbs: {}, note: "no-cloudflare-context" }, { status: 200 });
  }
  if (!bucket) {
    return Response.json({ thumbs: {}, note: "no-r2-binding" }, { status: 200 });
  }

  const obj = await bucket.get(KEY);
  if (!obj) {
    // Deliberately 200 with an empty map: the browser treats "no thumbnails yet" as a
    // normal state, not a failure to handle.
    return Response.json({ thumbs: {}, note: "not-published" }, { status: 200 });
  }

  return new Response(obj.body, {
    headers: {
      "Content-Type": "application/json",
      // Thumbnails change only on a re-index, and the payload is the heavy one here.
      "Cache-Control": "public, max-age=3600",
    },
  });
}
