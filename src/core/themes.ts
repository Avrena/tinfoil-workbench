/** Colour themes (Settings → Appearance), shaped like the Codex app's appearance settings: a mode (system, light or
 * dark), and for each variant a preset with its accent, background, foreground and contrast, each of which can be
 * changed. Every colour in the stylesheets is a token (--n40, --a70, --w16, --o-0d, …): one family's base colour mixed
 * with the background, or with the far end beyond the text, at a fixed share. `themeTokens` computes them for a theme;
 * the build writes the Workbench dark values into the stylesheets as their defaults (scripts/build.mjs). */
import type { TagColor } from './types.js';
import { TAG_COLORS } from './tags.js';
export type ThemeVariant = 'dark' | 'light';
export type ThemeMode = 'system' | ThemeVariant;
export interface ThemeColors { accent: string; surface: string; ink: string; contrast: number }
export interface ThemeChoice extends ThemeColors { preset: string }
export interface ThemePreferences { mode: ThemeMode; dark: ThemeChoice; light: ThemeChoice }
export interface ThemePreset { id: string; label: string; dark?: ThemeColors; light?: ThemeColors }

type Seed = [accent: string, surface: string, ink: string, contrast: number];
const colors = ([accent, surface, ink, contrast]: Seed): ThemeColors => ({ accent, surface, ink, contrast });
const preset = (id: string, label: string, variants: { dark?: Seed; light?: Seed }): ThemePreset =>
  ({ id, label, ...(variants.dark ? { dark: colors(variants.dark) } : {}), ...(variants.light ? { light: colors(variants.light) } : {}) });
/** Workbench's own look first; then the Codex app's appearance presets, in its order (by name). Their accent,
 * background and foreground are what the Codex app derives from each theme, and its contrast defaults (60 dark, 45
 * light, Vercel 50 and 40). */
export const THEME_PRESETS: readonly ThemePreset[] = [
  preset('workbench', 'Workbench', { dark: ['#0078d4', '#1e1e1e', '#d4d4d4', 60], light: ['#0078d4', '#ffffff', '#1f1f1f', 45] }),
  preset('absolutely', 'Absolutely', { dark: ['#cc7d5e', '#2d2d2b', '#f9f9f7', 60], light: ['#cc7d5e', '#f9f9f7', '#2d2d2b', 45] }),
  preset('ayu', 'Ayu', { dark: ['#e6b450', '#0b0e14', '#bfbdb6', 60] }),
  preset('catppuccin', 'Catppuccin', { dark: ['#cba6f7', '#1e1e2e', '#cdd6f4', 60], light: ['#8839ef', '#eff1f5', '#4c4f69', 45] }),
  preset('codex', 'Codex', { dark: ['#0169cc', '#111111', '#fcfcfc', 60], light: ['#0169cc', '#ffffff', '#0d0d0d', 45] }),
  preset('dracula', 'Dracula', { dark: ['#ff79c6', '#282a36', '#f8f8f2', 60] }),
  preset('everforest', 'Everforest', { dark: ['#a7c080', '#2d353b', '#d3c6aa', 60], light: ['#93b259', '#fdf6e3', '#5c6a72', 45] }),
  preset('github', 'GitHub', { dark: ['#1f6feb', '#0d1117', '#e6edf3', 60], light: ['#0969da', '#ffffff', '#1f2328', 45] }),
  preset('gruvbox', 'Gruvbox', { dark: ['#458588', '#282828', '#ebdbb2', 60], light: ['#458588', '#fbf1c7', '#3c3836', 45] }),
  preset('linear', 'Linear', { dark: ['#606acc', '#0f0f11', '#e3e4e6', 60], light: ['#5e6ad2', '#fcfcfd', '#1b1b1b', 45] }),
  preset('lobster', 'Lobster', { dark: ['#ff5c5c', '#111827', '#e4e4e7', 60] }),
  preset('material', 'Material', { dark: ['#80cbc4', '#212121', '#eeffff', 60] }),
  preset('matrix', 'Matrix', { dark: ['#1eff5a', '#040805', '#b8ffca', 60] }),
  preset('monokai', 'Monokai', { dark: ['#99947c', '#272822', '#f8f8f2', 60] }),
  preset('night-owl', 'Night Owl', { dark: ['#44596b', '#011627', '#d6deeb', 60] }),
  preset('nord', 'Nord', { dark: ['#88c0d0', '#2e3440', '#d8dee9', 60] }),
  preset('notion', 'Notion', { dark: ['#3183d8', '#191919', '#d9d9d8', 60], light: ['#3183d8', '#ffffff', '#37352f', 45] }),
  preset('og', 'OG', { dark: ['#10a37f', '#343541', '#d1d5db', 60] }),
  preset('one', 'One', { dark: ['#4d78cc', '#282c34', '#abb2bf', 60], light: ['#526fff', '#fafafa', '#383a42', 45] }),
  preset('oscurange', 'Oscurange', { dark: ['#f9b98c', '#0b0b0f', '#e6e6e6', 60] }),
  preset('proof', 'Proof', { light: ['#3d755d', '#f5f3ed', '#2f312d', 45] }),
  preset('raycast', 'Raycast', { dark: ['#ff6363', '#101010', '#fefefe', 60], light: ['#ff6363', '#ffffff', '#030303', 45] }),
  preset('rose-pine', 'Rose Pine', { dark: ['#ea9a97', '#232136', '#e0def4', 60], light: ['#d7827e', '#faf4ed', '#575279', 45] }),
  preset('sentry', 'Sentry', { dark: ['#7055f6', '#2d2935', '#e6dff9', 60] }),
  preset('solarized', 'Solarized', { dark: ['#d30102', '#002b36', '#839496', 60], light: ['#b58900', '#fdf6e3', '#657b83', 45] }),
  preset('temple', 'Temple', { dark: ['#e4f222', '#02120c', '#c7e6da', 60] }),
  preset('tokyo-night', 'Tokyo Night', { dark: ['#3d59a1', '#1a1b26', '#a9b1d6', 60] }),
  preset('vercel', 'Vercel', { dark: ['#006efe', '#000000', '#ededed', 50], light: ['#006aff', '#ffffff', '#171717', 40] }),
  preset('vs-code-plus', 'VS Code Plus', { dark: ['#007acc', '#1e1e1e', '#d4d4d4', 60], light: ['#007acc', '#ffffff', '#000000', 45] }),
  preset('xcode', 'Xcode', { dark: ['#5482ff', '#1f1f24', '#ffffff', 60], light: ['#0e0eff', '#ffffff', '#000000', 45] }),
];
const WORKBENCH = THEME_PRESETS[0]!;
export const defaultTheme: ThemePreferences = { mode: 'dark',
  dark: { preset: 'workbench', ...WORKBENCH.dark! }, light: { preset: 'workbench', ...WORKBENCH.light! } };
