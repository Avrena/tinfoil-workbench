export interface ViewPreferences {
  motion: 'system' | 'reduced'; autoArtifacts: boolean; sidebar: boolean; inspector: boolean; focus: boolean;
  reasoning: 'collapsed' | 'expanded' | 'hidden';
  markdown: boolean; math: boolean; metadata: boolean; wrapCode: boolean;
}
export const defaultView: ViewPreferences = {
  motion: 'system', autoArtifacts: false, sidebar: true, inspector: false, focus: false, reasoning: 'collapsed',
  markdown: true, math: true, metadata: false, wrapCode: false,
};
export function viewPreferences(value: unknown): ViewPreferences {
  const v = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const result = { ...defaultView };
  for (const key of ['autoArtifacts','sidebar','inspector','focus','markdown','math','metadata','wrapCode'] as const) {
    if (typeof v[key] === 'boolean') result[key] = v[key] as boolean;
  }
  if (['collapsed','expanded','hidden'].includes(String(v.reasoning))) result.reasoning = v.reasoning as ViewPreferences['reasoning'];
  if (v.motion === 'reduced') result.motion = 'reduced';
  return result;
}
