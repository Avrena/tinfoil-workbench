import type { Artifact } from '../core/types.js';
import { artifactSource, chartSpec, chartSVG, chartLayout, formatShare, tableSpec, diagramSpec, diagramSVG, type TableSpec, visualPalette } from '../core/visual-tools.js';
import { chartHover } from './chart-hover.js';
import { escapeHtml as e } from '../core/markdown.js';
import { staticPreview, interactivePreview, renderDataPreview } from './artifacts.js';
import { mountPDF } from './pdf-viewer.js';
import { updateMarkup } from './dom.js';
export type ArtifactTab = 'preview' | 'source' | 'data';
export interface SurfaceOptions { tab: ArtifactTab; interactive?: boolean; compact?: boolean }
let surfaceId = 0;
/** Shared by inline cards and the expanded workspace. One mount owns its local
 * state; ordinary chat snapshots never remount it or its opaque HTML frame. */
export function mountArtifact(container: HTMLElement, a: Artifact, options: SurfaceOptions): () => void {
  let alive = true, dispose: (() => void) | undefined;
  const cleanup = () => { alive = false; dispose?.(); };
  const source = artifactSource(a); container.replaceChildren();
  if (options.tab === 'source') {
    const pre = document.createElement('pre'); pre.className = 'raw-source';
    pre.textContent = source ?? 'This binary artifact has no stored textual source.'; container.append(pre); return cleanup;
  }
  try {
    if (a.kind === 'chart' && source) {
      const spec = chartSpec(JSON.parse(source));
      const pie = spec.type === 'pie', total = pie ? spec.series[0]!.values.reduce<number>((sum,v)=>sum+(v??0),0) : 0;
      if (options.tab === 'data') {
        dispose=mountTable(container, {title:spec.title, description:spec.description, columns:[spec.x_label || 'Label', ...(spec.x_values ? ['X'] : []), ...spec.series.map(s=>s.name), ...(pie?['Share']:[])],
          rows:spec.labels.map((label,i)=>[label,...(spec.x_values?[spec.x_values[i]!]:[]),...spec.series.map(s=>s.values[i]??null),...(pie?[formatShare((spec.series[0]!.values[i]??0)/total)]:[])])}, options.compact); return cleanup;
      }
      const chart = document.createElement('div'); chart.className = 'visual-canvas';
      const legend = document.createElement('div'); legend.className = 'chart-legend'; legend.setAttribute('aria-label', pie ? 'Chart parts' : 'Visible chart series');
      let hidden: number[] = [];let width=780;let resizeFrame=0;
      const view = () => ({heading:false,compact:options.compact,width,tight:true});
      const hover = chartHover(chart, spec, () => chartLayout(spec, hidden, view()));
      const paint = () => { updateMarkup(chart,chartSVG(spec, hidden, {...view(),hover:true})); hover.attach(); };
      const resize=new ResizeObserver(entries=>{const next=Math.max(300,Math.min(780,Math.round(entries[0]?.contentRect.width??780)));if(Math.abs(next-width)<4||!(entries[0]?.contentRect.width))return;width=next;if(!resizeFrame)resizeFrame=requestAnimationFrame(()=>{resizeFrame=0;if(alive){chart.classList.remove('visual-enter');paint();}});});
      chart.classList.add('visual-enter');
      const entrance=window.setTimeout(()=>chart.classList.remove('visual-enter'),550);dispose=()=>{clearTimeout(entrance);resize.disconnect();cancelAnimationFrame(resizeFrame);hover.dispose();};
      // The legend key mirrors the mark: a stroke for lines, a dot for points, a block for bars, areas and slices.
      const key = spec.type === 'line' ? 'line' : spec.type === 'scatter' ? 'dot' : 'block';
      const swatch = (index: number) => { const i = document.createElement('i'); i.className = `series-swatch ${key}`; i.style.backgroundColor = visualPalette[index % visualPalette.length]!; i.setAttribute('aria-hidden','true'); return i; };
      if (pie) spec.labels.forEach((label, i) => {
        // A pie has one series, so its parts are listed rather than toggled; each keeps its slice's color.
        const item = document.createElement('span'); item.className = 'legend-item';
        const share = document.createElement('span'); share.className = 'legend-share'; share.textContent = formatShare((spec.series[0]!.values[i] ?? 0) / total);
        item.append(swatch(i), document.createTextNode(label), share); legend.append(item);
      });
      else spec.series.forEach((series, i) => {
        const b = document.createElement('button'); b.type = 'button'; b.setAttribute('aria-pressed', 'true');
        b.append(swatch(i), document.createTextNode(series.name));
        b.onclick = () => { chart.classList.remove('visual-enter'); hidden = hidden.includes(i) ? hidden.filter(n=>n!==i) : [...hidden,i]; b.setAttribute('aria-pressed', String(!hidden.includes(i))); paint(); };
        legend.append(b);
      }); container.append(chart, legend);width=Math.max(300,Math.min(780,container.clientWidth||780));paint();resize.observe(container);return cleanup;
    }
    if (a.kind === 'table' && source) { dispose=mountTable(container, tableSpec(JSON.parse(source)), options.compact); return cleanup; }
    if (a.kind === 'diagram' && source) {
      const spec = diagramSpec(JSON.parse(source));
      if (options.tab === 'data') dispose=mountTable(container, {title:spec.title,description:spec.description,columns:['From','To','Label'],rows:spec.edges.map(edge=>[edge.from,edge.to,edge.label])}, options.compact);
      else container.innerHTML = `<div class="visual-canvas diagram-canvas">${diagramSVG(spec, 'diagram-' + ++surfaceId, false)}</div>`;
      return cleanup;
    }
    if (a.mime === 'application/pdf') {
      void mountPDF(container, Uint8Array.from(atob(a.data), c=>c.charCodeAt(0)), ()=>alive && container.isConnected)
        .then(clean => { if (alive) dispose = clean; else clean(); }); return cleanup;
    }
    if (a.mime === 'image/png') { const img = document.createElement('img'); img.src='data:image/png;base64,'+a.data; img.alt=a.description||a.title||a.name; img.loading='lazy'; container.append(img); return cleanup; }
    if (source !== null && ['text/html','image/svg+xml'].includes(a.mime)) {
      const interactive = options.interactive && a.mime === 'text/html';
      const frame = document.createElement('iframe'); frame.title=a.title??a.name; frame.setAttribute('sandbox',interactive?'allow-scripts':''); frame.referrerPolicy='no-referrer';
      frame.srcdoc=interactive?interactivePreview(source):staticPreview(source); container.append(frame);
      dispose=()=>{frame.remove();}; return cleanup;
    }
    container.innerHTML=renderDataPreview(a.mime==='text/markdown'?'md':a.mime==='application/json'?'json':'text',source??'');
  } catch { container.textContent='This artifact could not be rendered. Its original source remains available.'; }
  return cleanup;
}
function mountTable(container: HTMLElement, spec: TableSpec, compact = false): () => void {
  const filter=document.createElement('input');filter.type='search';filter.placeholder='Filter rows…';filter.setAttribute('aria-label','Filter artifact table');
  const wrap=document.createElement('div');wrap.className='data-table-wrap';
  const count=document.createElement('span'),prev=document.createElement('button'),next=document.createElement('button'),nav=document.createElement('div');
  nav.className='table-controls';prev.type=next.type='button';prev.textContent='Previous';next.textContent='Next';nav.append(prev,count,next);container.append(filter,wrap,nav);
  const table=document.createElement('table');table.innerHTML=`<caption class="sr-only">${e(spec.title)}</caption><thead><tr>${spec.columns.map((c,i)=>`<th scope="col" aria-sort="none"><button type="button" data-column="${i}">${e(c)}</button></th>`).join('')}</tr></thead><tbody></tbody>`;wrap.append(table);
  const body=table.querySelector('tbody')!,headers=[...table.querySelectorAll<HTMLTableCellElement>('th')];
  const empty=document.createElement('p');empty.className='table-empty';empty.textContent='No matching rows.';empty.hidden=true;wrap.append(empty);
  let column=-1,direction=1,page=0,query='',selection=spec.rows,searchRows:string[]|undefined,filterTimer:number|undefined;
  const pageSize=compact?8:50;
  const paint=()=>{
    const pages=Math.max(1,Math.ceil(selection.length/pageSize));page=Math.min(page,pages-1);prev.disabled=page===0;next.disabled=page>=pages-1;
    count.textContent=`${selection.length} rows${pages>1?` · ${page+1}/${pages}`:''}`;prev.hidden=next.hidden=pages<=1;
    // Paging reuses the filtered/sorted selection and the original header nodes.
    body.innerHTML=selection.slice(page*pageSize,page*pageSize+pageSize).map(row=>`<tr>${row.map(c=>`<td class="${typeof c==='number'?'numeric':''}">${e(c===null?'—':String(c))}</td>`).join('')}</tr>`).join('');
    empty.hidden=selection.length>0;
  };
  const select=()=>{
    // Build a search index on first use only. Typing and pagination do not
    // repeatedly lowercase every cell or sort the unchanged selection.
    if(query&&!searchRows)searchRows=spec.rows.map(row=>row.map(cell=>String(cell??'').toLocaleLowerCase()).join('\0'));
    selection=query?spec.rows.filter((_,i)=>searchRows![i]!.includes(query)):spec.rows;
    if(column>=0)selection=[...selection].sort((a,b)=>{const x=a[column],y=b[column];if(x===null&&y===null)return 0;if(x===null)return 1;if(y===null)return -1;return direction*(typeof x==='number'&&typeof y==='number'?x-y:String(x).localeCompare(String(y),undefined,{numeric:true}));});
    headers.forEach((th,i)=>{th.setAttribute('aria-sort',column===i?(direction===1?'ascending':'descending'):'none');th.querySelector('button')!.textContent=spec.columns[i]!+(column===i?(direction===1?' ↑':' ↓'):'');});
    paint();
  };
  table.querySelectorAll<HTMLButtonElement>('[data-column]').forEach(b=>b.onclick=()=>{const n=Number(b.dataset.column);direction=n===column?-direction:1;column=n;page=0;select();});
  filter.oninput=()=>{clearTimeout(filterTimer);filterTimer=window.setTimeout(()=>{query=filter.value.toLocaleLowerCase();page=0;select();},70);};
  prev.onclick=()=>{page--;paint();};next.onclick=()=>{page++;paint();};paint();
  return ()=>clearTimeout(filterTimer);
}
