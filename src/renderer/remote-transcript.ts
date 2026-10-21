import { escapeHtml as e } from '../core/markdown.js';
import type { RemoteDetail, RemoteJob, RemoteTranscriptEntry } from '../core/remote.js';
import type { PickerModel } from '../core/model-list.js';
import { reasoningDisclosure, answerFooter, answerSignature, answerReadActions } from './conversation-ui.js';
import type { ViewPreferences } from '../core/preferences.js';

type Tool = NonNullable<RemoteDetail['tools']>[number];
const TOOL_LABELS: Record<string, string> = { run_command:'Command', read_file:'Read file', write_file:'Write file', edit_file:'Edit file', list_files:'List files', search_files:'Search files', update_plan:'Plan' };
const TOOL_STATES: Record<string, string> = { running:'Running', complete:'Completed', error:'Failed' };
const firstLine = (text: string): string => text.trim().split('\n')[0]?.trim() ?? '';

/** What a tool call is about, for its one-line summary: the command's first line, the path or the pattern. */
function toolSubject(name: string, args: string): { subject: string; input: string } {
  try {
    const value: unknown = JSON.parse(args);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return { subject: '', input: args };
    const a = value as Record<string, unknown>, text = (v: unknown) => typeof v === 'string' ? v : '';
    if (name === 'run_command') return { subject: firstLine(text(a.command)), input: text(a.command) || args };
    return { subject: name === 'search_files' ? text(a.pattern) : name === 'update_plan' ? '' : text(a.path), input: JSON.stringify(a, null, 2) };
  } catch { return { subject: '', input: args }; }
}
/** One collapsed tool call: its kind, what it touched and its state; input and output inside. A call still marked running
 * in a job that has ended (stopped, interrupted or out of time) did not finish, and says so. */
function toolMarkup(job: string, index: number, t: Tool, active: boolean): string {
  const cut = t.status === 'running' && !active, state = cut ? 'Not finished' : TOOL_STATES[t.status] ?? t.status;
  const { subject, input } = toolSubject(t.name, t.arguments), result = [t.result?.text, t.result?.diff, t.result?.stdout, t.result?.stderr].filter(Boolean).join('\n');
  return `<details data-key="tool-${job}-${index}" class="remote-tool"><summary><span class="remote-tool-name">${e(TOOL_LABELS[t.name] ?? t.name)}</span>${subject ? `<code title="${e(subject)}">${e(subject)}</code>` : ''}<span class="remote-status${t.status === 'running' && !cut ? ' active' : t.status === 'error' ? ' failed' : ''}">${e(state)}</span></summary>`
    + `<h5>Input</h5><pre>${e(input)}</pre>${t.error ? `<p class="danger">${e(t.error)}</p>` : ''}${result ? `<h5>Output</h5><pre>${e(result)}</pre>` : ''}${t.result?.exitCode != null ? `<p class="small muted">Exit code ${e(String(t.result.exitCode))}${t.result.timedOut ? ' · timed out' : ''}</p>` : ''}</details>`;
}

/** Text drawn into a rich-text island after the reconciler runs, by island key. Only changed text is parsed again. */
export type RichSources = Map<string, string>;
export interface TranscriptView { html: string; rich: RichSources; reasoning: RichSources }

/** The job as a conversation: the task as the person's message, then the agent's replies and tool calls in the order
 * the host recorded them. Keys carry the job ID, so another job never inherits this one's disclosures. Without an
 * ordered record (an older host), the reply and the tool calls are shown apart and the page says so. */
