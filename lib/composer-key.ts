/** The phone's door into the Worker (S348 composer3): one key, compared in constant time. Never logged, never echoed. */
export function bearer(req: Request): string {
  return (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
}

/** Constant-time equality: walks the longer string whatever the first difference is, so timing says nothing about the key. */
export function keyOk(want: string, got: string): boolean {
  if (!want) return false;   // no secret set = nothing opens
  const n = Math.max(want.length, got.length);
  let d = want.length ^ got.length;
  for (let i = 0; i < n; i++) d |= (want.charCodeAt(i) || 0) ^ (got.charCodeAt(i) || 0);
  return d === 0;
}

export const MEDIA_ID = /^ph_[a-z0-9]{6,16}$/;
export const MEDIA_TYPES: Record<string, string> = { jpg: "image/jpeg", png: "image/png", mov: "video/quicktime", mp4: "video/mp4" };
/** Workers accept a request body of 100 MB on the Free and Pro plans (200 MB Business, 500 MB Enterprise). The cap sits just under the lowest. */
export const MEDIA_MAX = 100 * 1024 * 1024;
