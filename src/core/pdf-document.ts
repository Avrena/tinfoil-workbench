import { InputError } from './validation.js';
/** Rendering is also done in a no-preload, JavaScript-disabled BrowserWindow. */
export function printableDocument(source:string):string {
  if(typeof source!=='string'||source.length>120000)throw new InputError('PDF source exceeds the size limit.');
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'"><style>@page{size:A4;margin:14mm}body{font:11pt/1.55 system-ui,sans-serif;color:#20242b;background:white;overflow-wrap:anywhere}h1,h2,h3{break-after:avoid}table{border-collapse:collapse;width:100%;font-size:10pt}th,td{border:1px solid #ccd1d9;padding:7px;text-align:left}thead{display:table-header-group}tr,img,svg{break-inside:avoid}img,svg{max-width:100%}pre{white-space:pre-wrap}a{color:inherit}</style></head><body>${source}</body></html>`;
}
