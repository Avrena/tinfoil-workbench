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
  // Cloud sync errors say what failed and name at most a status code, never data. Their HTTP status is the sync
  // service's, not a model provider's, so the provider messages below would misname them.
  if (error instanceof Error && error.name === 'CloudError') return error.message;
  const status = error && typeof error === 'object' ? (error as Record<string, unknown>).status : undefined;
  if (status === 401 || status === 403) return 'API authentication was rejected. Check your Tinfoil API key and API access.';
  if (status === 402) return 'API credit or billing is required. Check the Tinfoil dashboard.';
  if (status === 429) return 'The API rate or usage limit was reached. Retry later; requests are not retried automatically.';
  if (status === 400 || status === 404 || status === 422) return 'The model, context size, or generation settings were rejected. Check the model ID and try provider-default sampling.';
  if (typeof status === 'number' && status >= 500) return 'The provider returned a server error. Retry in a new branch.';
  const code = errorCode(error);
  return moduleFailure(error) ?? networkFailure(error) ?? `The secure request failed${code ? ` (${code})` : ''}. Check connectivity and enclave verification. No unverified fallback was used.`;
}
/** The first error code on the error's causes or the error itself. The code names the failure, never its data. */
function errorCode(error: unknown): string | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const e = error as { code?: unknown; cause?: { code?: unknown; cause?: { code?: unknown } } };
  return [e.cause?.code, e.cause?.cause?.code, e.code].find((c): c is string => typeof c === 'string' && /^[A-Z][A-Z0-9_]{2,40}$/.test(c));
}
/** Node's codes for a module that cannot be found or loaded: part of the installed app is missing or damaged. */
const MODULE_CODES = /^(?:ERR_(?:MODULE_NOT_FOUND|PACKAGE_PATH_NOT_EXPORTED|PACKAGE_IMPORT_NOT_DEFINED|UNSUPPORTED_DIR_IMPORT|UNKNOWN_FILE_EXTENSION|INVALID_PACKAGE_CONFIG|INVALID_MODULE_SPECIFIER|REQUIRE_ESM)|MODULE_NOT_FOUND)$/;
/** Socket, DNS, TLS and certificate codes from Node, undici and OpenSSL. File access, module and programming
 * errors carry codes too; they are not network failures and are never reported as one. */
const NETWORK_CODES = /^(?:E(?:CONNRESET|CONNREFUSED|CONNABORTED|NOTFOUND|TIMEDOUT|HOSTUNREACH|HOSTDOWN|NETUNREACH|NETDOWN|NETRESET|PIPE|PROTO|ADDRNOTAVAIL|AI_[A-Z]+)|UND_ERR_[A-Z_]+|ERR_(?:TLS|SSL|SOCKET|HTTP2)_[A-Z0-9_]+|ERR_STREAM_PREMATURE_CLOSE|CERT_[A-Z_]+|UNABLE_TO_[A-Z_]+|DEPTH_ZERO_SELF_SIGNED_CERT|SELF_SIGNED_CERT_IN_CHAIN)$/;
/** A module of the attested SDK could not be loaded, so no connection could start. */
export function moduleFailure(error: unknown): string | null {
  const code = errorCode(error);
  return code && MODULE_CODES.test(code) ? `Workbench could not load part of its secure connection code (${code}). Reinstall or update Workbench. Nothing was sent.` : null;
}
/** A failure without an HTTP status that is a network problem: the SDK's connection errors ("Connection error.",
 * "Request timed out."), fetch TypeErrors and socket, DNS and TLS codes. */
export function networkFailure(error: unknown): string | null {
  if (!error || typeof error !== 'object') return null;
  const e = error as { status?: unknown; message?: unknown };
  if (e.status !== undefined && e.status !== null) return null;
  const message = typeof e.message === 'string' ? e.message : '';
  if (message === 'Request timed out.') return 'The request to Tinfoil timed out before a response arrived. Check your connection and try again. No unverified fallback was used.';
  const code = errorCode(error);
  const connection = message === 'Connection error.' || (error instanceof TypeError && /fetch failed|failed to fetch|network ?error|load failed|network request failed/i.test(message));
  if ((code && NETWORK_CODES.test(code)) || connection)
    return `Tinfoil could not be reached${code ? ` (${code})` : ''}. Check your connection and try again. No unverified fallback was used.`;
  return null;
}
