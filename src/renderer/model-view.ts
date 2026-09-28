import { escapeHtml as e } from '../core/markdown.js';
import { contextLabel, makerOf, type PickerModel } from '../core/model-list.js';
import { icon } from './icons.js';

/** A model's maker as an inline SVG monogram. Each surface colours it in CSS: `currentColor` in the composer and on the
 * welcome page, a per-maker fill in list badges. `null` draws the neutral mark shown before a model is chosen. */
export function makerMark(model: PickerModel | null, className = 'maker-mark'): string {
  if (!model) return `<svg class="${className} maker-none" viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="16" r="14.5"/><path d="m16 9.5 1.7 4.8 4.8 1.7-4.8 1.7-1.7 4.8-1.7-4.8-4.8-1.7 4.8-1.7z"/></svg>`;
  const maker = makerOf(model), mark = maker.mark.slice(0, 3), size = mark.length >= 3 ? 9.5 : mark.length === 2 ? 11.5 : 14;
  return `<svg class="${className}${maker.key ? ` maker-${maker.key}` : ''}" viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="16" r="14.5"/><text x="16" y="16.6" text-anchor="middle" dominant-baseline="middle" font-size="${size}">${e(mark)}</text></svg>`;
}

const FLAGS = [['reasoning', 'spark', 'Reasoning'], ['multimodal', 'image', 'Image input'], ['tools', 'tools', 'Tool calling']] as const;

/** One picker row. Its accessible name spells out what the badge and the marks show. */
export function modelRow(model: PickerModel, current: string): string {
  const maker = makerOf(model), selected = model.id === current, flags = FLAGS.filter(([key]) => model[key]);
  const context = model.contextWindow ? contextLabel(model.contextWindow) : '';
  const detail = [maker.name, model.name !== model.id ? model.id : ''].filter(Boolean).join(' · ');
  const label = [model.name, maker.name, model.experimental ? 'experimental' : '', ...flags.map(([, , text]) => text.toLowerCase()),
    context ? `${context} context` : '', selected ? 'current model' : ''].filter(Boolean).join(', ');
  return `<button type="button" class="model-option" data-quick-model="${e(model.id)}" aria-label="${e(label)}"${selected ? ' aria-current="true"' : ''}${model.description ? ` title="${e(model.description)}"` : ''}>`
    + `${makerMark(model, 'maker-badge')}<span class="option-text"><span class="option-title"><span class="option-name">${e(model.name)}</span>${model.experimental ? '<span class="option-tag">Experimental</span>' : ''}</span>`
    + `${detail ? `<span class="option-detail">${e(detail)}</span>` : ''}</span><span class="option-flags">`
    + flags.map(([, glyph, text]) => `<span class="option-flag" title="${text}">${icon(glyph)}</span>`).join('')
    + `${context ? `<span class="option-context" title="Context window: ${model.contextWindow!.toLocaleString('en-US')} tokens">${context}</span>` : ''}</span>`
    + `<span class="option-check">${selected ? icon('check') : ''}</span></button>`;
}

/** Offered when the search text is not a listed ID, so any model ID can still be entered. */
export function customModelRow(id: string): string {
  return `<button type="button" class="model-option model-custom" data-quick-model="${e(id)}" aria-label="${e(`Use model ID ${id}`)}">${makerMark(null, 'maker-badge')}`
    + `<span class="option-text"><span class="option-title"><span class="option-name">Use “${e(id)}”</span></span><span class="option-detail">Model ID not in Tinfoil’s list</span></span></button>`;
}

export function composerModel(model: PickerModel | null, compare: boolean): string {
  return `${makerMark(model, 'maker-badge')}<span class="model-label">${e(model?.name ?? 'Choose model')}</span>${compare ? '<span class="model-count">× 2</span>' : ''}`;
}