export const presetsFor = (variant: ThemeVariant): ThemePreset[] => THEME_PRESETS.filter(p => p[variant]);
export const themePreset = (id: string): ThemePreset | undefined => THEME_PRESETS.find(p => p.id === id);
/** Whether a choice still has its preset's colours. */
export function presetColors(choice: ThemeChoice, variant: ThemeVariant): boolean {
  const base = themePreset(choice.preset)?.[variant];
  return !!base && base.accent === choice.accent && base.surface === choice.surface && base.ink === choice.ink && base.contrast === choice.contrast;
}

const HEX = /^#[0-9a-f]{6}$/;
function themeChoice(value: unknown, fallback: ThemeChoice, variant: ThemeVariant): ThemeChoice {
  const v = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const hex = (x: unknown, or: string): string => typeof x === 'string' && HEX.test(x.toLowerCase()) ? x.toLowerCase() : or;
  const id = typeof v.preset === 'string' && themePreset(v.preset)?.[variant] ? v.preset : fallback.preset;
  const base = themePreset(id)?.[variant] ?? fallback;
  return { preset: id, accent: hex(v.accent, base.accent), surface: hex(v.surface, base.surface), ink: hex(v.ink, base.ink),
    contrast: typeof v.contrast === 'number' && Number.isInteger(v.contrast) && v.contrast >= 0 && v.contrast <= 100 ? v.contrast : base.contrast };
}
export function themePreferences(value: unknown): ThemePreferences {
  const v = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  return { mode: v.mode === 'system' || v.mode === 'light' ? v.mode : 'dark',
    dark: themeChoice(v.dark, defaultTheme.dark, 'dark'), light: themeChoice(v.light, defaultTheme.light, 'light') };
}

/** The tokens the stylesheets use (scripts converted each colour literal to one). A name is the family, `l` when it
 * lies beyond the base toward the far end, the share in percent, and an alpha in hex when it is translucent; `o-` and
 * `s-` are light and dark overlays by alpha. */
