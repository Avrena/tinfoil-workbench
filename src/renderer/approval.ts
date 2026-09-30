import type { ApprovalRequest } from '../core/approval.js';

/** The approval window's page (desktop/approval-window.mjs). Its bridge fetches the one request the main process opened
 * it for and sends back one decision; there is no other bridge here. Everything is drawn as text, never as HTML. */
interface Bridge { request(): Promise<ApprovalRequest | null>; decide(approve: boolean): void; fit(height: number): void }
const bridge = (window as unknown as { approval: Bridge }).approval;
/** Approve stays unavailable for a moment, so a click or key press meant for the conversation cannot land on it. */
const ARMING_MS = 700;

const $ = (id: string): HTMLElement => document.getElementById(id)!;
function element(tag: string, className: string, text?: string): HTMLElement {
  const node = document.createElement(tag); node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
/** The mark beside a confirmation's question, drawn like the app's icons: a triangle for a warning or a deletion (the
 * tone colours it), a circle for a question. Its outline first, then the strokes inside it. */
const MARKS: Record<'question' | 'warning', string[]> = {
  question: ['M12 2.8a9.2 9.2 0 1 0 0 18.4 9.2 9.2 0 0 0 0-18.4z', 'M9.6 9.3a2.5 2.5 0 1 1 3.5 2.3c-.7.3-1.1.9-1.1 1.7v.3', 'M12 16.9v.1'],
  warning: ['M10.3 3.9 2.5 17.4A2 2 0 0 0 4.2 20.4h15.6a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z', 'M12 9.2v4.3', 'M12 16.9v.1'],
};
function mark(tone: ApprovalRequest['tone']): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg', svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('class', 'mark');
  MARKS[tone === 'question' ? 'question' : 'warning'].forEach((d, index) => {
    const path = document.createElementNS(ns, 'path');
    path.setAttribute('d', d); path.setAttribute('class', index ? 'mark-line' : 'mark-shape'); svg.append(path);
  });
  return svg;
}
/** The command or code, with each path outside the folder that it names marked where it appears. */
function marked(text: string, paths: string[]): DocumentFragment {
  const lower = text.toLowerCase(), ranges: Array<[number, number]> = [];
  for (const path of paths) {
    const needle = path.toLowerCase();
    if (!needle) continue;
    for (let at = lower.indexOf(needle); at >= 0; at = lower.indexOf(needle, at + needle.length)) ranges.push([at, at + needle.length]);
  }
  ranges.sort((a, b) => a[0] - b[0] || b[1] - a[1]);
  const fragment = document.createDocumentFragment();
  let cursor = 0;
  for (const [start, end] of ranges) {
    if (start < cursor) continue;
    fragment.append(text.slice(cursor, start), element('mark', 'outside-path', text.slice(start, end)));
    cursor = end;
  }
  fragment.append(text.slice(cursor));
  return fragment;
}

async function show(): Promise<void> {
  const request = await bridge.request();
  if (!request) { bridge.decide(false); return; }
  document.title = request.title; document.body.dataset.kind = request.kind; document.body.dataset.tone = request.tone ?? '';
  if (request.kind === 'confirm') $('title').replaceChildren(mark(request.tone ?? 'question'), element('span', 'title-text', request.title));
  else $('title').textContent = request.title;
  const body = $('body');
  for (const paragraph of (request.message ?? '').split(/\n{2,}/)) if (paragraph.trim()) body.append(element('p', 'message', paragraph));
  if (request.text !== undefined) { const pre = element('pre', 'code'); pre.append(marked(request.text, request.outside)); body.append(pre); }
  if (request.diff) {
    const pre = element('pre', 'diff');
    for (const row of request.diff) pre.append(element('span', row.startsWith('@@') ? 'hunk' : row.startsWith('+') ? 'add' : row.startsWith('-') ? 'del' : 'ctx', row || ' '));
    body.append(pre);
  }
  for (const fact of request.facts) $('facts').append(element('p', 'fact', fact));
  if (request.outside.length) {
    for (const path of request.outside) $('outside-list').append(element('li', '', path));
    $('outside').hidden = false;
  }
  $('warning').textContent = request.warning;
  const decline = $('decline') as HTMLButtonElement, approve = $('approve') as HTMLButtonElement;
  decline.textContent = request.decline; approve.textContent = request.approve;
  let decided = false;
  const decide = (value: boolean): void => { if (decided) return; decided = true; bridge.decide(value); };
  decline.addEventListener('click', () => decide(false));
  approve.addEventListener('click', () => { if (!approve.disabled) decide(true); });
  document.addEventListener('keydown', event => { if (event.key === 'Escape') { event.preventDefault(); decide(false); } });
  decline.focus();
  setTimeout(() => { approve.disabled = false; }, ARMING_MS);
  // The content's own height, which can be less than the window's; the document's is never less.
  requestAnimationFrame(() => bridge.fit(Math.ceil(document.querySelector('main')!.getBoundingClientRect().height)));
}
void show();
