import { escapeHtml as e } from '../core/markdown.js';
import { contextLabel, makerOf, type PickerModel } from '../core/model-list.js';
import { icon } from './icons.js';
import { makerLogo } from './maker-logos.js';

/** A model's maker as inline SVG: its logo where one is known, else a monogram. Badges (list rows, the composer)
 * draw it in white on the maker's colour; the welcome page draws the logo alone, or the monogram in a ring, in
 * `currentColor`. `null` draws the neutral mark shown before a model is chosen. */
export function makerMark(model: PickerModel | null, className = 'maker-mark'): string {
  const badge = className === 'maker-badge', r = badge ? 15.5 : 14.5;
  if (!model) return `<svg class="${className} maker-none" viewBox="0 0 32 32" aria-hidden="true" focusable="false"><circle cx="16" cy="16" r="${r}"/><path d="m16 9.5 1.7 4.8 4.8 1.7-4.8 1.7-1.7 4.8-1.7-4.8-4.8-1.7 4.8-1.7z"/></svg>`;
  const maker = makerOf(model), logo = makerLogo(maker.key), classes = `${className}${maker.key ? ` maker-${maker.key}` : ''}`;
  if (logo) {
    const glyph = `<g fill-rule="evenodd"${badge ? ' transform="translate(6.4 6.4) scale(.8)"' : ''}>${logo.map(d => `<path d="${d}"/>`).join('')}</g>`;
    return `<svg class="${classes} maker-logo" viewBox="0 0 ${badge ? 32 : 24} ${badge ? 32 : 24}" aria-hidden="true" focusable="false">${badge ? `<circle cx="16" cy="16" r="${r}"/>` : ''}${glyph}</svg>`;
  }
  const mark = maker.mark.slice(0, 3), size = mark.length >= 3 ? 9.5 : mark.length === 2 ? 11.5 : 14;
  return `<svg class="${classes}" viewBox="0 0 32 32" aria-hidden="true" focusable="false"><circle cx="16" cy="16" r="${r}"/><text x="16" y="16.6" text-anchor="middle" dominant-baseline="middle" font-size="${size}">${e(mark)}</text></svg>`;
}

const FLAGS = [['reasoning', 'spark', 'Reasoning'], ['multimodal', 'image', 'Image input'], ['tools', 'tools', 'Tool calling']] as const;

/** One picker row. Its accessible name spells out what the badge and the marks show; the description is shown in
 * two lines at most and in full as the row's tooltip. The marks keep fixed columns, so absent ones leave a gap. */
export function modelRow(model: PickerModel, current: string): string {
  const maker = makerOf(model), selected = model.id === current, flags = FLAGS.filter(([key]) => model[key]);
  const context = model.contextWindow ? contextLabel(model.contextWindow) : '';
  const detail = [maker.name, model.name !== model.id ? model.id : ''].filter(Boolean).join(' · ');
  const label = [model.name, maker.name, model.experimental ? 'experimental' : '', ...flags.map(([, , text]) => text.toLowerCase()),
    context ? `${context} context` : '', selected ? 'current model' : ''].filter(Boolean).join(', ');
  return `<button type="button" class="model-option" data-quick-model="${e(model.id)}" aria-label="${e(label)}"${selected ? ' aria-current="true"' : ''}${model.description ? ` title="${e(model.description)}"` : ''}>`
    + `${makerMark(model, 'maker-badge')}<span class="option-text"><span class="option-title"><span class="option-name">${e(model.name)}</span>${model.experimental ? '<span class="option-tag">Experimental</span>' : ''}</span>`
    + `${model.description ? `<span class="option-description">${e(model.description)}</span>` : ''}`
    + `${detail ? `<span class="option-detail">${e(detail)}</span>` : ''}</span><span class="option-flags">`
    + FLAGS.map(([key, glyph, text]) => model[key] ? `<span class="option-flag" title="${text}">${icon(glyph)}</span>` : '<span class="option-flag"></span>').join('')
    + `<span class="option-context"${context ? ` title="Context window: ${model.contextWindow!.toLocaleString('en-US')} tokens"` : ''}>${context}</span></span>`
    + `<span class="option-check">${selected ? icon('check') : ''}</span></button>`;
}

/** Offered when the search text is not a listed ID, so any model ID can still be entered. */
export function customModelRow(id: string): string {
  return `<button type="button" class="model-option model-custom" data-quick-model="${e(id)}" aria-label="${e(`Use model ID ${id}`)}">${makerMark(null, 'maker-badge')}`
    + `<span class="option-text"><span class="option-title"><span class="option-name">Use “${e(id)}”</span></span><span class="option-detail">Model ID not in Tinfoil’s list</span></span></button>`;
}

export function composerModel(model: PickerModel | null, compare: boolean): string {
  return `${makerMark(model, 'maker-badge')}<span class="model-label">${e(model?.name ?? 'Choose model')}</span>${compare ? '<span class="model-count">× 2</span>' : ''}<span class="model-chevron" aria-hidden="true">${icon('down')}</span>`;
}
