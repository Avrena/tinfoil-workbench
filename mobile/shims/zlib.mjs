// @tinfoilsh/verifier imports zlib only when DecompressionStream is missing. Android System
// WebView provides DecompressionStream, so this must never run; if it does, fail closed rather
// than skip attestation verification.
export function gunzipSync() {
  throw new Error('Attestation data cannot be decompressed in this WebView. Update Android System WebView.');
}
export default { gunzipSync };
