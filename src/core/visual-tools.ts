import { InputError, record, text, identifier } from './validation.js';
import { escapeHtml as escape } from './markdown.js';
import type { Artifact } from './types.js';
const string = { type: 'string' };
const makeTool = (name: string, description: string, properties: Record<string, unknown>, required: string[]) => ({ type: 'function', function: { name, description, parameters: { type: 'object', properties, required, additionalProperties: false } } });
const primitive = { type: ['string','number','boolean','null'] };
const shared = { title: string, description: { type: 'string', description: 'Accessible description and data/source caveats. Do not imply generated data are observations.' } };
export const VISUAL_TOOLS = [
  makeTool('render_chart', 'Create an interactive chart artifact inline in the answer (expandable into the workspace) without running Python. The reader can toggle series and inspect the data table. Supply actual numeric values, never JavaScript or remote URLs.', { ...shared, type: { type:'string', enum:['line','bar','area','scatter'] }, labels: { type:'array', items:string, maxItems:200 }, x_values: { type:'array', items:{type:'number'}, maxItems:200 }, x_label:string, y_label:string, series: { type:'array', maxItems:8, items:{ type:'object', properties:{ name:string, values:{type:'array',items:{type:['number','null']},maxItems:200}},required:['name','values'],additionalProperties:false } } }, ['title','type','labels','series']),
  makeTool('render_table', 'Create a sortable, searchable table artifact. Values are data, never executable expressions. Maximum 500 rows and 20 columns. Use null for missing values.', { ...shared, columns:{type:'array',items:string,maxItems:20}, rows:{type:'array',maxItems:500,items:{type:'array',items:primitive,maxItems:20}} }, ['title','columns','rows']),
  makeTool('render_diagram', 'Create a labelled directed diagram from nodes and edges inline in the answer (expandable into the workspace). Layout is a simple grid or explicitly supplied column/row coordinates (0..15), not a full Mermaid layout engine. Maximum 50 nodes and 100 edges. Text is escaped.', { ...shared, nodes:{type:'array',maxItems:50,items:{type:'object',properties:{id:string,label:string,column:{type:'integer',minimum:0,maximum:15},row:{type:'integer',minimum:0,maximum:15}},required:['id','label'],additionalProperties:false}}, edges:{type:'array',maxItems:100,items:{type:'object',properties:{from:string,to:string,label:string},required:['from','to'],additionalProperties:false}} }, ['title','nodes','edges']),
  makeTool('create_artifact', 'Create a versioned HTML, SVG, Markdown, JSON, text or PDF artifact. PDF source is a self-contained HTML document, not base64. HTML previews are static by default; the user can enable isolated inline JavaScript for that preview. Use addEventListener in an inline script; inline event attributes, eval, modules and external scripts are unsupported. No network, external libraries, local files, or bridge APIs. Inline CSS and system fonts only. PDF generation runs without JavaScript. For inline visualizations use a transparent background (or neutral grey #252526), text #d4d4d4, system fonts and small VS Code-style accent colors. Blend into the answer: no outer card, border, shadow or large padded panel. Prefer the structured chart/table/diagram tools over custom HTML or Python when sufficient; they are cheaper to render and need less source. PDF pages may keep a print-appropriate white background. Preserve user-requested and authored colors. The preview appears inline with the response. This creates an in-app artifact, not a file on disk.', {...shared, kind:{type:'string',enum:['html','svg','markdown','json','text','pdf']}, source:{type:'string',description:'Complete UTF-8 source, at most 100,000 characters. For PDF, provide HTML with print CSS and page breaks.'}}, ['title','kind','source']),
  makeTool('update_artifact', 'Create a new immutable revision of an artifact visible in this conversation. Provide its returned artifact_id and complete replacement source. For chart/table/diagram source is the JSON specification. Older versions stay available. Do not change the kind.', { artifact_id:string, source:string, title:string, description:string }, ['artifact_id','source']),
  makeTool('read_artifact', 'Read bounded original source and metadata for an artifact from the selected conversation history or this response. This does not view rendered pixels, execute code, or inspect arbitrary local files. Binary artifacts without source return metadata only.', { artifact_id:string }, ['artifact_id']),
];
export const VISUAL_TOOL_NAMES = new Set(VISUAL_TOOLS.map(t=>t.function.name));
export type Cell = string | number | boolean | null;
export interface TableSpec { title:string; description:string; columns:string[]; rows:Cell[][] }
export interface ChartSpec { title:string; description:string; type:'line'|'bar'|'area'|'scatter'; labels:string[]; x_values?:number[]; x_label:string; y_label:string; series:{name:string;values:(number|null)[]}[] }
export interface DiagramSpec { title:string; description:string; nodes:{id:string;label:string;column:number;row:number}[]; edges:{from:string;to:string;label:string}[] }
function array(v: unknown, max: number, label: string): unknown[] { if (!Array.isArray(v)||v.length>max) throw new InputError(`${label} exceeds its size limit or is not an array.`); return v; }
function finite(v: unknown): number { if (typeof v!=='number'||!Number.isFinite(v)||Math.abs(v)>1e12) throw new InputError('Visualization values must be finite numbers between -1e12 and 1e12.');return v; }
function description(v: unknown):string {return v===undefined?'':text(v,'Description',2000);}
export function visualArguments(raw: string):Record<string, unknown>{
  if(raw.length>120000)throw new InputError('Visualization arguments exceed 120,000 characters.');
  try{return record(JSON.parse(raw));}catch(error){if(error instanceof InputError)throw error;throw new InputError('The model supplied invalid visualization JSON.');}
}
export function chartSpec(value:unknown):ChartSpec {
  const v=record(value), title=text(v.title,'Chart title',160,true), labels=array(v.labels,200,'Chart labels').map(x=>text(x,'Label',120));
  if(!labels.length||!['line','bar','area','scatter'].includes(String(v.type)))throw new InputError('Choose a supported chart type and at least one data label.');
  const series=array(v.series,8,'Chart series').map(item=>{const s=record(item);const values=array(s.values,200,'Chart values').map(x=>x===null?null:finite(x));if(values.length!==labels.length)throw new InputError('Every series must have exactly one value per label.');return{name:text(s.name,'Series name',100,true),values};});
  if(!series.length||!series.some(s=>s.values.some(v=>v!==null)))throw new InputError('The chart needs at least one numeric value.');
  let x_values:number[]|undefined;
  if(v.x_values!==undefined){x_values=array(v.x_values,200,'X values').map(finite);if(x_values.length!==labels.length)throw new InputError('X values must match labels.');}
  return {title,description:description(v.description),type:v.type as ChartSpec['type'],labels,series,...(x_values?{x_values}:{}),x_label:v.x_label===undefined?'':text(v.x_label,'X axis label',100),y_label:v.y_label===undefined?'':text(v.y_label,'Y axis label',100)};
}
export function tableSpec(value:unknown):TableSpec {
  const v=record(value),columns=array(v.columns,20,'Columns').map(x=>text(x,'Column name',100,true));
  if(!columns.length)throw new InputError('A table needs at least one column.');
  const rows=array(v.rows,500,'Table rows').map(row=>{const cells=array(row,20,'Cells');if(cells.length!==columns.length)throw new InputError('Every row must match the column count.');return cells.map(x=>x===null||typeof x==='boolean'?x:typeof x==='number'?finite(x):text(x,'Cell',2000));});
  return {title:text(v.title,'Table title',160,true),description:description(v.description),columns,rows};
}
export function diagramSpec(value:unknown):DiagramSpec {
  const v=record(value);const nodes=array(v.nodes,50,'Nodes').map((item,i)=>{const n=record(item);const column=n.column??(i%4),row=n.row??Math.floor(i/4);if(!Number.isInteger(column)||!Number.isInteger(row)||Number(column)<0||Number(column)>15||Number(row)<0||Number(row)>15)throw new InputError('Diagram grid positions must be small nonnegative integers.');return{id:identifier(n.id),label:text(n.label,'Node label',120,true),column:Number(column),row:Number(row)};});
  const ids=new Set(nodes.map(n=>n.id));if(!nodes.length||ids.size!==nodes.length)throw new InputError('Diagram node IDs must be unique.');
  if(new Set(nodes.map(n=>`${n.row},${n.column}`)).size!==nodes.length)throw new InputError('Diagram nodes must occupy different grid positions.');
  const edges=array(v.edges,100,'Edges').map(item=>{const a=record(item);if(!ids.has(String(a.from))||!ids.has(String(a.to)))throw new InputError('A diagram edge refers to a missing node.');return{from:String(a.from),to:String(a.to),label:a.label===undefined?'':text(a.label,'Edge label',100)};});
  return{title:text(v.title,'Diagram title',160,true),description:description(v.description),nodes,edges};
}
export function tableHTML(spec:TableSpec):string {return `<table><caption>${escape(spec.title)}</caption><thead><tr>${spec.columns.map(c=>`<th scope="col">${escape(c)}</th>`).join('')}</tr></thead><tbody>${spec.rows.map(r=>`<tr>${r.map(c=>`<td>${escape(c===null?'—':String(c))}</td>`).join('')}</tr>`).join('')}</tbody></table>`;}
export const visualPalette=['#75b9ff','#b7a6f5','#4ec9b0','#dcdcaa','#ce9178','#9cdcfe','#b5cea8','#d7e2f1'];
const palette=visualPalette;
const f=(n:number)=>Number(n.toFixed(2));
const baseSVG=(title:string,desc:string,w:number,h:number,body:string)=>`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" role="img" aria-label="${escape(title)}"><title>${escape(title)}</title><desc>${escape(desc)}</desc>${body}</svg>`;
export function chartSVG(spec:ChartSpec,hidden:number[]=[],options:{heading?:boolean;compact?:boolean;print?:boolean;width?:number;tight?:boolean}={}):string {
  const visible=spec.series.map((s,i)=>({...s,index:i})).filter(s=>!hidden.includes(s.index)), values=visible.flatMap(s=>s.values.filter((v):v is number=>v!==null));
  let low=Math.min(...values,0),high=Math.max(...values,0);if(low===high){low-=1;high+=1;}
  const minX=spec.x_values?Math.min(...spec.x_values):0,maxX=spec.x_values?Math.max(...spec.x_values):Math.max(1,spec.labels.length-1);
  const heading=options.heading!==false;
  const w=options.print?780:Math.max(300,Math.min(780,Number.isFinite(options.width)?options.width!:780)),narrow=w<500;
  // Inline previews already supply a title and an external legend. Reclaim the
  // unused axis-title band, without shrinking data geometry or print exports.
  const tight=!!options.tight&&!heading&&!options.print;
  const blankAxis=tight&&!spec.x_label?(narrow?18:28):0;
  const topTrim=tight?8:0;
  const h=(heading?430:narrow?250:options.compact?280:340)-blankAxis-topTrim;
  const left=narrow?62:76,right=narrow?22:28,top=(heading?64:24)-topTrim;
  const bottom=(narrow?54:64)-blankAxis,pw=w-left-right,ph=h-top-bottom;
  const x=(i:number)=>spec.type==='bar'?left+pw*(i+.5)/spec.labels.length:left+pw*((spec.x_values?.[i]??i)-minX)/(maxX-minX||1);
  const y=(n:number)=>top+ph*(1-(n-low)/(high-low));
  let out=heading?`<text x="${left}" y="28" fill="#d4d4d4" font-family="system-ui" font-size="17">${escape(spec.title)}</text>`:"";
  for(let n=0;n<=4;n++){const value=low+(high-low)*n/4,yy=f(y(value));out+=`<line x1="${left}" y1="${yy}" x2="${w-right}" y2="${yy}" stroke="#363636"/><text x="${left-10}" y="${yy+4}" text-anchor="end" fill="#a6a6a6" font-family="system-ui" font-size="11">${escape(Number(value.toPrecision(5)).toLocaleString('en-US'))}</text>`;}
  spec.labels.forEach((label,i)=>{if(i%Math.max(1,Math.ceil(spec.labels.length/Math.max(2,Math.floor(pw/70))))===0||i===spec.labels.length-1)out+=`<text x="${f(x(i))}" y="${h-bottom+24}" text-anchor="middle" fill="#a6a6a6" font-family="system-ui" font-size="11">${escape(label.length>(narrow?10:20)?label.slice(0,narrow?9:18)+'…':label)}</text>`;});
  visible.forEach((s,si)=>{
    out+=`<g data-key="series-${s.index}" data-series="${s.index}">`;
    const color=palette[s.index%palette.length];let segment:{i:number;v:number}[]=[];
    const flush=()=>{if(!segment.length)return;const points=segment.map(p=>`${f(x(p.i))},${f(y(p.v))}`).join(' ');if(spec.type==='area')out+=`<polygon points="${f(x(segment[0]!.i))},${f(y(0))} ${points} ${f(x(segment.at(-1)!.i))},${f(y(0))}" fill="${color}" opacity="0.14" class="chart-area"/>`;if(spec.type!=='scatter'&&spec.type!=='bar')out+=`<polyline points="${points}" fill="none" stroke="${color}" stroke-width="2.5" class="chart-line" pathLength="1"/>`;if(spec.labels.length>80&&spec.type!=='scatter'&&spec.type!=='bar'&&segment.length===1){const p=segment[0]!;out+=`<circle cx="${f(x(p.i))}" cy="${f(y(p.v))}" r="3" fill="${color}"><title>${escape(s.name+': '+p.v)}</title></circle>`;}segment=[];};
    s.values.forEach((v,i)=>{if(v===null){flush();return;}segment.push({i,v});const tooltip=escape(`${s.name} · ${spec.labels[i]}: ${v}`);if(spec.type==='bar'){const bw=Math.min(70,pw/spec.labels.length*.75)/Math.max(1,visible.length),xx=x(i)-bw*visible.length/2+bw*si;out+=`<rect x="${f(xx)}" y="${f(Math.min(y(v),y(0)))}" width="${f(Math.max(.3,bw-1))}" height="${f(Math.max(.3,Math.abs(y(v)-y(0))))}" fill="${color}" class="chart-mark"><title>${tooltip}</title></rect>`;}else if(spec.type==='scatter'||spec.labels.length<=80)out+=`<circle cx="${f(x(i))}" cy="${f(y(v))}" r="${spec.type==='scatter'?4:3}" fill="${color}" class="chart-mark"><title>${tooltip}</title></circle>`;});flush();out+='</g>';
  });
  out+=`<text x="${left+pw/2}" y="${h-16}" text-anchor="middle" fill="#a6a6a6" font-family="system-ui" font-size="12">${escape(spec.x_label)}</text><text x="18" y="${top+ph/2}" transform="rotate(-90 18 ${top+ph/2})" text-anchor="middle" fill="#a6a6a6" font-family="system-ui" font-size="12">${escape(spec.y_label)}</text>`;
  const svg=baseSVG(spec.title,spec.description,w,h,out);return options.print?printVisualSVG(svg):svg;
}
export function diagramSVG(spec:DiagramSpec,markerId='arrow',heading=true,print=false):string {
  markerId=markerId.replace(/[^a-zA-Z0-9_-]/g,'');
  const lastRow=Math.max(...spec.nodes.map(n=>n.row));
  const w=Math.max(600,(Math.max(...spec.nodes.map(n=>n.column))+1)*230+40);
  // Heading-free host previews have their own title. Do not reserve an empty
  // heading or a whole extra row; preserve the standalone/print geometry.
  const top=heading?90:24,h=heading?(lastRow+1)*130+95:top+lastRow*130+55+24;
  const position=(id:string)=>{const n=spec.nodes.find(n=>n.id===id)!;return{x:40+n.column*230,y:top+n.row*130};};
  let out=`<defs><marker id="${markerId}" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0 0L8 4L0 8z" fill="#75b9ff"/></marker></defs>${heading?`<text x="40" y="34" font-size="20" fill="#d4d4d4" font-family="system-ui">${escape(spec.title)}</text>`:""}`;
  for(const edge of spec.edges){const a=position(edge.from),b=position(edge.to);const downward=b.y>a.y;const x1=a.x+90,y1=a.y+(downward?55:25),x2=b.x+90,y2=b.y+(downward?0:25);out+=`<path d="M${x1} ${y1} C${x1} ${(y1+y2)/2} ${x2} ${(y1+y2)/2} ${x2} ${y2}" fill="none" stroke="#75b9ff" stroke-width="1.8" marker-end="url(#${markerId})"/><text x="${(x1+x2)/2+8}" y="${(y1+y2)/2-8}" fill="#b8b8b8" font-size="11" font-family="system-ui">${escape(edge.label)}</text>`;}
  for(const n of spec.nodes){const {x,y}=position(n.id);out+=`<rect x="${x}" y="${y}" width="180" height="55" rx="8" fill="#292929" stroke="#555555"/><text x="${x+90}" y="${y+31}" text-anchor="middle" fill="#d4d4d4" font-size="12" font-family="system-ui"><title>${escape(n.label)}</title>${escape(n.label.length>24?n.label.slice(0,22)+'…':n.label)}</text>`;}
  const svg=baseSVG(spec.title,spec.description,w,h,out);return print?printVisualSVG(svg):svg;
}
/** Only applied to our structured SVG renderer, never an authored document. */
function printVisualSVG(svg:string):string {
  const colors:Record<string,string>={'#d4d4d4':'#242424','#363636':'#d0d0d0','#a6a6a6':'#555555','#b8b8b8':'#555555','#292929':'#f2f2f2','#555555':'#888888','#75b9ff':'#0072b2','#b7a6f5':'#7354a6','#4ec9b0':'#00876c','#dcdcaa':'#8a7200','#ce9178':'#a44d24','#9cdcfe':'#007da4','#b5cea8':'#54733d','#d7e2f1':'#585858'};
  return svg.replace(/(fill|stroke)="(#[a-f0-9]{6})"/g,(attribute,kind,color)=>colors[color]?`${kind}="${colors[color]}"`:attribute);
}
export function artifactSource(a:Artifact):string|null {
  if(a.source!==undefined)return a.source;
  if(a.mime==='application/pdf'||a.mime==='image/png')return null;
  try{return new TextDecoder().decode(Uint8Array.from(atob(a.data),c=>c.charCodeAt(0)));}catch{return null;}
}
