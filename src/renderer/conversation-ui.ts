import { escapeHtml as e } from '../core/markdown.js';
import { icon } from './icons.js';

/** Shared conversation chrome. Callers supply actions and data, never a second visual layout. */
export function heading(crumbs: string, id: string, title: string, label: string, extra = ''): string {
  return `<div class="thread-heading"><div class="thread-crumbs">${crumbs}</div><h1><button type="button" class="toolbar-title" data-action="rename-thread" id="${id}" title="${e(label)}">${e(title)}</button></h1>${extra}</div>`;
}
export function readingButtons(): string {
  return `<button type="button" class="icon-button" data-action="find" title="Find in conversation" aria-label="Find in conversation">${icon('search')}</button><button type="button" class="icon-button" data-action="view" title="Reading & visibility" aria-label="Reading & visibility">${icon('eye')}</button>`;
}
export function pendingSettings(id: string): string {
  return `<div class="pending-settings hidden" id="${id}" role="status"><span>Unapplied settings</span><button type="button" data-action="apply-pending">Apply</button><button type="button" data-action="discard-pending">Discard</button></div>`;
}
export function conversationMenu(items:string):string {
  return `<details class="export-menu"><summary aria-label="Conversation menu" title="Conversation menu">${icon('more')}</summary><div class="export-popover">${items}</div></details>`;
}
export function generationFields(temperature: string, tokens: string, maximum: number, step = 'any', label = 'Output limit'): string {
  return `<div class="two-fields"><div><label for="${temperature}">Temperature</label><input id="${temperature}" type="number" min="0" max="2" step="${step}" placeholder="Provider default"></div><div><label for="${tokens}">${label}</label><input id="${tokens}" type="number" min="1" max="${maximum}" step="1" required></div></div>`;
}
export function reasoningDisclosure(o: { key: string; attrs?: string; contentAttrs: string; open: boolean; thinking?: boolean; label?: string; detail?: string; actions?: string }): string {
  return `<details class="reasoning ${o.thinking ? 'is-thinking' : ''}" data-key="${e(o.key)}" ${o.attrs ?? ''} ${o.open ? 'open' : ''}><summary><span class="reasoning-label">${o.label ?? 'Reasoning'}</span><span class="thinking-wave" aria-hidden="true"><i></i><i></i><i></i></span><small>${o.detail ?? 'Provided by the model'}</small></summary><div class="reasoning-content" data-rich-host ${o.contentAttrs}></div>${o.actions ?? ''}</details>`;
}
export function answerReadActions(id: string, raw: boolean): string {
  return `<button data-action="copy-reply" data-reply="${e(id)}" title="Copy answer">${icon('copy')}<span class="sr-only">Copy</span></button><button data-action="source" data-reply="${e(id)}" aria-pressed="${raw}" title="${raw ? 'Show the rendered answer' : 'Show the source'}">${icon('code')}<span class="sr-only">Source</span></button>`;
}
export function answerFooter(actions: string, signature: string): string {
  return `<div class="reply-footer" data-key="footer"><div class="reply-actions" data-key="actions">${actions}</div>${signature}</div>`;
}
export function answerSignature(model: string, instructions?: string, extras: { html: string; title: string }[] = []): string {
  const parts = [`<span class="signature-model">${e(model)}</span>`], titles = [model];
  if (instructions !== undefined) { const name = instructions || 'Custom instructions'; titles.push('System instructions: ' + name); parts.push(`<span class="signature-instructions">${icon('instructions')}<span class="sr-only">System instructions: </span>${e(name)}</span>`); }
  for (const extra of extras) { parts.push(extra.html); titles.push(extra.title); }
  return `<p class="reply-signature" data-key="signature" title="${e(titles.join(' · '))}">${parts.join('')}</p>`;
}
export function effortMarkup(prefix = ''): string {
  const id = (name: string) => prefix + name;
  return `<span id="${id('quick-effort-wrap')}" class="quick-effort-wrap hidden"><button type="button" id="${id('quick-effort')}" class="quick-effort" aria-haspopup="dialog" aria-expanded="false" aria-controls="${id('effort-panel')}" aria-label="Thinking effort"><span id="${id('effort-gauge')}" class="effort-gauge" aria-hidden="true"></span></button><div id="${id('effort-panel')}" class="effort-panel" role="dialog" aria-label="Thinking effort" hidden><div class="effort-panel-head"><span>Thinking effort</span><strong id="${id('effort-value')}">Default</strong></div><div id="${id('effort-slider')}" class="effort-slider" role="slider" tabindex="0" aria-label="Thinking effort" aria-valuemin="0" aria-valuemax="1" aria-valuenow="0"><div class="effort-track"><div class="effort-fill"></div><div id="${id('effort-ticks')}" class="effort-ticks"></div><div class="effort-thumb"></div></div></div><div id="${id('effort-stops')}" class="effort-stops"></div></div></span>`;
}
