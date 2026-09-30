import { AGENT_SHELLS, diffCounts, outsidePaths, type AgentShell } from './agent.js';

/** What the approval window shows (desktop/approval-window.mjs). The main process builds it from the pending call; the
 * conversation page never supplies it. `text` is the exact command or code, `diff` the change's lines without the two
 * file header lines, `facts` where and how it runs, and `outside` the paths outside the folder that a command names.
 * A confirmation (`confirmation`) has a `message` instead, and a `tone` for its mark and its approve button. */
export interface ApprovalRequest {
  kind: 'command' | 'change' | 'python' | 'confirm';
  title: string; approve: string; decline: string;
  message?: string; tone?: 'question' | 'warning' | 'danger';
  text?: string; diff?: string[];
  facts: string[]; outside: string[]; warning: string;
}
/** A question the main process asks before it acts (signing out, deleting, exporting, raising the agent's approval
 * level…), drawn by Workbench instead of a Windows message box. `text` is shown as is, in a fixed-width block (a
 * folder, a link, a delegated task); paragraphs of `message` are separated by blank lines. */
export function confirmation(options: { title: string; message: string; approve: string; decline?: string; tone?: 'question' | 'warning' | 'danger'; text?: string }): ApprovalRequest {
  return { kind: 'confirm', title: options.title, message: options.message, approve: options.approve, decline: options.decline ?? 'Cancel',
    tone: options.tone ?? 'question', ...(options.text === undefined ? {} : { text: options.text }), facts: [], outside: [], warning: '' };
}
/** Lines of a diff shown in the window; the conversation's card keeps all of them. */
export const APPROVAL_DIFF_LINES = 2000;

/** `asked` says why a command asks although the conversation runs commands without asking (`askAnyway`). */
export function commandApproval(command: string, folder: string, workdir: string, shell: AgentShell, timeoutSeconds: number, asked?: string): ApprovalRequest {
  const where = workdir === '.' ? folder : `${folder.replace(/\\+$/, '')}\\${workdir.replaceAll('/', '\\')}`;
  return {
    kind: 'command', title: 'Run this command on your computer?', approve: 'Run this command once', decline: 'Do not run', text: command,
    facts: [`Runs in ${where}`, `${AGENT_SHELLS[shell]} · stopped after ${timeoutSeconds} seconds`, ...(asked ? [`Asking although this conversation runs commands without asking: ${asked}.`] : [])],
    outside: outsidePaths(command, folder, workdir),
    warning: 'Not a sandbox: it runs with your Windows account’s permissions and can change or send anything your account can. Approving runs this exact command once.',
  };
}

export function changeApproval(name: 'edit_file' | 'write_file', path: string, folder: string, diff: string): ApprovalRequest {
  const { added, removed } = diffCounts(diff), rows = diff.split('\n').slice(2);
  if (rows.at(-1) === '') rows.pop();
  const shown = rows.slice(0, APPROVAL_DIFF_LINES);
  if (rows.length > shown.length) shown.push(`… ${rows.length - shown.length} more lines, shown in the conversation`);
  return {
    kind: 'change', title: `${name === 'write_file' ? 'Write' : 'Change'} ${path}?`, approve: name === 'write_file' ? 'Write this file' : 'Apply this change', decline: 'Do not change',
    diff: shown, facts: [`${added} ${added === 1 ? 'line' : 'lines'} added, ${removed} removed`, `In ${folder}`], outside: [],
    warning: 'The file is written only if it has not changed since this change was proposed.',
  };
}

export function pythonApproval(code: string, interpreter: string): ApprovalRequest {
  return {
    kind: 'python', title: 'Run model-provided Python on this computer?', approve: 'Run this code once', decline: 'Do not run', text: code,
    facts: [`Interpreter: ${interpreter}`], outside: [],
    warning: 'Not a sandbox: this code can read, change and send files and use the network with your Windows account’s permissions. Review all of it. Approving runs this exact code once.',
  };
}
