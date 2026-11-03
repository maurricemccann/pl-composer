/** Request deduplication - in-flight calls and a short completion window share one promise. */
const pending = new Map<string, Promise<unknown>>();

export function dedup<T>(
  key: string,
  fn: () => Promise<T>,
  opts?: { ttlMs?: number },
): Promise<T> {
  const existing = pending.get(key);
  if (existing) return existing as Promise<T>;

  const p = fn();
  pending.set(key, p);

  const remove = () => {
    if (pending.get(key) === p) pending.delete(key);
  };
  const ttl = opts?.ttlMs ?? 5000;

  p.then(
    () => (ttl > 0 ? setTimeout(remove, ttl) : remove()),
    remove,
  );

  return p;
}
