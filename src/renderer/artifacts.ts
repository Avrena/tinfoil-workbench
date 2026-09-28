import { escapeHtml, markdown } from '../core/markdown.js';
/** Produce a static document, never an executable artifact. Unknown elements,
 * navigation, form actions, event attributes and all external resources are removed.
 * The opaque-origin sandbox and restrictive CSP are independent additional boundaries.
 */
export function staticPreview(source: string): string {
  // Parse in a detached, non-browsing document before applying an allowlist.
  const template = document.implementation.createHTMLDocument('').createElement('template');
  template.innerHTML = source.slice(0, 200000);
  const tags = new Set('html head body title style div span p h1 h2 h3 h4 h5 h6 b strong i em u s br hr pre code blockquote ul ol li dl dt dd table thead tbody tfoot tr th td caption main section article aside header footer nav figure figcaption a button label svg g path rect circle ellipse line polyline polygon text tspan defs lineargradient radialgradient stop clippath mask'.split(' '));
  const attributes = new Set('class style title role aria-label viewbox xmlns width height x y x1 x2 y1 y2 cx cy r rx ry d points fill stroke stroke-width stroke-linecap stroke-linejoin opacity transform offset stop-color stop-opacity preserveaspectratio text-anchor font-size font-family colspan rowspan'.split(' '));
  const inlineRules: string[] = [];
  for (const element of [...template.content.querySelectorAll('*')]) {
    if (!tags.has(element.tagName.toLowerCase())) { element.remove(); continue; }
    for (const attr of [...element.attributes]) if (!attributes.has(attr.name.toLowerCase())) element.removeAttribute(attr.name);
    const inlineStyle = element.getAttribute('style');
    if (inlineStyle) {
      const name = `artifact-style-${inlineRules.length}`;
      element.classList.add(name); element.removeAttribute('style');
      inlineRules.push(`.${name}{${inlineStyle.replaceAll('<', '\\3c ')}}`);
    }
    if (element.tagName.toLowerCase() === 'style') element.setAttribute('nonce', 'workbench-artifact');
    if (element.tagName.toLowerCase() === 'button') element.setAttribute('disabled', '');
  }
  return '<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'none\'; style-src \'unsafe-inline\'; img-src \'none\'; connect-src \'none\'; frame-src \'none\'; object-src \'none\'; base-uri \'none\'; form-action \'none\'"><style nonce="workbench-artifact">html{color-scheme:dark;background:transparent}body{font:15px/1.6 system-ui;color:#d4d4d4;background:transparent;margin:0;padding:8px 0;overflow-wrap:anywhere}table{border-collapse:collapse}td,th{padding:8px;border:0;border-bottom:1px solid #3c3c3c}svg{max-width:100%;height:auto}pre{white-space:pre-wrap}' + inlineRules.join('\n') + '</style></head><body>' + template.innerHTML + '</body></html>';
}
export function renderDataPreview(language: string, source: string): string {
  if (['markdown','md'].includes(language)) return `<div class="reply-content artifact-markdown">${markdown(source, {codeTools: false})}</div>`;
  if (language === 'json') {
    try { return `<pre class="raw-source">${escapeHtml(JSON.stringify(JSON.parse(source), null, 2))}</pre>`; }
    catch { return '<p class="reply-note">Invalid JSON; source is shown unchanged.</p><pre class="raw-source">'+escapeHtml(source)+'</pre>'; }
  }
  return `<pre class="raw-source">${escapeHtml(source)}</pre>`;
}

/** Explicit, per-preview interaction. The child stays opaque: no same-origin,
 * preload, model bridge, navigation, popups, downloads, workers or network. */
export function interactivePreview(source:string):string {
  const template=document.implementation.createHTMLDocument('').createElement('template');
  template.innerHTML=source.slice(0,100000);
  for(const element of [...template.content.querySelectorAll('*')]) {
    const tag=element.tagName.toLowerCase();
    if(['iframe','frame','frameset','object','embed','base','meta','link'].includes(tag)){element.remove();continue;}
    if(tag==='script'){
      if(element.hasAttribute('src')||element.getAttribute('type')==='module'){element.remove();continue;}
      for(const attr of [...element.attributes])element.removeAttribute(attr.name);
      element.setAttribute('nonce','workbench-artifact');continue;
    }
    for(const attr of [...element.attributes]){
      const name=attr.name.toLowerCase();
      if(name.startsWith('on')||['href','action','formaction','target','srcdoc','ping','download','srcset'].includes(name))element.removeAttribute(attr.name);
      if(name==='src'&&!(tag==='img'&&/^data:image\/(?:png|jpeg|webp);base64,/i.test(attr.value)))element.removeAttribute(attr.name);
    }
    if(tag==='style')element.setAttribute('nonce','workbench-artifact');
  }
  return '<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'nonce-workbench-artifact\'; style-src \'unsafe-inline\'; img-src data:; connect-src \'none\'; frame-src \'none\'; object-src \'none\'; worker-src \'none\'; base-uri \'none\'; form-action \'none\'"><style nonce="workbench-artifact">html{color-scheme:dark;background:transparent}body{font:15px/1.55 system-ui;margin:0;padding:8px 0;background:transparent;color:#d4d4d4}img,svg{max-width:100%}</style></head><body>'+template.innerHTML+'</body></html>';
}
