import { InputError, record, text, identifier } from './validation.js';
import { escapeHtml as escape } from './markdown.js';
import type { Artifact } from './types.js';
const string = { type: 'string' };
const makeTool = (name: string, description: string, properties: Record<string, unknown>, required: string[]) => ({ type: 'function', function: { name, description, parameters: { type: 'object', properties, required, additionalProperties: false } } });
const primitive = { type: ['string','number','boolean','null'] };
const shared = { title: string, description: { type: 'string', description: 'Accessible description and data/source caveats. Do not imply generated data are observations.' } };
export const CHART_TYPES=['line','bar','area','scatter','pie'] as const;
/** Artifact kinds the app renders from a JSON specification; they have a Data view and never run scripts. */
export const STRUCTURED_KINDS=['chart','table','diagram','timeline','stats'] as const;
/** The structured tools and the artifact kind each creates. Names and argument shapes of the timeline and stat cards
 * follow Tinfoil Chat's widgets of the same name. */
export const RENDER_KINDS:Record<string,typeof STRUCTURED_KINDS[number]>={render_chart:'chart',render_table:'table',render_diagram:'diagram',render_timeline:'timeline',render_stat_cards:'stats'};
export const VISUAL_TOOLS = [
  makeTool('render_chart', 'Create an interactive chart inline in the answer (expandable into the workspace) without running Python: line, area, bar, scatter, or pie for one series of two to six parts of a total. Hovering shows every series at a point; the reader can toggle series and open the data table. Series that never share a label, such as reported values and a projection, are drawn as single centred bars. Supply actual numbers, never JavaScript or remote URLs.', { ...shared, type: { type:'string', enum:[...CHART_TYPES] }, labels: { type:'array', items:string, maxItems:200 }, x_values: { type:'array', items:{type:'number'}, maxItems:200, description:'Numeric x positions for line, area or scatter charts, one per label.' }, x_label:string, y_label:string, series: { type:'array', maxItems:8, items:{ type:'object', properties:{ name:string, values:{type:'array',items:{type:['number','null']},maxItems:200}},required:['name','values'],additionalProperties:false } }, stacked: { type:'boolean', description:'Bar or area only: stack the series to show parts of a total.' }, value_prefix: { type:'string', description:'Shown before each value, such as $.' }, value_suffix: { type:'string', description:'Shown after each value, such as % or ms.' } }, ['title','type','labels','series']),
  makeTool('render_table', 'Create a sortable, searchable table artifact. Values are data, never executable expressions. Maximum 500 rows and 20 columns. Use null for missing values.', { ...shared, columns:{type:'array',items:string,maxItems:20}, rows:{type:'array',maxItems:500,items:{type:'array',items:primitive,maxItems:20}} }, ['title','columns','rows']),
  makeTool('render_diagram', 'Create a labelled directed diagram from nodes and edges inline in the answer (expandable into the workspace). Layout is a simple grid or explicitly supplied column/row coordinates (0..15), not a full Mermaid layout engine. Maximum 50 nodes and 100 edges. Text is escaped.', { ...shared, nodes:{type:'array',maxItems:50,items:{type:'object',properties:{id:string,label:string,column:{type:'integer',minimum:0,maximum:15},row:{type:'integer',minimum:0,maximum:15}},required:['id','label'],additionalProperties:false}}, edges:{type:'array',maxItems:100,items:{type:'object',properties:{from:string,to:string,label:string},required:['from','to'],additionalProperties:false}} }, ['title','nodes','edges']),
  makeTool('render_timeline', 'Show dated events in order as a timeline inline in the answer (expandable into the workspace): a history, a project\'s milestones, a news recap or a schedule. List the events oldest first and mark planned, projected or unconfirmed ones as tentative. Maximum 40 events. Text is escaped.', { ...shared, events:{type:'array',maxItems:40,items:{type:'object',properties:{date:{type:'string',description:'The date as it should be shown, such as "1969", "Mar 2025" or "Q3 2026".'},title:string,description:string,tentative:{type:'boolean',description:'Planned, projected or unconfirmed.'}},required:['date','title'],additionalProperties:false}} }, ['title','events']),
  makeTool('render_stat_cards', 'Show a few headline figures as cards inline in the answer: each card has a label, its value and optionally the change against a named period and a small line of recent values. Use when two to eight key numbers matter more than their detail; use render_chart to compare many values. Maximum 8 cards.', { ...shared, stats:{type:'array',maxItems:8,items:{type:'object',properties:{label:string,value:{type:['string','number'],description:'A number, or text such as "$4.2B" or "99.9%".'},delta:{type:'string',description:'The signed change against a named period, such as "+12% vs 2024".'},trend:{type:'string',enum:['up','down','flat']},good:{type:'boolean',description:'Whether the change is good for the reader. Omit when it is neither.'},sparkline:{type:'array',items:{type:'number'},maxItems:24,description:'Two to 24 recent values, oldest first.'}},required:['label','value'],additionalProperties:false}} }, ['title','stats']),
  makeTool('create_artifact', 'Create a versioned HTML, SVG, Markdown, JSON, text or PDF artifact. PDF source is a self-contained HTML document, not base64. HTML previews are static by default; the user can enable isolated inline JavaScript for that preview. Use addEventListener in an inline script; inline event attributes, eval, modules and external scripts are unsupported. No network, external libraries, local files, or bridge APIs. Inline CSS and system fonts only. PDF generation runs without JavaScript. For inline visualizations use a transparent background (or neutral grey #252526), text #d4d4d4, system fonts and small VS Code-style accent colors. Blend into the answer: no outer card, border, shadow or large padded panel. Prefer the structured chart/table/diagram tools over custom HTML or Python when sufficient; they are cheaper to render and need less source. PDF pages may keep a print-appropriate white background. Preserve user-requested and authored colors. The preview appears inline with the response. This creates an in-app artifact, not a file on disk.', {...shared, kind:{type:'string',enum:['html','svg','markdown','json','text','pdf']}, source:{type:'string',description:'Complete UTF-8 source, at most 100,000 characters. For PDF, provide HTML with print CSS and page breaks.'}}, ['title','kind','source']),
  makeTool('update_artifact', 'Create a new immutable revision of an artifact visible in this conversation. Provide its returned artifact_id and complete replacement source. For chart/table/diagram source is the JSON specification. Older versions stay available. Do not change the kind.', { artifact_id:string, source:string, title:string, description:string }, ['artifact_id','source']),
  makeTool('read_artifact', 'Read bounded original source and metadata for an artifact from the selected conversation history or this response. This does not view rendered pixels, execute code, or inspect arbitrary local files. Binary artifacts without source return metadata only.', { artifact_id:string }, ['artifact_id']),
];
export const VISUAL_TOOL_NAMES = new Set(VISUAL_TOOLS.map(t=>t.function.name));
export type Cell = string | number | boolean | null;
export interface TableSpec { title:string; description:string; columns:string[]; rows:Cell[][] }
export interface ChartSpec { title:string; description:string; type:typeof CHART_TYPES[number]; labels:string[]; x_values?:number[]; x_label:string; y_label:string; series:{name:string;values:(number|null)[]}[];
  /** Bar and area only: series stack to show parts of a total. */ stacked?:boolean; value_prefix?:string; value_suffix?:string }
