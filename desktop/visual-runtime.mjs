import { randomUUID } from 'node:crypto';
import { InputError, text, identifier, validateArtifact } from '../dist/core/validation.js';
import { visualArguments, structuredVisual, artifactSource, artifactFileName, RENDER_KINDS } from '../dist/core/visual-tools.js';

/** Pure artifact production except for an injected, script-free PDF renderer.
 * No model-selected filesystem paths, network destinations or code execution. */
export async function executeVisual(name, raw, { artifacts = [], pdfRenderer = null, signal } = {}) {
  if (signal?.aborted) throw new InputError('Artifact creation cancelled.');
  const args = visualArguments(raw);
  if (name === 'read_artifact') {
    const a = artifacts.find(a=>a.id===identifier(args.artifact_id));
    if (!a) throw new InputError('Artifact not found in the selected model-visible conversation history.');
    const source = artifactSource(a);
    return { artifacts: [], output: { artifact_id:a.id, title:a.title??a.name, kind:a.kind??a.mime, version:a.version??1,
      source:source?.slice(0,16000)??null, truncated:source!==null&&source.length>16000,
      note:source===null?'Binary artifact; no textual source is available.':'Original source only. No rendered-pixel inspection was performed.' } };
  }
  let kind, title, source, description='', parent;
  if(name==='update_artifact') {
    parent=artifacts.find(a=>a.id===identifier(args.artifact_id));
    if(!parent?.kind)throw new InputError('Only a typed artifact in the selected history can be revised.');
    kind=parent.kind;title=args.title===undefined?(parent.title??parent.name):text(args.title,'Title',160,true);
    source=text(args.source,'Replacement source',100000,true);description=args.description===undefined?(parent.description??''):text(args.description,'Description',2000);
  } else if(name==='create_artifact') {
    kind=args.kind;if(!['html','svg','markdown','json','text','pdf'].includes(kind))throw new InputError('Unsupported artifact kind.');
    title=text(args.title,'Artifact title',160,true);source=text(args.source,'Artifact source',100000,true);description=args.description===undefined?'':text(args.description,'Description',2000);
  } else if(Object.hasOwn(RENDER_KINDS,name)) {
    kind=RENDER_KINDS[name];title=text(args.title,'Artifact title',160,true);source=JSON.stringify(args);description=args.description===undefined?'':text(args.description,'Description',2000);
  } else throw new InputError('Unregistered visualization tool.');
  let data,mime,ext;
  if(Object.values(RENDER_KINDS).includes(kind)) {
    let spec;try{spec=JSON.parse(source);}catch{throw new InputError('This artifact requires a JSON specification.');}
    ({spec,data,mime,ext}=structuredVisual(kind,{...spec,title,description}));
    source=JSON.stringify(spec);
  } else if(kind==='pdf') {
    if(!pdfRenderer)throw new InputError('PDF creation requires the desktop PDF renderer. No file was created.');
    data=await pdfRenderer({html:source,signal});mime='application/pdf';ext='pdf';
    if(!Buffer.isBuffer(data)||data.length>2*1024*1024||data.subarray(0,5).toString()!=='%PDF-')throw new InputError('The PDF renderer did not return a valid, bounded PDF.');
  } else {
    const formats={html:['text/html','html'],svg:['image/svg+xml','svg'],markdown:['text/markdown','md'],json:['application/json','json'],text:['text/plain','txt']};
    [mime,ext]=formats[kind];data=source;
    if(kind==='json'){try{JSON.parse(source);}catch{throw new InputError('JSON artifact source is not valid JSON.');}}
  }
  if(signal?.aborted)throw new InputError('Artifact creation cancelled.');
  const id=randomUUID();
  const a=validateArtifact({id,title,name:artifactFileName(title,ext),mime,kind,source,description,
    data:Buffer.from(data).toString('base64'),version:parent?Math.max(...artifacts.filter(a=>(a.rootId??a.id)===(parent.rootId??parent.id)).map(a=>a.version??1))+1:1,rootId:parent?.rootId??parent?.id??id,...(parent?{parentId:parent.id}:{})});
  return { artifacts:[a], output:{ artifact_id:a.id,kind:a.kind,title:a.title,version:a.version,
    note:kind==='pdf'?'PDF generated; inspect the inline preview or workspace to verify layout.':'Artifact created. The client renders it inline; it can also be expanded in the workspace.' } };
}
