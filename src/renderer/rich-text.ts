import { markdown, extractCodeBlocks, escapeHtml } from '../core/markdown.js';
import { updateMarkup } from './dom.js';
interface TextOptions { markdown: boolean; math: boolean; codeTools?: boolean; prefix?: string }
interface RenderedText { source: string; markdown: boolean; math: boolean; codeTools: boolean; prefix: string; offset: number }
/** One retained value per DOM island, not a cache of every streaming prefix.
 * Closed reasoning is never passed here. Unchanged answer segments aren't parsed,
 * highlighted, put in a new template or walked by the transcript reconciler. */
export class RichTextRenderer {
  private previous = new WeakMap<HTMLElement, RenderedText>();
  render(host: HTMLElement, source: string, options: TextOptions): void {
    const old = this.previous.get(host), prefix = options.prefix ?? '', codeTools = options.codeTools !== false;
    if (old && old.source === source && old.prefix === prefix && old.markdown === options.markdown && old.math === options.math && old.codeTools === codeTools) return;
    const offset = old?.prefix === prefix ? old.offset : prefix ? extractCodeBlocks(prefix).length : 0;
    const html = options.markdown
      ? markdown(source, { math: options.math, codeTools }).replace(/data-code-index="(\d+)"/g, (_, n) => `data-code-index="${Number(n) + offset}"`)
      : `<pre class="raw-source">${escapeHtml(source)}</pre>`;
    updateMarkup(host, html);
    this.previous.set(host, { source, prefix, offset, markdown: options.markdown, math: options.math, codeTools });
  }
  clear(): void { this.previous = new WeakMap(); }
}
