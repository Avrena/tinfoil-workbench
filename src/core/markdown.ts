import { marked, Renderer } from '../vendor/marked.js';
import katex from '../vendor/katex.js';
import Prism from '../vendor/prism.js';
import { RenderCache } from './render-cache.js';
const mathCache = new RenderCache<string>(128, 512_000);
const codeCache = new RenderCache<string>(64, 512_000);
export function clearMarkdownCaches(): void { mathCache.clear(); codeCache.clear(); }

export const escapeHtml = (value: string): string => value.replace(/[&<>"']/g, c => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[c]!));
export interface RenderOptions { math?: boolean; codeTools?: boolean }
export interface CodeBlock { language: string; code: string }
export function safeExternalURL(value: string): string | null {
  try {
    if (value.length > 4096 || /[\x00-\x20\x7f]/.test(value)) return null;
    const u = new URL(value);
    return ['https:', 'http:'].includes(u.protocol) && !u.username && !u.password ? u.href : null;
  } catch { return null; }
}
// Raw HTML is always escaped. The only HTML here is application-controlled markup
// or escaped output from the bundled highlighter / untrusted-input math renderer.
let renderMath = true, codeTools = true, codeIndex = 0;
const renderer = new Renderer();
renderer.html = (html: string) => escapeHtml(html);
renderer.link = (href: string, _title: string, label: string) => {
  const url = safeExternalURL(href);
  return url ? `<button type="button" class="md-link" data-url="${escapeHtml(url)}" title="${escapeHtml(url)}">${label}</button>` : label;
};
renderer.image = (href: string, _title: string, alt: string) => {
  const url = safeExternalURL(href);
  return `<span class="image-placeholder">Image: ${escapeHtml(alt || 'external image')}${url ? ` <button type="button" class="md-link" data-url="${escapeHtml(url)}">Open externally</button>` : ''}</span>`;
};
renderer.code = (code: string, info: string) => {
  const language = (info || '').split(/\s/)[0]!.toLowerCase().slice(0, 40);
  const index = codeIndex++;
  let html = escapeHtml(code);
  if (code.length <= 30000 && Prism.languages[language]) {
    try {
      const key=language+'\0'+code, cached=codeCache.get(key);
      html=cached ?? Prism.highlight(code, Prism.languages[language], language);
      if(cached===undefined)codeCache.set(key,html,key.length+html.length);
    } catch { /* Plain text is a valid fallback. */ }
  }
  const executable = ['python', 'py'].includes(language);
  const previewable = ['html', 'svg', 'json', 'csv', 'markdown', 'md'].includes(language);
  return `<div class="code-block" data-code-index="${index}" data-language="${escapeHtml(language)}"><div class="code-caption"><span>${escapeHtml(language || 'text')}</span><span class="code-tools">${codeTools && previewable ? '<button type="button" class="preview-code">Preview</button>' : ''}${codeTools && executable ? '<button type="button" class="run-code">Run Python…</button>' : ''}<button type="button" class="wrap-code" aria-label="Toggle code wrapping">Wrap</button><button type="button" class="copy-code" aria-label="Copy code">Copy</button></span></div><pre><code class="language-${escapeHtml(language)}">${html}</code></pre></div>`;
};
function formula(tex: string, display: boolean): string {
  if (!renderMath || tex.length > 12000) return `<code class="math-source">${escapeHtml(tex)}</code>`;
  const key=(display?'display:':'inline:')+tex, cached=mathCache.get(key);
  if(cached!==undefined)return cached;
  try {
    // Native MathML works offline and uses the operating system's math fonts.
    // No font files, SVG input, HTML extensions, shared macros or remote resources.
    const rendered = katex.renderToString(tex, { output: 'mathml', displayMode: display, trust: false,
      throwOnError: true, strict: 'error', maxExpand: 300, maxSize: 12, macros: {} });
    const html = `<span class="math-expression ${display ? 'display-math' : ''}" data-tex="${escapeHtml(tex)}" title="Double-click to copy LaTeX">${rendered}</span>`;
    mathCache.set(key,html,key.length+html.length);return html;
  } catch {
    return `<code class="math-source math-error" title="Unsupported or incomplete LaTeX; original source preserved">${escapeHtml(tex)}</code>`;
  }
}
marked.use({ renderer, extensions: [
  { name: 'mathBlock', level: 'block', start: (s: string) => s.search(/(?:^|\n)[ \t]*(?:\$\$|\\\[)/),
    tokenizer(s: string) {
      const m = /^(?:\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\])(?:[ \t]*\n|[ \t]*$)?/.exec(s);
      return m ? { type: 'mathBlock', raw: m[0], tex: m[1] ?? m[2] } : undefined;
    }, renderer: (t: { tex: string }) => formula(t.tex, true) },
  { name: 'mathInline', level: 'inline', start: (s: string) => s.search(/\\\(|\$/),
    tokenizer(s: string) {
      const m = /^\\\(([^\n]*?)\\\)/.exec(s) ?? /^\$(?!\$|\s)((?:\\.|[^$\n])+?)(?<!\s)\$(?!\d)/.exec(s);
      return m ? { type: 'mathInline', raw: m[0], tex: m[1] } : undefined;
    }, renderer: (t: { tex: string }) => formula(t.tex, false) },
] });
export function markdown(source: string, options: RenderOptions = {}): string {
  renderMath = options.math !== false; codeTools = options.codeTools !== false; codeIndex = 0;
  // Bound interactive parsing without changing stored or exported output.
  const bounded = source.slice(0, 200000);
  try {
    const result = marked.parse(bounded.replace(/\r\n/g, '\n'), { gfm: true, breaks: false, mangle: false, headerIds: false });
    return result + (source.length > bounded.length ? '<p class="render-limit">Display shortened at 200,000 characters. Copy or export preserves the full response.</p>' : '');
  } catch { return `<pre class="raw-source">${escapeHtml(bounded)}</pre>`; }
}
export function extractCodeBlocks(source: string): CodeBlock[] {
  const result: CodeBlock[] = [];
  const walk = (tokens: any[]): void => {
    for (const token of tokens) {
      if (token.type === 'code') result.push({ language: String(token.lang || '').split(/\s/)[0]!.toLowerCase(), code: String(token.text) });
      if (Array.isArray(token.tokens)) walk(token.tokens);
      if (Array.isArray(token.items)) for (const item of token.items) if (Array.isArray(item.tokens)) walk(item.tokens);
    }
  };
  walk(marked.lexer(source.slice(0, 200000), { gfm: true }));
  return result;
}
