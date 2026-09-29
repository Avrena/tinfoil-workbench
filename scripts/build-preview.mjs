import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { transformSync } from 'esbuild';
const root=dirname(dirname(fileURLToPath(import.meta.url)));
const seen=new Set(),modules=[];
async function collect(id){
  if(seen.has(id))return;seen.add(id);
  const source=await readFile(join(root,id==='/preview/bridge.mjs'?'scripts/preview-bridge.mjs':'dist'+id),'utf8');
  // The single-file preview loads each module as CommonJS from a map. Dynamic import() becomes require(), so
  // PDF.js, which the preview does not include, fails through the same loader. esbuild's exports are read-only
  // live bindings; load() hands every importer one proxy per module that reads them and keeps replacements that
  // browser tests assign (to count calls), as TypeScript's CommonJS output allowed.
  const compiled=transformSync(source,{loader:'js',format:'cjs',target:'es2022',supported:{'dynamic-import':false}}).code;
  for(const match of compiled.matchAll(/require\(["']([^"']+)["']\)/g)){
    if(!match[1].startsWith('.')&&!match[1].startsWith('/'))throw Error('Unexpected preview dependency');
    await collect(new URL(match[1],'https://preview.invalid'+id).pathname);
  }
  modules.push(`${JSON.stringify(id)}: (module,exports,require) => {\n${compiled}\n}`);
}
await collect('/preview/bridge.mjs');await collect('/renderer/app.js');
const runtime=`if(!crypto.randomUUID)crypto.randomUUID=()=>{const b=crypto.getRandomValues(new Uint8Array(16));b[6]=(b[6]&15)|64;b[8]=(b[8]&63)|128;const h=Array.from(b,x=>x.toString(16).padStart(2,'0')).join('');return h.slice(0,8)+'-'+h.slice(8,12)+'-'+h.slice(12,16)+'-'+h.slice(16,20)+'-'+h.slice(20);};const modules={${modules.join(',\n')}};const cache={};function load(id){if(cache[id])return cache[id];if(!modules[id])throw Error('Missing preview module '+id);const module={exports:{}},patched={},own=k=>k in patched||Object.prototype.hasOwnProperty.call(module.exports,k),read=k=>k in patched?patched[k]:module.exports[k];cache[id]=new Proxy({},{get:(_,k)=>read(k),set:(_,k,v)=>{patched[k]=v;return true;},has:(_,k)=>k in patched||k in module.exports,ownKeys:()=>[...new Set([...Reflect.ownKeys(module.exports),...Reflect.ownKeys(patched)])],getOwnPropertyDescriptor:(_,k)=>own(k)?{value:read(k),writable:true,enumerable:true,configurable:true}:undefined});modules[id](module,module.exports,path=>load(new URL(path,'https://preview.invalid'+id).pathname));return cache[id];}load('/preview/bridge.mjs');load('/renderer/app.js');`;
let html=await readFile(join(root,'dist/index.html'),'utf8');
html=html.replace("script-src 'self'","script-src 'nonce-workbench-preview'").replace("style-src 'self'","style-src 'nonce-workbench-preview'");
const css=await readFile(join(root,'dist/style.css'),'utf8');
html=html.replace('<link rel="stylesheet" href="/style.css">',()=>`<style nonce="workbench-preview">${css.replaceAll('</style','<\\/style')}</style>`)
  .replace('<script type="module" src="/renderer/app.js"></script>',()=>`<script nonce="workbench-preview">(()=>{${runtime.replaceAll('</script','<\\/script')}})();</script>`);
await mkdir(join(root,'preview'),{recursive:true});await writeFile(join(root,'preview/index.html'),html);
console.log('Built preview/index.html. Synthetic, memory-only data; no API access or Python execution.');
