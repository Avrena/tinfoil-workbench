// Injected into the worker bundle: desktop/visual-runtime.mjs and desktop/model-catalog.mjs use
// Node's global Buffer. The audited `buffer` package provides the same API in the browser.
export { Buffer } from 'buffer';
