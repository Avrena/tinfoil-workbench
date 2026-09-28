import type { ModelCapability, ModelDisplay } from './capabilities.js';

/** One row of the model picker. Display data only: choosing a row sets the thread's model ID and nothing else. */
export interface PickerModel extends ModelDisplay { id: string; }
export interface Maker { key: string; name: string; mark: string; }

// Keys are the image names in Tinfoil's public catalog ("deepseek.png"), plus aliases for IDs it does not describe.
const MAKERS: Record<string, { name: string; mark: string }> = {
  deepseek: { name: 'DeepSeek', mark: 'DS' }, zai: { name: 'Z.ai', mark: 'GLM' }, moonshot: { name: 'Moonshot AI', mark: 'Ki' },
  gemma: { name: 'Google', mark: 'G' }, google: { name: 'Google', mark: 'G' }, openai: { name: 'OpenAI', mark: 'OAI' },
  llama: { name: 'Meta', mark: 'L' }, meta: { name: 'Meta', mark: 'L' }, mistral: { name: 'Mistral AI', mark: 'M' },
  qwen: { name: 'Qwen', mark: 'Q' }, nomic: { name: 'Nomic', mark: 'N' },
};
// Applied to the part after a vendor prefix such as "deepseek-ai/".
const PREFIXES: [RegExp, string][] = [
  [/^deepseek/, 'deepseek'], [/^glm/, 'zai'], [/^kimi/, 'moonshot'], [/^gemma/, 'gemma'], [/^(?:gpt-oss|whisper)/, 'openai'],
  [/^llama/, 'llama'], [/^(?:mistral|voxtral|devstral|magistral|ministral|codestral|pixtral)/, 'mistral'], [/^qwen/, 'qwen'], [/^nomic/, 'nomic'],
];

/** The catalog's maker, else one inferred from the ID; unknown makers get the initials of the model's name. */
export function makerOf(model: Pick<PickerModel, 'id' | 'name' | 'maker'>): Maker {
  const bare = model.id.toLowerCase().split('/').pop() ?? '';
  const key = MAKERS[model.maker] ? model.maker : PREFIXES.find(([pattern]) => pattern.test(bare))?.[1] ?? '';
  if (key) return { key, ...MAKERS[key]! };
  const words = (model.name.split('/').pop() ?? '').split(/[^A-Za-z0-9]+/).filter(Boolean);
  return { key: '', name: '', mark: (words.slice(0, 2).map(w => w[0]).join('') || '?').toUpperCase() };
}

const unlisted = (id: string): PickerModel => ({ id, name: id, short: '', maker: '', type: '', contextWindow: null,
  multimodal: false, reasoning: false, tools: false, experimental: false, description: '' });
const forChat = (d: ModelDisplay): boolean => !d.type || d.type === 'chat';

/** Chat models in the order Tinfoil's catalog lists them, then IDs the verified endpoint returned without metadata.
 * Models the metadata marks as another type (speech, embeddings, documents, tools, safety) are left out. */
export function pickerModels(models: readonly string[], capabilities: readonly ModelCapability[] = []): PickerModel[] {
  const out: PickerModel[] = [], seen = new Set<string>();
  for (const c of capabilities) if (c.display && !seen.has(c.id)) { seen.add(c.id); if (forChat(c.display)) out.push({ ...c.display, id: c.id }); }
  for (const id of models) if (!seen.has(id)) { seen.add(id); out.push(unlisted(id)); }
  return out;
}

/** The entry for a thread's model, including an ID that no list describes. */
export function pickerModel(id: string, capabilities: readonly ModelCapability[] = []): PickerModel {
  const display = capabilities.find(c => c.id === id && c.display)?.display;
  return display ? { ...display, id } : unlisted(id);
}

export function modelMatches(model: PickerModel, query: string): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const maker = makerOf(model), text = [model.id, model.name, model.short, maker.name, maker.mark].join(' ').toLowerCase();
  return words.every(word => text.includes(word));
}

/** Context sizes in the binary units the catalog uses: 1048576 → "1M", 131072 → "128K". */
export function contextLabel(tokens: number): string {
  if (tokens >= 1048576 && tokens % 1048576 === 0) return `${tokens / 1048576}M`;
  if (tokens >= 1_000_000) return `${Math.round(tokens / 100_000) / 10}M`;
  if (tokens >= 1024 && tokens % 1024 === 0) return `${tokens / 1024}K`;
  return tokens >= 1000 ? `${Math.round(tokens / 1000)}K` : String(tokens);
}
