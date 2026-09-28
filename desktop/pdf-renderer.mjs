import { BrowserWindow, session } from 'electron';
import { randomUUID } from 'node:crypto';
import { printableDocument } from '../dist/core/pdf-document.js';
import { InputError } from '../dist/core/validation.js';
/** Print only. No IPC, preload, JavaScript, remote resources or filesystem URLs. */
export async function renderPDF({html,signal}) {
  if(signal?.aborted)throw new InputError('PDF generation cancelled.');
  const document=printableDocument(html);
  const isolated=session.fromPartition('pdf-'+randomUUID(),{cache:false});
  isolated.setPermissionCheckHandler(()=>false);
  isolated.setPermissionRequestHandler((_wc,_permission,cb)=>cb(false));
  isolated.on('will-download',e=>e.preventDefault());
  const target='data:text/html;charset=utf-8,'+encodeURIComponent(document);
  isolated.webRequest.onBeforeRequest((details,cb)=>cb({cancel:details.url!==target && !(details.resourceType==='image'&&details.url.startsWith('data:image/'))}));
  const win=new BrowserWindow({show:false,width:1000,height:900,webPreferences:{session:isolated,nodeIntegration:false,contextIsolation:true,sandbox:true,javascript:false,webSecurity:true,webviewTag:false,spellcheck:false}});
  win.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  win.webContents.on('will-navigate',event=>event.preventDefault());
  win.webContents.on('will-frame-navigate',event=>event.preventDefault());
  let timer,stop;
  const cancelled=new Promise((_,reject)=>{stop=()=>{if(!win.isDestroyed())win.destroy();reject(new InputError('PDF generation cancelled or timed out.'));};timer=setTimeout(stop,20000);signal?.addEventListener('abort',stop,{once:true});});
  try {
    return await Promise.race([(async()=>{await win.loadURL(target);const data=await win.webContents.printToPDF({printBackground:true,preferCSSPageSize:true,pageSize:'A4',generateTaggedPDF:true});if(data.length>2*1024*1024)throw new InputError('PDF output exceeds the 2 MiB artifact limit.');return data;})(),cancelled]);
  } finally {clearTimeout(timer);signal?.removeEventListener('abort',stop);if(!win.isDestroyed())win.destroy();await isolated.clearStorageData().catch(()=>{});}
}
