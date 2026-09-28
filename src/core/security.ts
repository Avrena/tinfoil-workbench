import { InputError } from './validation.js';
/** Does not trust URL prefixes: credentials, ports, hosts and exact paths are checked. */
export function trustedFrame(url: string): boolean {
  try { const u = new URL(url); return u.protocol === 'app:' && u.hostname === 'workbench' && !u.port && !u.username && !u.password && u.pathname === '/index.html' && !u.search; }
  catch { return false; }
}
export function resourcePath(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.protocol !== 'app:' || u.hostname !== 'workbench' || u.port || u.username || u.password || u.search) return null;
    const decoded = decodeURIComponent(u.pathname);
    if (decoded.includes('\\') || decoded.includes('\0') || decoded.split('/').some(p => p === '..' || p === '.')) return null;
    if (!/^\/(index\.html|style\.css|(?:core|renderer)\/[A-Za-z0-9_-]+\.js|vendor\/(?:marked|katex|prism)\.js|vendor\/pdfjs\/(?:pdf|pdf\.worker)\.mjs)$/.test(decoded)) return null;
    return decoded.slice(1);
  } catch { return null; }
}
export function publicError(error: unknown): string {
  if (error instanceof InputError) return error.message;
  const status = error && typeof error === 'object' ? (error as Record<string, unknown>).status : undefined;
  if (status === 401 || status === 403) return 'API authentication was rejected. Check your Tinfoil API key and API access.';
  if (status === 402) return 'API credit or billing is required. Check the Tinfoil dashboard.';
  if (status === 429) return 'The API rate or usage limit was reached. Retry later; requests are not retried automatically.';
  if (status === 400 || status === 404 || status === 422) return 'The model, context size, or generation settings were rejected. Check the model ID and try provider-default sampling.';
  if (typeof status === 'number' && status >= 500) return 'The provider returned a server error. Retry in a new branch.';
  return networkFailure(error) ?? 'The secure request failed. Check connectivity and enclave verification. No unverified fallback was used.';
}
/** A failure without an HTTP status that is a network problem: the SDK's connection errors ("Connection error.",
 * "Request timed out."), fetch TypeErrors and Node/undici socket codes. The code names the failure, never its data. */
export function networkFailure(error: unknown): string | null {
  if (!error || typeof error !== 'object') return null;
  const e = error as { status?: unknown; message?: unknown; code?: unknown; cause?: { code?: unknown; cause?: { code?: unknown } } };
  if (e.status !== undefined && e.status !== null) return null;
  const message = typeof e.message === 'string' ? e.message : '';
  if (message === 'Request timed out.') return 'The request to Tinfoil timed out before a response arrived. Check your connection and try again. No unverified fallback was used.';
  const code = [e.cause?.code, e.cause?.cause?.code, e.code].find((c): c is string => typeof c === 'string' && /^[A-Z][A-Z0-9_]{2,40}$/.test(c));
  if (code || message === 'Connection error.' || (error instanceof TypeError && /fetch failed|failed to fetch|network ?error|load failed|network request failed/i.test(message)))
    return `Tinfoil could not be reached${code ? ` (${code})` : ''}. Check your connection and try again. No unverified fallback was used.`;
  return null;
}