const TOKENS = ('a100 a18 a27 a34 a48 a55-22 a59 a70 a71 a74 a78 al15 al2 al20 al27 al46 al52 al67 b1 b10 b100-88 b100-99 b20 b21 b3 b4 ' +
  'd100 d20 d29 f100 r100 dl48 dl49 dl55 dl58 dl64 dl65 dl66 dl78 dl9 f14 f15 f35 fl11 fl19 fl33 fl49 fl51 fl51-55 fl53 fl56 fl62 fl82 fl9 ' +
  'g100 g84 g93 g98 gl13 gl16 gl28 gl45 h100 h12 h16 h19 h21 h22 h28 h29 h30 h33 h36 h37 h39 h41 h42 h46 h47 h56 h57 h6 h60 h65 h67 h82 h9 ' +
  'm25 m27 m28 m33 m43 m45 m50 m67 m69 m73 m74 m78 m82 m86 m88 m89 m90 m93 m94 m95 m99 ml27 ml4 ml49 ml58 ' +
  'n0 n1 n1-e6 n10 n100 n12 n13 n14 n15 n16 n17 n18 n19 n2 n20 n21 n22 n23 n24 n25 n27 n28 n3 n30 n37 n4 n4-f2 n40 n41 n42 n49 n5 n50 n53 ' +
  'n54 n57 n58 n59 n6 n60 n62 n63 n64 n65 n66 n67 n68 n69 n7 n70 n71 n72 n73 n74 n75 n76 n77 n78 n79 n8 n80 n81 n82 n83 n84 n85 n86 n87 n88 ' +
  'n9 n90 n91 n92 n93 n95 n96 n97 n98 n99 o-05 o-06 o-08 o-0a o-0d o-0f o-12 o-14 o-59 r17 r33 r40 r62 rl51 s-0d s-20 s-22 s-33 s-55 s-66 s-77 ' +
  'v100 w100 w100-14 w16 w25 w26 w27 w31 w39 w48 w78 w89 w90 w96 w98 w99 wl15 wl27 wl32 wl37 wl48').split(' ');
/** Status and other fixed hues per variant: warning, good, error text and fill, inline code; code highlighting as in
 * VS Code's Dark+ and Light+; search matches. */
const FIXED: Record<ThemeVariant, { bases: Record<'w' | 'g' | 'r' | 'd' | 'v', string>; named: Record<string, string> }> = {
  dark: { bases: { w: '#e6c07a', g: '#87b892', r: '#f2a3a3', d: '#c42b1c', v: '#c5b7ee' },
    named: { 'syn-comment': '#6a9955', 'syn-keyword': '#569cd6', 'syn-string': '#ce9178', 'syn-function': '#dcdcaa', 'syn-number': '#b5cea8',
      'syn-type': '#4ec9b0', 'syn-property': '#9cdcfe', 'syn-regex': '#d16969', match: '#725526', 'match-current': '#b57a28', 'match-current-line': '#e4ae60' } },
  light: { bases: { w: '#8a5d00', g: '#1a7f37', r: '#c4302b', d: '#c42b1c', v: '#7048b0' },
    named: { 'syn-comment': '#008000', 'syn-keyword': '#0000ff', 'syn-string': '#a31515', 'syn-function': '#795e26', 'syn-number': '#098658',
      'syn-type': '#267f99', 'syn-property': '#001080', 'syn-regex': '#811f3f', match: '#fff0a6', 'match-current': '#ffd35c', 'match-current-line': '#b07800' } },
};
/** Tag colours (core/tags.ts): the chart palette's categorical steps for each variant (core/visual-tools.ts, from the
 * validated dataviz reference palette) and a grey. A chip is drawn in `tag-<colour>-fill`, the colour mixed into the
 * theme's background, with the theme's own text on it; the colour itself marks its dot. */
const TAG_STEPS: Record<ThemeVariant, Record<TagColor, string>> = {
  dark: { blue: '#3987e5', orange: '#d95926', aqua: '#199e70', yellow: '#c98500', magenta: '#d55181', green: '#008300', violet: '#9085e9', red: '#e66767', grey: '#8f8e88' },
  light: { blue: '#2a78d6', orange: '#eb6834', aqua: '#1baf7a', yellow: '#eda100', magenta: '#e87ba4', green: '#008300', violet: '#4a3aa7', red: '#e34948', grey: '#8a8984' },
};
interface Rgb { r: number; g: number; b: number }
const parse = (hex: string): Rgb => ({ r: parseInt(hex.slice(1, 3), 16), g: parseInt(hex.slice(3, 5), 16), b: parseInt(hex.slice(5, 7), 16) });
const mix = (x: Rgb, y: Rgb, share: number): Rgb => { const p = Math.max(0, Math.min(1, share)); return { r: x.r * p + y.r * (1 - p), g: x.g * p + y.g * (1 - p), b: x.b * p + y.b * (1 - p) }; };
const channel = (n: number): string => Math.round(Math.max(0, Math.min(255, n))).toString(16).padStart(2, '0');
const css = (c: Rgb, alpha = 1): string => alpha >= 1 ? `#${channel(c.r)}${channel(c.g)}${channel(c.b)}` : `#${channel(c.r)}${channel(c.g)}${channel(c.b)}${channel(alpha * 255)}`;
/** The accent as text or an icon on the background: its hue and saturation, made light enough on a dark background
 * (at least 70% lightness) or dark enough on a light one (at most 40%). */
