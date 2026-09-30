import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { THEME_PRESETS, defaultTheme, presetsFor, presetColors, themePreferences, themeTokens, themeVariant } from '../dist/core/themes.js';
import { viewPreferences } from '../dist/core/preferences.js';

const rgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
const distance = (x, y) => Math.hypot(...rgb(x).map((v, i) => v - rgb(y)[i]));
const luminance = hex => { const f = v => { v /= 255; return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }; const [r, g, b] = rgb(hex); return .2126 * f(r) + .7152 * f(g) + .0722 * f(b); };
const ratio = (x, y) => { const [a, b] = [luminance(x), luminance(y)].sort((m, n) => n - m); return (a + .05) / (b + .05); };
const workbench = THEME_PRESETS[0];

test('the Workbench dark theme keeps the colours the stylesheets had', () => {
  const t = themeTokens(workbench.dark, 'dark');
  for (const [token, was, within] of [['n0', '#1e1e1e', 0], ['n100', '#d4d4d4', 0], ['b20', '#181818', 0], ['n4', '#252526', 3], ['n12', '#343434', 3],
    ['n68', '#999b9f', 6], ['f100', '#0078d4', 0], ['r100', '#f2a3a3', 0], ['w100', '#e6c07a', 0], ['a100', '#75bfff', 20], ['syn-keyword', '#569cd6', 0]])
    assert.ok(distance(t[token], was) <= within, `${token} ${t[token]} is not close to ${was}`);
});

test('every token the stylesheets use is defined, for every preset and variant', () => {
  const css = ['style.css', 'approval.css'].map(f => readFileSync(new URL(`../dist/${f}`, import.meta.url), 'utf8')).join('\n');
  const defined = new Set([...css.matchAll(/--([a-z][a-z0-9-]*)\s*:/g)].map(m => m[1]));
  // Theme tokens only; the rest (safe areas, --tick, --hue…) are set by scripts, with fallbacks.
  const used = [...new Set([...css.matchAll(/var\(--([a-z][a-z0-9-]*)/g)].map(m => m[1]))].filter(name => /^([a-z]l?\d+(-[0-9a-f]{2})?|[os]-[0-9a-f]{2}|syn-[a-z]+|match[a-z-]*|on-f)$/.test(name));
  const themed = Object.keys(themeTokens(workbench.dark, 'dark'));
  assert.deepEqual(used.filter(name => !defined.has(name)), [], 'a token is used but never defined');
  for (const preset of THEME_PRESETS) for (const variant of ['dark', 'light']) if (preset[variant]) {
    const tokens = themeTokens(preset[variant], variant);
    assert.deepEqual(Object.keys(tokens).sort(), [...themed].sort());
    for (const [name, value] of Object.entries(tokens)) assert.match(value, /^#[0-9a-f]{6}([0-9a-f]{2})?$/, `${preset.id} ${variant} ${name}`);
  }
});

test('every preset keeps its text readable and its accent buttons legible', () => {
  for (const preset of THEME_PRESETS) for (const variant of ['dark', 'light']) if (preset[variant]) {
    const t = themeTokens(preset[variant], variant);
    // Solarized's own foreground reads at a little over 4:1 on its background.
    assert.ok(ratio(t.n100, t.n0) >= 4, `${preset.id} ${variant}: text ${ratio(t.n100, t.n0).toFixed(2)}`);
    assert.ok(ratio(t['on-f'], t.f100) >= 3 || ratio('#111111', t.f100) < 3 && ratio('#ffffff', t.f100) < 3, `${preset.id} ${variant}: button text`);
  }
  assert.equal(themeTokens(workbench.dark, 'dark')['on-f'], '#ffffff');
  assert.equal(themeTokens(THEME_PRESETS.find(p => p.id === 'dracula').dark, 'dark')['on-f'], '#111111');
});

test('contrast spreads the panels and lines, not the text', () => {
  const at = contrast => themeTokens({ ...workbench.dark, contrast }, 'dark');
  const low = at(0), base = at(60), high = at(100);
  assert.ok(distance(low.n12, low.n0) < distance(base.n12, base.n0) && distance(base.n12, base.n0) < distance(high.n12, high.n0));
  assert.equal(low.n100, high.n100);
  assert.ok(parseInt(low['o-0d'].slice(7), 16) < parseInt(high['o-0d'].slice(7), 16), 'hover overlays follow contrast');
});

test('theme preferences fall back to the preset for anything invalid', () => {
  assert.deepEqual(themePreferences(undefined), defaultTheme);
  assert.equal(defaultTheme.mode, 'dark');
  const t = themePreferences({ mode: 'system', dark: { preset: 'nord', accent: 'red', surface: '#ABCDEF', ink: '#fff', contrast: 101 }, light: { preset: 'ayu' } });
  assert.equal(t.mode, 'system');
  assert.deepEqual(t.dark, { preset: 'nord', accent: '#88c0d0', surface: '#abcdef', ink: '#d8dee9', contrast: 60 });
  assert.deepEqual(t.light, defaultTheme.light, 'Ayu has no light variant');
  assert.equal(presetColors(t.dark, 'dark'), false); assert.equal(presetColors(defaultTheme.light, 'light'), true);
  assert.deepEqual(viewPreferences({ theme: { mode: 'light' } }).theme.mode, 'light');
  assert.deepEqual(viewPreferences({}).theme, defaultTheme);
  assert.equal(themeVariant('system', true), 'dark'); assert.equal(themeVariant('system', false), 'light'); assert.equal(themeVariant('light', true), 'light');
});

test('the presets are Workbench and the Codex app\'s, each variant it has', () => {
  assert.equal(THEME_PRESETS.length, 30);
  assert.equal(presetsFor('dark').length, 29); assert.equal(presetsFor('light').length, 17);
  assert.deepEqual(presetsFor('light').slice(0, 3).map(p => p.label), ['Workbench', 'Absolutely', 'Catppuccin']);
  assert.deepEqual(THEME_PRESETS.find(p => p.id === 'vs-code-plus').dark, { accent: '#007acc', surface: '#1e1e1e', ink: '#d4d4d4', contrast: 60 });
});
