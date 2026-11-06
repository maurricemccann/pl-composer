import { defineCloudflareConfig } from "@opennextjs/cloudflare";
import staticAssetsIncrementalCache from "@opennextjs/cloudflare/overrides/incremental-cache/static-assets-incremental-cache";

// S345: no incremental cache was configured, so prerendered pages answered x-nextjs-cache: MISS
// and re-rendered on every visit (0.6-0.8 s). Nothing here revalidates, so the read-only
// static-assets cache serves the build's own pages; interception skips the Next server on a hit.
export default defineCloudflareConfig({
  incrementalCache: staticAssetsIncrementalCache,
  enableCacheInterception: true,
});
