import { AGENT_SHELLS, diffCounts, outsidePaths, type AgentShell } from './agent.js';

/** What the approval window shows (desktop/approval-window.mjs). The main process builds it from the pending call; the
 * conversation page never supplies it. `text` is the exact command or code, `diff` the change's lines without the two
 * file header lines, `facts` where and how it runs, and `outside` the paths outside the folder that a command names. */
export interface ApprovalRequest {
  kind: 'command' | 'change' | 'python';
  title: string; approve: string; decline: string;
  text?: string; diff?: string[];
  facts: string[]; outside: string[]; warning: string;
}
/** Lines of a diff shown in the window; the conversation's card keeps all of them. */
export const APPROVAL_DIFF_LINES = 2000;

export function commandApproval(command: string, folder: string, workdir: string, shell: AgentShell, timeoutSeconds: number): ApprovalRequest {
  const where = workdir === '.' ? folder : `${folder.replace(/\\+$/, '')}\\${workdir.replaceAll('/', '\\')}`;
  return {
    kind: 'command', title: 'Run this command on your computer?', approve: 'Run this command once', decline: 'Do not run', text: command,
    facts: [`Runs in ${where}`, `${AGENT_SHELLS[shell]} · stopped after ${timeoutSeconds} seconds`],
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
