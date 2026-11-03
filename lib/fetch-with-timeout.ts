/** Request timeout wrapper — aborts fetch calls that exceed the timeout.
 * Usage: fetchWithTimeout('/api/manifest', { timeoutMs: 10000 })
 */
export async function fetchWithTimeout(
  input: RequestInfo | URL,
  init?: RequestInit & { timeoutMs?: number }
): Promise<Response> {
  const { timeoutMs = 10000, ...fetchInit } = init ?? {};
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(input, { ...fetchInit, signal: controller.signal });
    return res;
  } finally {
    clearTimeout(id);
  }
}
