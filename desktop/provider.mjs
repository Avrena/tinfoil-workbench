/** The renderer cannot import or construct a provider. Do not add an unverified HTTP fallback. */
export async function createProvider(apiKey, cacheSecret, mode='api-key') {
  const { TinfoilAI } = await import('tinfoil');
  return new TinfoilAI({
    ...(mode==='chat-account'?{bearerToken:apiKey}:{apiKey}),
    userCacheSecret: cacheSecret, // Avoid the SDK creating its own plaintext per-user cache-secret file.
    transport: 'ehbp',
    maxRetries: 0, // Retrying a charged generation must be an explicit user decision.
    timeout: 600_000,
    logLevel: 'off',
  });
}
