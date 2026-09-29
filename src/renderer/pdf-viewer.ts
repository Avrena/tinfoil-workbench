/** PDF.js is copied from the pinned npm dependency during bootstrap/build.
 * PDFs are rendered as canvas/text only. No actions, attachments or form scripts run. */
/** PDF.js 6 supports Chromium 125 and newer. CSS stepped-value functions such as round() shipped in the same
 * version, so they identify an older engine (an Android WebView that cannot update) before PDF.js fails inside it. */
export const pdfEngineSupported=()=>typeof CSS!=='undefined'&&CSS.supports('width','round(1px, 1px)');
export const PDF_ENGINE_TOO_OLD='PDF preview needs a newer browser engine (Chromium 125 or later). On Android, update Android System WebView, or save this PDF to open it in another app.';
export async function mountPDF(container:HTMLElement,bytes:Uint8Array,alive:()=>boolean):Promise<()=>void> {
  let destroyed=false,doc:any,loading:any,task:any;
  const cleanup=()=>{destroyed=true;try{task?.cancel();void loading?.destroy();}catch{/* Already destroyed. */}};
  const status=document.createElement('p');status.className='muted';status.textContent='Loading PDF…';container.append(status);
  if(!pdfEngineSupported()){status.textContent=PDF_ENGINE_TOO_OLD;cleanup();return cleanup;}
  let pdf:any;
  try {
    const entry='/vendor/pdfjs/pdf.mjs';
    pdf=await import(/* @vite-ignore */ entry);
  } catch {if(alive()&&!destroyed)status.textContent='PDF preview could not load. Run npm run bootstrap to install the bundled PDF.js renderer, or save this PDF to inspect it externally.';cleanup();return cleanup;}
  try {
    if(!alive()){cleanup();return cleanup;}
    pdf.GlobalWorkerOptions.workerSrc='/vendor/pdfjs/pdf.worker.mjs';
    loading=pdf.getDocument({data:bytes,isEvalSupported:false,enableXfa:false,useSystemFonts:true,
      useWasm:false,isOffscreenCanvasSupported:false,isImageDecoderSupported:false,
      disableAutoFetch:true,disableStream:true,maxImageSize:16000000,verbosity:0});
    loading.onPassword=()=>{status.textContent='Password-protected PDFs are not supported in this viewer.';cleanup();};
    doc=await loading.promise;
    if(!alive()||destroyed){cleanup();return cleanup;}
    let pageNumber=1,zoom=1,generation=0;
    const controls=document.createElement('div');controls.className='pdf-controls';
    const prev=document.createElement('button'),next=document.createElement('button'),label=document.createElement('span'),scale=document.createElement('select');
    prev.textContent='Previous';next.textContent='Next';scale.setAttribute('aria-label','PDF zoom');
    for(const value of [.75,1,1.25,1.5,2]){const o=document.createElement('option');o.value=String(value);o.textContent=Math.round(value*100)+'%';o.selected=value===1;scale.append(o);}
    controls.append(prev,label,next,scale);
    const stage=document.createElement('div');stage.className='pdf-page';const text=document.createElement('details'),summary=document.createElement('summary'),textBody=document.createElement('pre');
    summary.textContent='Page text';text.append(summary,textBody);textBody.className='pdf-text';
    container.replaceChildren(controls,stage,text);
    async function paint(){
      const token=++generation;task?.cancel();prev.disabled=pageNumber<=1;next.disabled=pageNumber>=doc.numPages;label.textContent=`Page ${pageNumber} of ${doc.numPages}`;
      try {
        const page=await doc.getPage(pageNumber);if(token!==generation||destroyed||!alive())return;
        const viewport=page.getViewport({scale:zoom*1.3});
        const factor=Math.min(1,Math.sqrt(16000000/(viewport.width*viewport.height)));
        const bounded=page.getViewport({scale:zoom*1.3*factor});
        const canvas=document.createElement('canvas');canvas.width=Math.ceil(bounded.width);canvas.height=Math.ceil(bounded.height);canvas.setAttribute('aria-label',`PDF page ${pageNumber}`);stage.replaceChildren(canvas);
        task=page.render({canvasContext:canvas.getContext('2d'),viewport:bounded,annotationMode:0});await task.promise;
        const content=await page.getTextContent();if(token!==generation||destroyed)return;
        textBody.textContent=content.items.map((s:any)=>s.str??'').join(' ').slice(0,100000);
      } catch(error){if((error as Error).name!=='RenderingCancelledException'&&token===generation&&!destroyed)stage.textContent='This PDF page could not be rendered.';}
    }
    prev.onclick=()=>{pageNumber=Math.max(1,pageNumber-1);void paint();};next.onclick=()=>{pageNumber=Math.min(doc.numPages,pageNumber+1);void paint();};scale.onchange=()=>{zoom=Number(scale.value);void paint();};
    await paint();return cleanup;
  } catch {if(alive()&&!destroyed)status.textContent='This PDF could not be opened. Save it to inspect it in another app.';cleanup();return cleanup;}
}
