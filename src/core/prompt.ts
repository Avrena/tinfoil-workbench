import type { ApiMessage } from './types.js';
import { agentGuide, AGENT_SHELLS, type AgentApproval, type AgentShell } from './agent.js';

/** The system message follows the XML-section layout of Tinfoil Chat's own client (tinfoilsh/tinfoil-webapp, read,
 * not copied): a guide to the tools offered on this request, then the user's own instructions unchanged, then the
 * escaped `<project_context>`. The guide depends only on which tools are offered, so the start of every request stays
 * byte-identical and the provider's prefix cache keeps working. */

/** Neutralises `<`, `>` and `&` in text placed inside a delimited prompt block, so that a closing tag in a project
 * name, instruction or document cannot end the block and be read as instructions. Models read the entities fine. */
export function escapePromptContent(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

export interface OfferedTools { visual: boolean; python: boolean; agent?: AgentShell | null }

const VISUALS = `<visuals>
The render_* tools and create_artifact place a visual inline in your answer, where the user can expand it and see its data or source.
- Create one without being asked when it shows something better than prose: a trend, a comparison of quantities, a share of a total, a distribution, a few headline figures, dated events, a process or a structure. Skip it for short factual answers and for content that reads well as a list or a small Markdown table.
- Choose the simplest fit: render_chart for numbers (a pie only for one total split into at most six parts), render_stat_cards for two to eight key figures, render_timeline for dated events, render_table for data with many rows, render_diagram for flows and dependencies, create_artifact only when these cannot express it.
- A visual appears in your answer where you call its tool, and only there: write the sentence that introduces it, call the tool, then continue. Never stand in for a visual with HTML, a placeholder, or a Mermaid or ASCII drawing, and do not repeat it as a Markdown table or code block.
- Still answer in text: say what the visual shows and its main point in a sentence or two, without restating every value.
- To change a visual, call update_artifact with its artifact_id rather than creating a near-copy.
- Use real values from the conversation, files, search or tool results; label estimates as estimates. Never say a visual was shown unless its call succeeded; after an error, correct the input once or answer without it.
</visuals>`;

const python = (visual: boolean) => `<python>
python runs code on the user's computer after they approve each call. Use it for calculations or data processing you cannot do reliably yourself${visual ? ', then show the results with render_chart or render_table unless the figure needs Python' : ''}. Each call starts with a fresh working directory.
</python>`;

/** Guidance for the tools offered on a request, or '' when none of them needs any. */
export function toolGuide(tools: OfferedTools): string {
  const sections = [tools.visual ? VISUALS : '', tools.python ? python(tools.visual) : '', tools.agent ? agentGuide(tools.agent) : ''].filter(Boolean);
  if (!sections.length) return '';
  return `<workbench_tools>
You are running in Tinfoil Workbench, a desktop app. The user's own instructions, if any, follow this section and take precedence over it.

${sections.join('\n\n')}
</workbench_tools>`;
}

/** What the approval level (Settings.agentApproval) lets run without asking, as the model is told it. */
const APPROVALS: Record<AgentApproval, string> = {
  ask: 'the user approves every command and every file change first',
  changes: 'file changes inside the folder are written without asking, and the user sees each one; the user approves every command first',
  auto: 'commands and file changes run without asking, and the user sees each one; a command that names a path outside the folder, deletes files, touches git history or remotes, changes system settings, downloads or installs is approved by the user first',
};
/** The workspace agent's folder, where it came from, the shell and the approval level. It follows the guide, so the
 * part shared by every conversation stays first. A folder Workbench made (`madeFolder`) is named after the first
 * message, which a model otherwise reads as the user naming the folder. */
export function agentEnvironment(folder: string, shell: AgentShell, { approval = 'ask', made = false }: { approval?: AgentApproval; made?: boolean } = {}): string {
  return `<environment>
folder: ${escapePromptContent(folder)}
folder origin: ${made ? 'made by Workbench for this conversation and named after its first message; the user did not choose or mention this name' : 'a folder the user chose for this conversation'}
shell: ${AGENT_SHELLS[shell]}
approvals: ${APPROVALS[approval]}; reading inside the folder is not approved separately
network: not restricted
</environment>`;
}

/** Puts the guide at the start of the system message, before the user's instructions and project context. */
export function withToolGuide(messages: ApiMessage[], guide: string): ApiMessage[] {
  if (!guide) return messages;
  const [first, ...rest] = messages;
  if (first?.role === 'system') return [{ role: 'system', content: `${guide}\n\n${first.content}` }, ...rest];
  return [{ role: 'system', content: guide }, ...messages];
}