export interface DiagramSpec { title:string; description:string; nodes:{id:string;label:string;column:number;row:number}[]; edges:{from:string;to:string;label:string}[] }
export interface TimelineSpec { title:string; description:string; events:{date:string;title:string;description:string;tentative?:boolean}[] }
export const TRENDS=['up','down','flat'] as const;
export interface StatSpec { label:string; value:string|number; delta?:string; trend?:typeof TRENDS[number]; good?:boolean; sparkline?:number[] }
export interface StatsSpec { title:string; description:string; stats:StatSpec[] }
function array(v: unknown, max: number, label: string): unknown[] { if (!Array.isArray(v)||v.length>max) throw new InputError(`${label} exceeds its size limit or is not an array.`); return v; }
function finite(v: unknown): number { if (typeof v!=='number'||!Number.isFinite(v)||Math.abs(v)>1e12) throw new InputError('Visualization values must be finite numbers between -1e12 and 1e12.');return v; }
function description(v: unknown):string {return v===undefined?'':text(v,'Description',2000);}
export function visualArguments(raw: string):Record<string, unknown>{
  if(raw.length>120000)throw new InputError('Visualization arguments exceed 120,000 characters.');
  try{return record(JSON.parse(raw));}catch(error){if(error instanceof InputError)throw error;throw new InputError('The model supplied invalid visualization JSON.');}
}
export function chartSpec(value:unknown):ChartSpec {
  const v=record(value), title=text(v.title,'Chart title',160,true), labels=array(v.labels,200,'Chart labels').map(x=>text(x,'Label',120));
  const type=String(v.type) as ChartSpec['type'];
  if(!labels.length||!(CHART_TYPES as readonly string[]).includes(type))throw new InputError('Choose a supported chart type and at least one data label.');
  const series=array(v.series,8,'Chart series').map(item=>{const s=record(item);const values=array(s.values,200,'Chart values').map(x=>x===null?null:finite(x));if(values.length!==labels.length)throw new InputError('Every series must have exactly one value per label.');return{name:text(s.name,'Series name',100,true),values};});
  if(!series.length||!series.some(s=>s.values.some(v=>v!==null)))throw new InputError('The chart needs at least one numeric value.');
  let x_values:number[]|undefined;
  if(v.x_values!==undefined){x_values=array(v.x_values,200,'X values').map(finite);if(x_values.length!==labels.length)throw new InputError('X values must match labels.');}
  if(v.stacked!==undefined&&typeof v.stacked!=='boolean')throw new InputError('stacked must be true or false.');
  const stacked=v.stacked===true;
  if(stacked&&type!=='bar'&&type!=='area')throw new InputError('Only bar and area charts can be stacked.');
  if(stacked&&series.some(s=>s.values.some(n=>n!==null&&n<0)))throw new InputError('Stacked charts need values of zero or more.');
  if(type==='pie'){
    const parts=series[0]!.values;
    if(series.length!==1||labels.length<2||labels.length>6)throw new InputError('A pie chart shows one series of two to six parts. Use a bar chart for more parts or series.');
    if(parts.some(n=>n===null||n<0)||!parts.some(n=>n!==null&&n>0))throw new InputError('Pie values must be zero or more, with none missing and at least one above zero.');
    if(x_values)throw new InputError('A pie chart takes no x_values.');
  }
  const affix=(x:unknown,label:string,max:number)=>x===undefined?'':text(x,label,max);
  const value_prefix=affix(v.value_prefix,'Value prefix',8),value_suffix=affix(v.value_suffix,'Value suffix',16);
  return {title,description:description(v.description),type,labels,series,...(x_values?{x_values}:{}),x_label:v.x_label===undefined?'':text(v.x_label,'X axis label',100),y_label:v.y_label===undefined?'':text(v.y_label,'Y axis label',100),
    ...(stacked?{stacked}:{}),...(value_prefix?{value_prefix}:{}),...(value_suffix?{value_suffix}:{})};
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
const flag=(v:unknown,label:string):boolean|undefined=>{if(v!==undefined&&typeof v!=='boolean')throw new InputError(`${label} must be true or false.`);return v as boolean|undefined;};
export function timelineSpec(value:unknown):TimelineSpec {
  const v=record(value),events=array(v.events,40,'Timeline events').map(item=>{
    const e=record(item),tentative=flag(e.tentative,'tentative');
    return{date:text(e.date,'Event date',60,true),title:text(e.title,'Event title',160,true),description:e.description===undefined?'':text(e.description,'Event description',600),...(tentative?{tentative}:{})};
  });
  if(!events.length)throw new InputError('A timeline needs at least one event.');
  return{title:text(v.title,'Timeline title',160,true),description:description(v.description),events};
}
export function statsSpec(value:unknown):StatsSpec {
  const v=record(value),stats=array(v.stats,8,'Stat cards').map(item=>{
    const s=record(item),good=flag(s.good,'good');
    if(s.trend!==undefined&&!(TRENDS as readonly string[]).includes(String(s.trend)))throw new InputError('trend must be up, down or flat.');
    let sparkline:number[]|undefined;
    if(s.sparkline!==undefined){sparkline=array(s.sparkline,24,'Sparkline').map(finite);if(sparkline.length<2)throw new InputError('A sparkline needs at least two values.');}
    const delta=s.delta===undefined?'':text(s.delta,'Change',60);
    return{label:text(s.label,'Stat label',80,true),value:typeof s.value==='number'?finite(s.value):text(s.value,'Stat value',40,true),
      ...(delta?{delta}:{}),...(s.trend!==undefined?{trend:s.trend as StatSpec['trend']}:{}),...(good!==undefined?{good}:{}),...(sparkline?{sparkline}:{})};
  });
  if(!stats.length)throw new InputError('Stat cards need at least one figure.');
  return{title:text(v.title,'Stat cards title',160,true),description:description(v.description),stats};
}
/** A stat value as the card shows it: text as given; numbers grouped, and compact from 10,000 (12.9K, 4.2M). */
export function statValue(v:string|number):string {
  if(typeof v==='string')return v;
  const body=Math.abs(v)>=1e4?new Intl.NumberFormat('en-US',{notation:'compact',maximumFractionDigits:1}).format(Math.abs(v)):Math.abs(v).toLocaleString('en-US',{maximumFractionDigits:2});
  return (v<0?'−':'')+body;
}
const TREND_WORDS={up:['↑','Up'],down:['↓','Down'],flat:['→','Unchanged']} as const;
/** Recent values in the de-emphasis grey, the latest point in the accent. Decorative: the Data view lists the values. */
function sparklineSVG(values:number[]):string {
  const w=96,h=24,low=Math.min(...values),high=Math.max(...values);
  const points=values.map((v,i)=>[2+(w-4)*i/(values.length-1),high===low?h/2:2+(h-4)*(1-(v-low)/(high-low))] as const),[lx,ly]=points.at(-1)!;
  return `<svg class="stat-spark" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" aria-hidden="true" focusable="false"><polyline points="${points.map(([x,y])=>`${f(x)},${f(y)}`).join(' ')}" fill="none" stroke="#8a8a8a" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/><circle cx="${f(lx)}" cy="${f(ly)}" r="2.5" fill="#3987e5"/></svg>`;
}
/** The timeline as escaped markup; the app and the standalone document style it. */
export function timelineMarkup(spec:TimelineSpec):string {
  return `<ol class="wb-timeline">${spec.events.map(e=>`<li${e.tentative?' class="tentative"':''}><span class="when">${escape(e.date)}${e.tentative?'<span class="tentative-tag">Tentative</span>':''}</span><strong>${escape(e.title)}</strong>${e.description?`<p>${escape(e.description)}</p>`:''}</li>`).join('')}</ol>`;
}
/** Stat cards as escaped markup. The arrow's colour says whether a change is good only when the model said so, and
 * never alone: the arrow, the change text and the screen-reader words carry it too. */
export function statsMarkup(spec:StatsSpec):string {
  return `<ul class="wb-stats">${spec.stats.map(s=>{
    const tone=s.good===undefined?'':s.good?' good':' bad',[arrow,word]=s.trend?TREND_WORDS[s.trend]:['',''];
    const spoken=word||s.good!==undefined?`<span class="sr-only">${[word,s.good===undefined?'':s.good?'good':'bad'].filter(Boolean).join(', ')}: </span>`:'';
    const delta=s.delta||arrow?`<span class="stat-delta">${arrow?`<span class="stat-arrow${tone}" aria-hidden="true">${arrow}</span>`:''}${spoken}${escape(s.delta??'')}</span>`:'';
    return `<li><span class="stat-label">${escape(s.label)}</span><strong class="stat-value">${escape(statValue(s.value))}</strong>${delta}${s.sparkline?sparklineSVG(s.sparkline):''}</li>`;
  }).join('')}</ul>`;
}
/** Light styles for the saved file and PDF export of a timeline or stat cards. No scripts, no external resources. */
const WIDGET_DOCUMENT_STYLE='<style>.wb-doc{font:14px/1.5 system-ui,sans-serif;color:#20242b}.wb-doc h1{font-size:18px;margin:0 0 4px}.wb-doc>p{color:#555b66;margin:0 0 16px}.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap}'
  +'.wb-timeline{list-style:none;margin:0;padding:0 0 0 22px;border-left:1px solid #c9ced6}.wb-timeline li{position:relative;padding:0 0 14px;break-inside:avoid}.wb-timeline li::before{content:"";position:absolute;left:-27px;top:5px;width:9px;height:9px;border-radius:50%;background:#2a78d6}.wb-timeline li.tentative::before{background:#fff;border:1.5px solid #2a78d6;box-sizing:border-box}.wb-timeline .when{display:block;font-size:12px;color:#555b66}.wb-timeline .tentative-tag{margin-left:8px;font-size:11px;border:1px solid #c9ced6;border-radius:4px;padding:0 5px}.wb-timeline strong{display:block}.wb-timeline p{margin:2px 0 0;color:#3d434d}'
  +'.wb-stats{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:10px}.wb-stats li{padding:10px 12px;border:1px solid #d5d9df;border-radius:8px;break-inside:avoid;display:flex;flex-direction:column;gap:2px}.wb-stats .stat-label{font-size:12px;color:#555b66}.wb-stats .stat-value{font-size:22px}.wb-stats .stat-delta{font-size:12px;color:#3d434d}.stat-arrow{margin-right:4px}.stat-arrow.good{color:#0a7f0a}.stat-arrow.bad{color:#c02f2f}</style>';
const widgetDocument=(title:string,desc:string,body:string)=>`${WIDGET_DOCUMENT_STYLE}<section class="wb-doc"><h1>${escape(title)}</h1>${desc?`<p>${escape(desc)}</p>`:''}${body}</section>`;
export const timelineHTML=(spec:TimelineSpec):string=>widgetDocument(spec.title,spec.description,timelineMarkup(spec));
export const statsHTML=(spec:StatsSpec):string=>widgetDocument(spec.title,spec.description,statsMarkup(spec));
/** A file name from an artifact title: dashes survive as hyphens and other punctuation becomes a space, so
 * "Revenue, 2023–2026 (approx.)" gives "Revenue 2023-2026 approx", not "Revenue 20232026 approx". */
export function artifactFileName(title:string,ext:string):string {
  const base=title.normalize('NFC').replace(/['’]/g,'').replace(/\p{Pd}+/gu,'-').replace(/[^\p{L}\p{M}\p{N} _-]+/gu,' ').replace(/\s+/g,' ').trim().slice(0,90).trim();
  return (base||'artifact')+'.'+ext;
}
export function tableHTML(spec:TableSpec):string {return `<table><caption>${escape(spec.title)}</caption><thead><tr>${spec.columns.map(c=>`<th scope="col">${escape(c)}</th>`).join('')}</tr></thead><tbody>${spec.rows.map(r=>`<tr>${r.map(c=>`<td>${escape(c===null?'—':String(c))}</td>`).join('')}</tr>`).join('')}</tbody></table>`;}
/** Categorical series colors: the dark steps of the dataviz reference palette, validated on the app's #1e1e1e and
 * #252526 surfaces (lightness band, chroma floor, adjacent CVD and normal-vision separation, 3:1 contrast). Fixed order,
 * never cycled: a series keeps its color when others are hidden. */
export const visualPalette=['#3987e5','#d95926','#199e70','#c98500','#d55181','#008300','#9085e9','#e66767'];
/** The reply surface; slice and marker rings use it so neighbouring marks stay apart. Print maps it to white. */
const SURFACE='#1e1e1e';
const palette=visualPalette;
const f=(n:number)=>Number(n.toFixed(2));
const baseSVG=(title:string,desc:string,w:number,h:number,body:string)=>`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" role="img" aria-label="${escape(title)}"><title>${escape(title)}</title><desc>${escape(desc)}</desc>${body}</svg>`;
/** A value as the chart shows it: rounded, with the spec's prefix and suffix. */
export function formatValue(spec:Pick<ChartSpec,'value_prefix'|'value_suffix'>,n:number,precision=6):string {
  const body=Number(Math.abs(n).toPrecision(precision)).toLocaleString('en-US',{maximumFractionDigits:6});
  return `${n<0?'−':''}${spec.value_prefix??''}${body}${spec.value_suffix??''}`;
}
export const formatShare=(share:number):string=>`${(Math.round(share*1000)/10).toLocaleString('en-US')}%`;
export interface ChartOptions { heading?:boolean; compact?:boolean; print?:boolean; width?:number; tight?:boolean; hover?:boolean }
export interface PieSlice { index:number; value:number; share:number; start:number; end:number }
/** Everything the SVG and the hover layer need to agree on: plot box, scales, stacking and pie geometry. */
export interface ChartLayout {
  w:number; h:number; left:number; right:number; top:number; bottom:number; pw:number; ph:number; narrow:boolean; heading:boolean;
  low:number; high:number; band:number; ticks:number[];
  visible:{name:string;values:(number|null)[];index:number}[];
  /** For stacked charts: each visible series' base and top at every label. */
  bases:number[][]; tops:number[][];
  x(i:number):number; y(n:number):number;
  pie?:{cx:number;cy:number;r:number;r0:number;total:number;slices:PieSlice[]};
}
export function chartLayout(spec:ChartSpec,hidden:number[]=[],options:ChartOptions={}):ChartLayout {
  const visible=spec.series.map((s,i)=>({...s,index:i})).filter(s=>!hidden.includes(s.index));
  const stacked=!!spec.stacked&&(spec.type==='bar'||spec.type==='area'),bases:number[][]=[],tops:number[][]=[];
  if(stacked){const run=spec.labels.map(()=>0);for(const s of visible){bases.push([...run]);s.values.forEach((v,i)=>{run[i]=run[i]!+(v??0);});tops.push([...run]);}}
  const values=stacked?tops.flat():visible.flatMap(s=>s.values.filter((v):v is number=>v!==null));
  const extent=niceTicks(Math.min(...values,0),Math.max(...values,0)),{low,high,ticks}=extent;
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
  const bottom=(narrow?54:64)-blankAxis,pw=w-left-right,ph=h-top-bottom,band=pw/spec.labels.length;
  const x=(i:number)=>spec.type==='bar'?left+band*(i+.5):left+pw*((spec.x_values?.[i]??i)-minX)/(maxX-minX||1);
  const y=(n:number)=>top+ph*(1-(n-low)/(high-low));
  const layout:ChartLayout={w,h,left,right,top,bottom,pw,ph,narrow,heading,low,high,band,ticks,visible,bases,tops,x,y};
  if(spec.type==='pie'){
    const parts=spec.series[0]!.values.map(v=>v??0),total=parts.reduce((a,b)=>a+b,0);
    const cy=top+(h-top-12)/2,r=Math.max(40,Math.min((h-top-12)/2-22,w/2-130));
    let angle=-Math.PI/2;
    const slices=parts.map((value,index)=>{const share=total>0?value/total:0,start=angle;angle+=share*Math.PI*2;return{index,value,share,start,end:angle};});
    layout.pie={cx:w/2,cy,r,r0:r*.58,total,slices};
  }
  return layout;
}
/** Round axis ticks (steps of 1, 2, 2.5 or 5 times a power of ten); the axis is extended to the
 * nearest tick on each side, so the grid never shows values such as 1.125. */
export function niceTicks(low:number,high:number):{low:number;high:number;ticks:number[]} {
  if(low===high){low-=1;high+=1;}
  let best:{low:number;high:number;ticks:number[]}|null=null,score=Infinity;
  // Four to six intervals; the one that wastes the least of the plot wins, a little against more gridlines.
  for(const count of [4,5,6]){
    const raw=(high-low)/count,magnitude=10**Math.floor(Math.log10(raw)),n=raw/magnitude;
    const step=(n<=1?1:n<=2?2:n<=2.5?2.5:n<=5?5:10)*magnitude,min=Math.floor(low/step+1e-9)*step,max=Math.ceil(high/step-1e-9)*step;
    const ticks:number[]=[];for(let v=min;v<=max+step/2;v+=step)ticks.push(Number(v.toPrecision(12)));
    const s=(max-min)/(high-low)+ticks.length*.02;
    if(s<score-1e-9){score=s;best={low:Number(min.toPrecision(12)),high:Number(max.toPrecision(12)),ticks};}
  }
  return best!;
}
/** A bar from its baseline to its value, rounded only at the value end (dataviz: 4px data-ends on the baseline). */
function barPath(x:number,width:number,base:number,end:number,radius:number):string {
  const r=Math.max(0,Math.min(radius,width/2,Math.abs(base-end))),up=end<=base,edge=up?end+r:end-r;
  if(r===0)return `M${f(x)} ${f(base)}V${f(end)}H${f(x+width)}V${f(base)}Z`;
  return `M${f(x)} ${f(base)}V${f(edge)}Q${f(x)} ${f(end)} ${f(x+r)} ${f(end)}H${f(x+width-r)}Q${f(x+width)} ${f(end)} ${f(x+width)} ${f(edge)}V${f(base)}Z`;
}
function arc(cx:number,cy:number,r:number,r0:number,start:number,end:number):string {
  const p=(radius:number,a:number)=>`${f(cx+radius*Math.cos(a))} ${f(cy+radius*Math.sin(a))}`,large=end-start>Math.PI?1:0;
  if(end-start>=Math.PI*2-1e-9)return `M${p(r,start)}A${f(r)} ${f(r)} 0 1 1 ${p(r,start+Math.PI)}A${f(r)} ${f(r)} 0 1 1 ${p(r,start)}ZM${p(r0,start)}A${f(r0)} ${f(r0)} 0 1 0 ${p(r0,start+Math.PI)}A${f(r0)} ${f(r0)} 0 1 0 ${p(r0,start)}Z`;
  return `M${p(r,start)}A${f(r)} ${f(r)} 0 ${large} 1 ${p(r,end)}L${p(r0,end)}A${f(r0)} ${f(r0)} 0 ${large} 0 ${p(r0,start)}Z`;
}
function pieMarks(spec:ChartSpec,L:ChartLayout,titles:boolean):string {
  const {cx,cy,r,r0,total,slices}=L.pie!;let out='';
  for(const s of slices){
    if(s.value<=0)continue;
    const tip=titles?`<title>${escape(`${spec.labels[s.index]}: ${formatValue(spec,s.value)} (${formatShare(s.share)})`)}</title>`:'';
    out+=`<path d="${arc(cx,cy,r,r0,s.start,s.end)}" fill="${palette[s.index%palette.length]}" fill-rule="evenodd" stroke="${SURFACE}" stroke-width="2" stroke-linejoin="round" class="chart-mark" data-key="slice-${s.index}">${tip}</path>`;
  }
  // Direct labels only where a slice is large enough; the legend, tooltip and table carry the rest.
  for(const s of slices){
    if(s.share<.04)continue;
    const mid=(s.start+s.end)/2,lx=cx+(r+12)*Math.cos(mid),ly=cy+(r+12)*Math.sin(mid)+4,max=L.narrow?12:22,label=spec.labels[s.index]!;
    out+=`<text x="${f(lx)}" y="${f(ly)}" text-anchor="${Math.cos(mid)>=0?'start':'end'}" fill="#d4d4d4" font-family="system-ui" font-size="12">${escape(label.length>max?label.slice(0,max-1)+'…':label)} <tspan fill="#a6a6a6">${formatShare(s.share)}</tspan></text>`;
  }
  if(r0>=34&&spec.value_suffix!=='%')out+=`<text x="${f(cx)}" y="${f(cy+2)}" text-anchor="middle" fill="#d4d4d4" font-family="system-ui" font-size="${L.narrow?15:18}">${escape(formatValue(spec,total))}</text><text x="${f(cx)}" y="${f(cy+19)}" text-anchor="middle" fill="#a6a6a6" font-family="system-ui" font-size="11">Total</text>`;
  return out;
}
export function chartSVG(spec:ChartSpec,hidden:number[]=[],options:ChartOptions={}):string {
  const L=chartLayout(spec,hidden,options),{w,h,left,right,top,bottom,pw,ph,x,y,visible}=L;
  // The inline preview has its own hover layer; exports keep native tooltips.
  const titles=!options.hover;
  let out=L.heading?`<text x="${left}" y="28" fill="#d4d4d4" font-family="system-ui" font-size="17">${escape(spec.title)}</text>`:"";
  if(L.pie){const svg=baseSVG(spec.title,spec.description,w,h,out+pieMarks(spec,L,titles));return options.print?printVisualSVG(svg):svg;}
  for(const value of L.ticks){const yy=f(y(value));out+=`<line x1="${left}" y1="${yy}" x2="${w-right}" y2="${yy}" stroke="#363636"/><text x="${left-10}" y="${yy+4}" text-anchor="end" fill="#a6a6a6" font-family="system-ui" font-size="11">${escape(formatValue(spec,value,5))}</text>`;}
  spec.labels.forEach((label,i)=>{if(i%Math.max(1,Math.ceil(spec.labels.length/Math.max(2,Math.floor(pw/70))))===0||i===spec.labels.length-1)out+=`<text x="${f(x(i))}" y="${h-bottom+24}" text-anchor="middle" fill="#a6a6a6" font-family="system-ui" font-size="11">${escape(label.length>(L.narrow?10:20)?label.slice(0,L.narrow?9:18)+'…':label)}</text>`;});
  const stacked=L.tops.length>0,group=Math.min(70,L.band*.75),lastTop=L.tops.at(-1);
  // Grouped bars share a label's band only when two series have a value there. Series that never meet, such as
  // reported values and a projection, keep whole centred bars instead of half-width bars beside an empty slot.
  const lanes=spec.labels.some((_,i)=>visible.filter(s=>s.values[i]!==null).length>1)?visible.length:1;
  visible.forEach((s,si)=>{
    out+=`<g data-key="series-${s.index}" data-series="${s.index}">`;
    const color=palette[s.index%palette.length];let segment:{i:number;v:number}[]=[];
    const tip=(i:number,v:number)=>titles?`<title>${escape(`${s.name} · ${spec.labels[i]}: ${formatValue(spec,v)}`)}</title>`:'';
    if(stacked&&spec.type==='area'){
      const topPoints=spec.labels.map((_,i)=>`${f(x(i))},${f(y(L.tops[si]![i]!))}`),basePoints=spec.labels.map((_,i)=>`${f(x(i))},${f(y(L.bases[si]![i]!))}`).reverse();
      out+=`<polygon points="${[...topPoints,...basePoints].join(' ')}" fill="${color}" opacity="0.34" class="chart-area"/><polyline points="${topPoints.join(' ')}" fill="none" stroke="${color}" stroke-width="2" class="chart-line" pathLength="1"/></g>`;
      return;
    }
    const flush=()=>{if(!segment.length)return;const points=segment.map(p=>`${f(x(p.i))},${f(y(p.v))}`).join(' ');if(spec.type==='area')out+=`<polygon points="${f(x(segment[0]!.i))},${f(y(0))} ${points} ${f(x(segment.at(-1)!.i))},${f(y(0))}" fill="${color}" opacity="0.14" class="chart-area"/>`;if(spec.type!=='scatter'&&spec.type!=='bar')out+=`<polyline points="${points}" fill="none" stroke="${color}" stroke-width="2" class="chart-line" pathLength="1"/>`;if(spec.labels.length>80&&spec.type!=='scatter'&&spec.type!=='bar'&&segment.length===1){const p=segment[0]!;out+=`<circle cx="${f(x(p.i))}" cy="${f(y(p.v))}" r="3" fill="${color}">${tip(p.i,p.v)}</circle>`;}segment=[];};
    s.values.forEach((v,i)=>{
      if(v===null){flush();return;}segment.push({i,v});
      if(spec.type==='bar'){
        if(stacked){
          // Segments sit on each other with a 2px surface gap; only the top of the stack is rounded.
          if(v===0)return;const base=L.bases[si]![i]!,end=L.tops[si]![i]!;
          out+=`<path d="${barPath(x(i)-group/2,Math.max(.3,group),y(base)-(base>0?2:0),y(end),end===lastTop![i]?4:0)}" fill="${color}" class="chart-mark">${tip(i,v)}</path>`;
        } else {
          const bw=group/lanes,xx=x(i)-group/2+(lanes>1?bw*si:0);
          out+=`<path d="${barPath(xx,Math.max(.3,bw-2),y(0),y(v),4)}" fill="${color}" class="chart-mark">${tip(i,v)}</path>`;
        }
      } else if(spec.type==='scatter')out+=`<circle cx="${f(x(i))}" cy="${f(y(v))}" r="4" fill="${color}" stroke="${SURFACE}" stroke-width="2" class="chart-mark">${tip(i,v)}</circle>`;
      else if(spec.labels.length<=80)out+=`<circle cx="${f(x(i))}" cy="${f(y(v))}" r="3" fill="${color}" class="chart-mark">${tip(i,v)}</circle>`;
    });flush();out+='</g>';
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
  const colors:Record<string,string>={'#d4d4d4':'#242424','#363636':'#d0d0d0','#a6a6a6':'#555555','#b8b8b8':'#555555','#292929':'#f2f2f2','#555555':'#888888','#75b9ff':'#0072b2','#3987e5':'#2a78d6','#d95926':'#eb6834','#199e70':'#1baf7a','#c98500':'#eda100','#d55181':'#e87ba4','#9085e9':'#4a3aa7','#e66767':'#e34948','#1e1e1e':'#ffffff'};
  return svg.replace(/(fill|stroke)="(#[a-f0-9]{6})"/g,(attribute,kind,color)=>colors[color]?`${kind}="${colors[color]}"`:attribute);
}
export function artifactSource(a:Artifact):string|null {
  if(a.source!==undefined)return a.source;
  if(a.mime==='application/pdf'||a.mime==='image/png')return null;
  try{return new TextDecoder().decode(Uint8Array.from(atob(a.data),c=>c.charCodeAt(0)));}catch{return null;}
}
