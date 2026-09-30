import { defaultTheme, themePreferences, type ThemePreferences } from './themes.js';
export interface ViewPreferences {
  motion: 'system' | 'reduced'; autoArtifacts: boolean; sidebar: boolean; inspector: boolean; focus: boolean;
  reasoning: 'collapsed' | 'expanded' | 'hidden';
  markdown: boolean; math: boolean; metadata: boolean; wrapCode: boolean;
  /** Which threads the sidebar lists while Tinfoil cloud chats are connected. */
  threadTab: 'cloud' | 'local';
  /** The composer offers adding assistant and system messages (the transcript editor); off unless turned on. */
  roleMessages: boolean;
  /** The sidebar's Projects and Threads sections, folded to their headings. */
  projectsFolded: boolean; threadsFolded: boolean;
  /** Settings → Appearance (core/themes.ts). */
  theme: ThemePreferences;
  /** Settings → Chat background. */
  background: BackgroundPreferences;
}
/** What shows behind the conversation: nothing, a fine texture drawn in the theme's text colour (Tinfoil Chat's grid,
 * dots or grain) at a strength, or the user's picture, which can be blurred, turned grey and dimmed toward the
 * background. Each of those three is a switch whose slider appears only while it is on, and keeps its value when off. */
export interface BackgroundPreferences {
  kind: 'none' | 'texture' | 'picture';
  texture: 'grid' | 'dots' | 'grain'; strength: number;
  blur: { on: boolean; value: number }; greyscale: { on: boolean; value: number }; dim: { on: boolean; value: number };
}
export const BACKGROUND_RANGES = { strength: [5, 100], blur: [1, 40], greyscale: [5, 100], dim: [5, 95] } as const;
export const defaultBackground: BackgroundPreferences = { kind: 'none', texture: 'grid', strength: 50,
  blur: { on: false, value: 12 }, greyscale: { on: false, value: 100 }, dim: { on: true, value: 55 } };
export function backgroundPreferences(value: unknown): BackgroundPreferences {
  const v = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const within = (x: unknown, [low, high]: readonly [number, number], fallback: number): number => typeof x === 'number' && Number.isInteger(x) && x >= low && x <= high ? x : fallback;
  const toggle = (x: unknown, range: readonly [number, number], fallback: { on: boolean; value: number }): { on: boolean; value: number } => {
    const t = x && typeof x === 'object' ? x as Record<string, unknown> : {};
    return { on: typeof t.on === 'boolean' ? t.on : fallback.on, value: within(t.value, range, fallback.value) };
  };
  return { kind: v.kind === 'texture' || v.kind === 'picture' ? v.kind : 'none', texture: v.texture === 'dots' || v.texture === 'grain' ? v.texture : 'grid',
    strength: within(v.strength, BACKGROUND_RANGES.strength, defaultBackground.strength),
    blur: toggle(v.blur, BACKGROUND_RANGES.blur, defaultBackground.blur), greyscale: toggle(v.greyscale, BACKGROUND_RANGES.greyscale, defaultBackground.greyscale),
    dim: toggle(v.dim, BACKGROUND_RANGES.dim, defaultBackground.dim) };
}
export const defaultView: ViewPreferences = {
  motion: 'system', autoArtifacts: false, sidebar: true, inspector: false, focus: false, reasoning: 'collapsed',
  markdown: true, math: true, metadata: false, wrapCode: false, threadTab: 'cloud', roleMessages: false,
  projectsFolded: false, threadsFolded: false, theme: defaultTheme, background: defaultBackground,
};
export function viewPreferences(value: unknown): ViewPreferences {
  const v = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const result = { ...defaultView };
  for (const key of ['autoArtifacts','sidebar','inspector','focus','markdown','math','metadata','wrapCode','roleMessages','projectsFolded','threadsFolded'] as const) {
    if (typeof v[key] === 'boolean') result[key] = v[key] as boolean;
  }
  if (['collapsed','expanded','hidden'].includes(String(v.reasoning))) result.reasoning = v.reasoning as ViewPreferences['reasoning'];
  if (v.motion === 'reduced') result.motion = 'reduced';
  if (v.threadTab === 'local') result.threadTab = 'local';
  result.theme = themePreferences(v.theme); result.background = backgroundPreferences(v.background);
  return result;
}
