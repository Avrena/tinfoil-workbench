import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root=dirname(dirname(fileURLToPath(import.meta.url)));
const port=Number(process.env.PORT||4173);
const server=createServer(async(req,res)=>{
  try{
    const path=new URL(req.url,'http://localhost').pathname;
    let file;
    if(path==='/'||path==='/index.html')file='dist/index.html';
    else if(path==='/preview/bridge.mjs')file='scripts/preview-bridge.mjs';
    else if(/^\/(style\.css|(?:core|renderer|vendor)\/[A-Za-z0-9_-]+\.js)$/.test(path))file='dist'+path;
    else {res.writeHead(404);res.end();return;}
    let body=await readFile(join(root,file));
    if(file==='dist/index.html')body=Buffer.from(body.toString().replace('<script type="module" src="/renderer/app.js"></script>','<script type="module" src="/preview/bridge.mjs"></script><script type="module" src="/renderer/app.js"></script>'));
    res.writeHead(200,{'Content-Type':file.endsWith('.html')?'text/html; charset=utf-8':file.endsWith('.css')?'text/css; charset=utf-8':'text/javascript; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(body);
  }catch{res.writeHead(500);res.end('Preview could not load. Run npm run build first.');}
});
server.listen(port,'127.0.0.1',()=>console.log(`Offline sample-data preview: http://127.0.0.1:${port}\nNo API requests, attestation, saved history, or desktop privileges.`));
