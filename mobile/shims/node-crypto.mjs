// The shared service and visual runtime import only randomUUID from node:crypto.
// Web Crypto provides it in secure contexts, including dedicated workers.
export const randomUUID = () => globalThis.crypto.randomUUID();
export default { randomUUID };
