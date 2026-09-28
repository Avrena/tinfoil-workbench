/** Provider-specific capability normalization. Catalog data can tune reasoning;
 * it cannot override destinations, credentials, messages, or tool permissions. */
export interface ModelCapability {
  id: string; label: string; known: boolean; source: 'catalog' | 'bundled' | 'unknown';
  reasoning: boolean; effort: string[]; toggle: boolean;
  defaultEnabled: boolean; enable: Record<string, unknown>; disable: Record<string, unknown>;
  toolCalling: boolean | null;
  /** Display-only metadata for the model picker; it never selects parameters, endpoints or permissions. */
  display?: ModelDisplay;
}
export interface ModelDisplay {
  name: string; short: string; maker: string; type: string; contextWindow: number | null;
  multimodal: boolean; reasoning: boolean; tools: boolean; experimental: boolean; description: string;
}
export type ThinkingMode = 'default' | 'enabled' | 'disabled';
const obj = (v: unknown): Record<string, any> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, any> : {};
const safeValue = (v: unknown, depth = 0): unknown => {
  if (typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= 1e6)) return v;
  if (typeof v === 'string' && v.length < 80 && /^[\w$.-]+$/.test(v)) return v;
  if (depth >= 3 || !v || Array.isArray(v) || typeof v !== 'object') return undefined;
  const out: Record<string, unknown> = {};
  for (const [k, value] of Object.entries(v).slice(0, 20)) {
    if (!/^[a-zA-Z][\w]{0,50}$/.test(k) || ['constructor','prototype','__proto__'].includes(k)) continue;
    const safe = safeValue(value, depth + 1); if (safe !== undefined) out[k] = safe;
  }
  return out;
};
function parameterBlock(value: unknown): Record<string, unknown> {
  const input = obj(value), out: Record<string, unknown> = {};
  for (const key of ['reasoning_effort','thinking','reasoning','chat_template_kwargs']) {
    const v = safeValue(input[key]); if (v !== undefined) out[key] = v;
  }
  return out;
}
const plain = (v: unknown, max: number): string => typeof v === 'string' ? v.replace(/[\x00-\x1f\x7f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '';
/** Accepts Tinfoil's catalog (`contextWindowTokens`, `toolCalling`, `image`) and `/v1/models` (`context_window`, `tool_calling`) fields.
 * The maker is the catalog image's file name ("deepseek.png"); the image itself is never loaded. */
function modelDisplay(m: Record<string, any>, id: string, reasoning: boolean): ModelDisplay {
  const maker = typeof m.image === 'string' ? /^(?:[\w.-]*\/)*([a-z0-9][a-z0-9-]{0,31})\.(?:png|svg|webp|jpe?g)$/i.exec(m.image)?.[1]?.toLowerCase() ?? '' : '';
  const tokens = Number(m.contextWindowTokens ?? m.context_window);
  return {
    name: plain(m.name, 120) || id, short: plain(m.nameShort, 60), maker,
    type: typeof m.type === 'string' && /^[a-z][a-z0-9-]{0,23}$/.test(m.type) ? m.type : '',
    contextWindow: Number.isSafeInteger(tokens) && tokens > 0 && tokens <= 1e9 ? tokens : null,
    multimodal: m.multimodal === true, reasoning: reasoning || m.reasoning === true,
    tools: m.toolCalling === true || m.tool_calling === true, experimental: m.experimental === true, description: plain(m.description, 240),
  };
}
export function normalizeCapability(value: unknown): ModelCapability | null {
  const m = obj(value), id = m.modelName ?? m.id;
  if (typeof id !== 'string' || !id || id.length > 200 || /[\x00-\x1f]/.test(id)) return null;
  const chat = obj(m.chatConfig), r = obj(chat.reasoningConfig ?? m.reasoningConfig);
  const reasoning = Object.keys(r).length > 0 || !!chat.reasoningConfig;
  const endpoint = obj(obj(r.params)['/v1/chat/completions']);
  const effort = r.supportsEffort === true ? [...new Set(Object.keys(obj(r.effortMap)).length ? Object.values(obj(r.effortMap)) : ['low','medium','high'])].filter((s): s is string => typeof s === 'string' && /^(minimal|low|medium|high|xhigh|max|ultra)$/.test(s)) : [];
  let enable = parameterBlock(endpoint.enable);
  if (effort.length && !JSON.stringify(enable).includes('$EFFORT')) enable = { ...enable, reasoning_effort: '$EFFORT' };
  const disable = parameterBlock(endpoint.disable);
  const known = 'chatConfig' in m || 'reasoningConfig' in m;
  return { id, label: typeof m.name === 'string' ? m.name.slice(0,200) : id, known,
    source: known ? 'catalog' : 'unknown', reasoning, effort, toggle: r.supportsToggle === true && Object.keys(disable).length > 0,
    defaultEnabled: r.defaultEnabled !== false, enable, disable, toolCalling: typeof m.toolCalling === 'boolean' ? m.toolCalling : null,
    display: modelDisplay(m, id, reasoning) };
}
export function capabilityFor(id: string, catalog: ModelCapability[] = []): ModelCapability {
  const live = catalog.find(m => m.id === id && m.known); if (live) return live;
  const base: ModelCapability = { id, label: id, known: false, source: 'unknown', reasoning: false, effort: [], toggle: false, defaultEnabled: true, enable: {}, disable: {}, toolCalling: catalog.find(m => m.id === id)?.toolCalling ?? null };
  // These narrow, provider-specific fallbacks never infer all models in a family.
  // Kimi K3's fixed-effort fallback follows this project's user requirement.
  if (/^(?:moonshotai\/)?kimi[-_]k3(?:[-_]thinking)?$/i.test(id)) return { ...base, known: true, source: 'bundled', reasoning: true };
  // Tinfoil's published ReasoningConfig describes V4's high/max wire vocabulary.
  if (/^(?:deepseek-ai\/)?deepseek[-_]v4[-_](?:pro|flash)$/i.test(id)) return { ...base, known: true, source: 'bundled', reasoning: true, effort: ['high','max'], enable: { reasoning_effort: '$EFFORT' } };
  return base;
}
export function reasoningParameters(cap: ModelCapability, effort: string, thinking: ThinkingMode = 'default'): Record<string, unknown> {
  if (!cap.known || !cap.reasoning) return {};
  if (thinking === 'disabled') return cap.toggle ? structuredClone(cap.disable) : {};
  const validEffort = cap.effort.includes(effort);
  if (thinking === 'default' && !validEffort) return {};
  if (thinking === 'enabled' && !cap.toggle && !validEffort) return {};
  const substitute = (value: unknown): unknown => {
    if (value === '$EFFORT') return validEffort ? effort : undefined;
    if (!value || typeof value !== 'object') return value;
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value)) { const n = substitute(v); if (n !== undefined && !(typeof n === 'object' && n && !Object.keys(n).length)) out[key] = n; }
    return out;
  };
  return substitute(cap.enable) as Record<string, unknown>;
}
