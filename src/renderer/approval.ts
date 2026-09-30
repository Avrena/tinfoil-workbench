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
  document.title = request.title; document.body.dataset.kind = request.kind;
  $('title').textContent = request.title;
  const body = $('body');
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
