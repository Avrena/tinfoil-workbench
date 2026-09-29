import type { ApiMessage } from './types.js';

/** The system message follows the XML-section layout of Tinfoil Chat's own client (tinfoilsh/tinfoil-webapp, read,
 * not copied): a guide to the tools offered on this request, then the user's own instructions unchanged, then the
 * escaped `<project_context>`. The guide depends only on which tools are offered, so the start of every request stays
 * byte-identical and the provider's prefix cache keeps working. */

/** Neutralises `<`, `>` and `&` in text placed inside a delimited prompt block, so that a closing tag in a project
 * name, instruction or document cannot end the block and be read as instructions. Models read the entities fine. */
export function escapePromptContent(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

export interface OfferedTools { visual: boolean; python: boolean }

const VISUALS = `<visuals>
render_chart, render_table, render_diagram and create_artifact place a visual inline in your answer, where the user can expand it and see its data or source.
- Create one without being asked when it shows something better than prose: a trend, a comparison of quantities, a share of a total, a distribution, a process or a structure. Skip it for short factual answers and for content that reads well as a list or a small Markdown table.
- Choose the simplest fit: render_chart for numbers (a pie only for one total split into at most six parts), render_table for data with many rows, render_diagram for flows and dependencies, create_artifact only when these cannot express it.
- Still answer in text: say what the visual shows and its main point in a sentence or two, without restating every value.
- To change a visual, call update_artifact with its artifact_id rather than creating a near-copy.
- Use real values from the conversation, files, search or tool results; label estimates as estimates. Never say a visual was shown unless its call succeeded; after an error, correct the input once or answer without it.
</visuals>`;

const python = (visual: boolean) => `<python>
python runs code on the user's computer after they approve each call. Use it for calculations or data processing you cannot do reliably yourself${visual ? ', then show the results with render_chart or render_table unless the figure needs Python' : ''}. Each call starts with a fresh working directory.
</python>`;

/** Guidance for the tools offered on a request, or '' when none of them needs any. */
export function toolGuide(tools: OfferedTools): string {
  const sections = [tools.visual ? VISUALS : '', tools.python ? python(tools.visual) : ''].filter(Boolean);
  if (!sections.length) return '';
  return `<workbench_tools>
You are running in Tinfoil Workbench, a desktop app. The user's own instructions, if any, follow this section and take precedence over it.

${sections.join('\n\n')}
</workbench_tools>`;
}

/** Puts the guide at the start of the system message, before the user's instructions and project context. */
export function withToolGuide(messages: ApiMessage[], guide: string): ApiMessage[] {
  if (!guide) return messages;
  const [first, ...rest] = messages;
  if (first?.role === 'system') return [{ role: 'system', content: `${guide}\n\n${first.content}` }, ...rest];
  return [{ role: 'system', content: guide }, ...messages];
}
