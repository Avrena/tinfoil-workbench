/** Fixed inline glyphs for trusted renderer templates; labels are escaped by callers. */
const paths: Record<string,string> = {
  folder:'M3 6h7l2 2h9v12H3zM3 6V4h7l2 2', expand:'M8 3H3v5M16 3h5v5M3 16v5h5M21 16v5h-5', eye:'M2 12s3-7 10-7 10 7 10 7-3 7-10 7S2 12 2 12M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6', up:'m6 15 6-6 6 6', left:'m15 6-6 6 6 6', right:'m9 6 6 6-6 6',
  logo:'M4 4h16v4h-6v12h-4V8H4z', sync:'M20 12a8 8 0 0 1-14 5.3M4 12a8 8 0 0 1 14-5.3M18 3v4h-4M6 21v-4h4', trash:'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3', chat:'M4 4h16v12H9l-5 4z', plus:'M12 5v14M5 12h14',
  search:'M10 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14m5 12 6 6',
  settings:'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8M10 3h4l1 3 3-1 2 4-2 3 2 3-2 4-3-1-1 3h-4l-1-3-3 1-2-4 2-3-2-3 2-4 3 1z',
  shield:'M12 3 4 6v6c0 5 8 9 8 9s8-4 8-9V6zM8 12l3 3 5-6',
  lock:'M6 10h12v11H6zM8 10V6a4 4 0 0 1 8 0v4', compare:'M3 4h7v16H3zM14 4h7v16h-7z',
  branch:'M6 3v12M18 9a9 9 0 0 1-9 9M18 3a3 3 0 1 0 0 6a3 3 0 1 0 0-6M6 15a3 3 0 1 0 0 6a3 3 0 1 0 0-6',
  attach:'m8 13 6-6a3 3 0 0 1 4 4l-8 8a5 5 0 0 1-7-7l8-8',
  send:'M12 20V4M5 11l7-7 7 7', stop:'M6 6h12v12H6z', close:'m6 6 12 12M18 6 6 18',
  more:'M5 12h.01M12 12h.01M19 12h.01', panel:'M3 4h18v16H3zM15 4v16',
  copy:'M8 8h12v13H8zM15 8V3H3v13h5', download:'M12 3v12m-5-5 5 5 5-5M4 17v4h16v-4',
  upload:'M12 17V3m-5 5 5-5 5 5M4 17v4h16v-4', code:'m8 6-6 6 6 6m8-12 6 6-6 6M14 3 10 21',
  write:'m4 16 12-12 4 4L8 20H4zM13 7l4 4', spark:'m12 3 2.4 6.6L21 12l-6.6 2.4L12 21l-2.4-6.6L3 12l6.6-2.4z',
  cloud:'M7 18a4 4 0 0 1-.6-7.96A6 6 0 0 1 17.8 8.5 4.75 4.75 0 0 1 17.25 18z',
  minus:'M5 12h14', square:'M5 5h14v14H5z', check:'m5 12 4 4L19 6', down:'m6 9 6 6 6-6', pin:'m8 3 8 0-1 6 4 4H5l4-4zM12 13v8',
  instructions:'M6 3h8l4 4v14H6zM14 3v4h4M9 12h6M9 16h4',
  image:'M4 5h16v14H4zM4 16l5-5 4 4 2-2 5 5M15 9h.01', tools:'M9 4H8a2 2 0 0 0-2 2v4l-2 2 2 2v4a2 2 0 0 0 2 2h1M15 4h1a2 2 0 0 1 2 2v4l2 2-2 2v4a2 2 0 0 1-2 2h-1',
};
export const icon = (name:string):string => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${paths[name] ?? paths.chat}"/></svg>`;
/** A dashboard gauge for the thinking effort: one segment per level the model offers, filled up to `level` (0 is the
 * provider default: nothing filled, the needle upright, no accent). */
export function effortGauge(level:number,levels:number):string {
  const n=Math.max(1,levels),cx=12,cy=16,r=8,gap=n>1?7:0,at=(deg:number,radius:number)=>`${(cx+radius*Math.cos(deg*Math.PI/180)).toFixed(2)} ${(cy-radius*Math.sin(deg*Math.PI/180)).toFixed(2)}`;
  let arcs='';
  for(let i=0;i<n;i++){const from=180-i*180/n-(i?gap/2:0),to=180-(i+1)*180/n+(i<n-1?gap/2:0);arcs+=`<path class="${i<level?'on':'off'}" d="M${at(from,r)}A${r} ${r} 0 0 1 ${at(to,r)}"/>`;}
  const needle=level?180-(level-.5)*180/n:90;
  return `<svg viewBox="0 0 24 24" class="${level?'active':''}" data-level="${level}"><g fill="none" stroke-width="2.2" stroke-linecap="round">${arcs}</g><path class="needle" d="M${cx} ${cy}L${at(needle,r-3)}" fill="none" stroke-width="1.8" stroke-linecap="round"/><circle cx="${cx}" cy="${cy}" r="1.6"/></svg>`;
}
export const button = (action:string, label:string, glyph:string, extra=''):string => `<button type="button" data-action="${action}" title="${label}" aria-label="${label}" ${extra}>${icon(glyph)}</button>`;