function accentText(fill: Rgb, dark: boolean): Rgb {
  const r = fill.r / 255, g = fill.g / 255, b = fill.b / 255, max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  const l = (max + min) / 2, s = d ? d / (1 - Math.abs(2 * l - 1)) : 0;
  const h = !d ? 0 : max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  const target = dark ? Math.max(l, .7) : Math.min(l, .4), c = (1 - Math.abs(2 * target - 1)) * s, x = c * (1 - Math.abs(h % 2 - 1)), m = target - c / 2;
  const [p, q, t] = h < 1 ? [c, x, 0] : h < 2 ? [x, c, 0] : h < 3 ? [0, c, x] : h < 4 ? [0, x, c] : h < 5 ? [x, 0, c] : [c, 0, x];
  return { r: (p + m) * 255, g: (q + m) * 255, b: (t + m) * 255 };
}
const luminance = (c: Rgb): number => { const f = (n: number): number => { const v = n / 255; return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }; return .2126 * f(c.r) + .7152 * f(c.g) + .0722 * f(c.b); };
const contrast = (x: Rgb, y: Rgb): number => { const [a, b] = [luminance(x), luminance(y)].sort((m, n) => n - m); return (a! + .05) / (b! + .05); };
/** Every token's colour for a theme. Contrast (0–100, around the variant's default) spreads or narrows the greys and
 * overlays near the background, which draw panels, lines and hovers; text keeps its shade. */
export function themeTokens(theme: ThemeColors, variant: ThemeVariant): Record<string, string> {
  const dark = variant === 'dark', S = parse(theme.surface), I = parse(theme.ink), F = parse(theme.accent);
  const T = dark ? { r: 255, g: 255, b: 255 } : { r: 0, g: 0, b: 0 }, D = dark ? { r: 0, g: 0, b: 0 } : mix(I, S, .3);
  const A = accentText(F, dark), fixed = FIXED[variant];
  const bases: Record<string, Rgb> = { f: F, a: A, m: mix(A, I, .5), ...Object.fromEntries(Object.entries(fixed.bases).map(([k, v]) => [k, parse(v)])) };
  const k = 2 ** ((theme.contrast - (dark ? 60 : 45)) / 40);
  // Near the background the share is scaled by k, easing back to the plain share by the middle, so the order holds.
  const spread = (p: number): number => p >= 50 ? p : p * (k + (1 - k) * p / 50);
  const out: Record<string, string> = {};
  for (const name of TOKENS) {
    const overlay = /^([os])-([0-9a-f]{2})$/.exec(name);
    if (overlay) {
      const alpha = parseInt(overlay[2]!, 16) / 255;
      out[name] = overlay[1] === 'o' ? css(T, Math.min(1, alpha * k)) : css({ r: 0, g: 0, b: 0 }, dark ? alpha : alpha * .45);
      continue;
    }
    const [, family = 'n', beyond, share = '0', alphaHex] = /^([a-z])(l?)(\d+)(?:-([0-9a-f]{2}))?$/.exec(name) ?? [];
    const p = Number(share) / 100, alpha = alphaHex ? parseInt(alphaHex, 16) / 255 : 1;
    const color = family === 'n' ? mix(I, S, spread(p * 100) / 100) : family === 'b' ? mix(D, S, spread(p * 100) / 100) : family === 'h' ? mix(T, I, p)
      : beyond ? mix(T, bases[family]!, p) : mix(bases[family]!, S, p);
    out[name] = css(color, alpha);
  }
  for (const [name, value] of Object.entries(fixed.named)) out[name] = value;
  for (const color of TAG_COLORS) {
    const step = TAG_STEPS[variant][color];
    out[`tag-${color}`] = step; out[`tag-${color}-fill`] = css(mix(parse(step), S, dark ? .26 : .16));
  }
  // Text on the accent fill: white where it reads (3:1, as for large text and icons), otherwise near black.
  out['on-f'] = contrast(F, { r: 255, g: 255, b: 255 }) >= 3 ? '#ffffff' : '#111111';
  return out;
}
/** The tokens as a stylesheet rule, for the build's defaults and the approval window. */
export const tokenRule = (selector: string, tokens: Record<string, string>): string =>
  `${selector}{${Object.entries(tokens).map(([name, value]) => `--${name}:${value}`).join(';')}}`;
/** The variant a mode shows, given whether the system prefers dark. */
export const themeVariant = (mode: ThemeMode, systemDark: boolean): ThemeVariant => mode === 'system' ? (systemDark ? 'dark' : 'light') : mode;