export function transcriptView(job: RemoteJob, detail: RemoteDetail, model: PickerModel | null, active: boolean, reading: ViewPreferences, opened: Map<string,boolean>, raw: Set<string>): TranscriptView {
  const id = job.id, rich: RichSources = new Map(), reasoning: RichSources = new Map(), tools = detail.tools ?? [];
  const prompt = detail.prompt ?? job.prompt ?? '', lines = prompt.split('\n'), long = lines.length > 12 || prompt.length > 1200;
  const cut = long ? Math.min(lines.slice(0, 8).join('\n').length, 800) : prompt.length;
  const user = `<div class="user-row remote-user-row" data-key="user-${id}"><div class="user-prompt">${e(prompt.slice(0, cut))}${long ? '…' : ''}</div>`
    + (long ? `<details class="remote-task-rest" data-key="user-rest-${id}"><summary>Show the full task</summary><div class="user-prompt">${e(prompt)}</div></details>` : '') + '</div>';
  const message = (key: string, content: string, thinking: string, partial: boolean, fallback = false, signed = true): string => {
    const body = `body-${id}-${key}`, reason = `reason-${id}-${key}`;
    if (content) rich.set(body, content);
    if (thinking) reasoning.set(reason, thinking);
    return `<section class="remote-message reply" data-key="msg-${id}-${key}"${fallback ? ' data-fallback' : ''}>`
      + `<div class="reply-context${!thinking || reading.reasoning==='hidden' ? ' hidden' : ''}" data-key="context">`
      + (thinking && reading.reasoning!=='hidden' ? reasoningDisclosure({key:`reasoning-${id}-${key}`,attrs:`data-disclosure="${reason}"`,contentAttrs:`data-key="${reason}" data-rich-id="${reason}"`,open:opened.get(reason) ?? reading.reasoning==='expanded'}) : '') + '</div>'
      + (content ? `<div class="reply-content remote-reply-content" data-rich-host data-key="${body}" data-rich-id="${body}"></div>` : partial && active ? `<p class="waiting" data-key="wait-${id}-${key}">Working on a reply…</p>` : '')
      + (partial ? `<p class="remote-progress" data-key="progress-${id}-${key}">${active ? 'In progress · this view refreshes every 15 s' : 'Partial response'}</p>` : '')
      + (content || signed ? answerFooter(content ? answerReadActions(body,raw.has(body)) : '',signed ? answerSignature(job.model ?? model?.name ?? 'Remote agent',detail.settings?.systemPrompt.trim() ? detail.settings.systemPromptName : undefined) : '') : '')
      + '</section>';
  };
  let body: string;
  const order = detail.transcript;
  if (order) {
    const latest = order.map(entry => entry.role).lastIndexOf('assistant');
    body = order.map((entry: RemoteTranscriptEntry, index: number) => entry.role === 'tool'
      ? (tools[entry.tool] ? `<div class="remote-tool-entry" data-key="call-${id}-${e(entry.id)}">${toolMarkup(id, entry.tool, tools[entry.tool]!, active)}</div>` : '')
      : message(entry.id, entry.content, entry.reasoning, entry.partial === true, false, index === latest)).join('');
    const last = order.at(-1);
    if (!order.length) body = active ? `<p class="waiting" data-key="empty-${id}">Waiting for the agent to start…</p>` : `<p class="muted" data-key="empty-${id}">No reply was recorded.</p>`;
    // While the job runs, its end says so, unless a partial reply already does.
    else if (active && !(last?.role === 'assistant' && last.partial)) body += `<p class="remote-progress" data-key="progress-${id}">In progress · this view refreshes every 15 s</p>`;
  } else {
    const content = (detail.content ?? '') + (detail.partial?.content ?? ''), thinking = (detail.reasoning ?? '') + (detail.partial?.reasoning ?? '');
    const partial = active || !!(detail.partial?.content || detail.partial?.reasoning);
    body = (content || thinking || active ? message('reply', content, thinking, partial, true) : `<p class="muted" data-key="empty-${id}">No reply was recorded.</p>`)
      + (tools.length ? `<details class="remote-disclosure" data-key="tools-${id}" data-part="tools"><summary><span>Tool activity</span><span class="remote-disclosure-count">${tools.length} ${tools.length === 1 ? 'call' : 'calls'}</span></summary><p class="small muted">This host doesn’t report where tool calls happened, so they are listed after the reply.</p>${tools.map((t, i) => toolMarkup(id, i, t, active)).join('')}</details>` : '');
  }
  const truncated = detail.truncated ? `<p class="small muted" data-key="truncated-${id}">Output is shortened for this view. Full records remain on the host.</p>` : '';
  return { html: user + truncated + `<div class="remote-agent-turn" data-key="turn-${id}">${body}</div>`, rich, reasoning };
}
