import { viewPreferences } from './preferences.js';
import type { ReplyEdit, ApiMessage, Artifact, Attachment, GenerationSettings, InstructionPreset, Reply, Thread, ToolRun, Workspace } from './types.js';
export const LIMITS = Object.freeze({
  prompt: 160_000, attachment: 200_000, attachments: 8,
  context: 800_000, response: 2_000_000, threads: 300, turns: 400,
  instructions: 40_000, instructionName: 80, instructionPresets: 50,
  importBytes: 24 * 1024 * 1024, workspaceBytes: 64 * 1024 * 1024,
});
export class InputError extends Error {
  constructor(message: string) { super(message); this.name = 'InputError'; }
}
export function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new InputError('Expected an object.');
  return value as Record<string, unknown>;
}
export function text(value: unknown, label: string, max: number, nonempty = false): string {
  if (typeof value !== 'string' || value.length > max || (nonempty && !value.trim()))
    throw new InputError(`${label} must ${nonempty ? 'not be empty and ' : ''}be at most ${max.toLocaleString()} characters.`);
  return value;
}
export function identifier(value: unknown): string {
  const result = text(value, 'Identifier', 100, true);
  if (!/^[A-Za-z0-9_-]+$/.test(result)) throw new InputError('Invalid identifier.');
  return result;
}
function numeric(value: unknown, low: number, high: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < low || value > high)
    throw new InputError(`Number must be between ${low} and ${high}.`);
  return value;
}
/** A single-line display name for system instructions. Never part of a request. */
export function instructionName(value: unknown, required = false): string {
  const name = text(value, 'Instructions name', LIMITS.instructionName, required).trim();
  if (/[\x00-\x1f\x7f]/.test(name)) throw new InputError('Instructions names must be a single line of text.');
  return name;
}
export function instructionPreset(value: unknown): InstructionPreset {
  const v = record(value);
  const createdAt = stamp(v.createdAt);
  return { id: identifier(v.id), name: instructionName(v.name, true), text: text(v.text, 'Saved instructions', LIMITS.instructions, true),
    createdAt, updatedAt: v.updatedAt === undefined ? createdAt : stamp(v.updatedAt) };
}
export function settings(value: unknown): GenerationSettings {
  const v = record(value);
  const reasoning = v.reasoningEffort;
  if (!['default', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'].includes(String(reasoning))) throw new InputError('Invalid reasoning effort.');
  if (typeof v.compare !== 'boolean') throw new InputError('Invalid comparison setting.');
  const model = text(v.model, 'Model', 200);
  const compareModel = text(v.compareModel, 'Comparison model', 200);
  for (const m of [model, compareModel]) if (/[\r\n\x00-\x1f]/.test(m)) throw new InputError('Invalid model name.');
  const tokens = numeric(v.maxTokens, 1, 131072);
  if (!Number.isInteger(tokens)) throw new InputError('Output limit must be an integer.');
  if (v.toolsMode !== undefined && !['off', 'ask'].includes(String(v.toolsMode))) throw new InputError('Invalid tool permission mode.');
  const systemPrompt = text(v.systemPrompt, 'System instructions', LIMITS.instructions);
  // Older workspaces have no name; a name without instructions describes nothing.
  const systemPromptName = instructionName(v.systemPromptName ?? '');
  return {
    visualTools: v.visualTools === true,
    webSearch: v.webSearch === true,
    delegateMode: v.delegateMode === 'ask' ? 'ask' : 'off',
    thinkingMode: ['enabled','disabled'].includes(String(v.thinkingMode)) ? v.thinkingMode as 'enabled'|'disabled' : 'default',
    compareReasoningEffort: ['minimal','low','medium','high','xhigh','max','ultra'].includes(String(v.compareReasoningEffort)) ? v.compareReasoningEffort as string : 'default',
    compareThinkingMode: ['enabled','disabled'].includes(String(v.compareThinkingMode)) ? v.compareThinkingMode as 'enabled'|'disabled' : 'default',
    toolsMode: v.toolsMode === 'ask' ? 'ask' : 'off',
    model: model.trim(), compareModel: compareModel.trim(), compare: v.compare,
    systemPrompt, systemPromptName: systemPrompt.trim() ? systemPromptName : '',
    temperature: v.temperature === null ? null : numeric(v.temperature, 0, 2),
    maxTokens: tokens, reasoningEffort: reasoning as GenerationSettings['reasoningEffort'],
  };
}
export function attachments(value: unknown): Attachment[] {
  if (!Array.isArray(value) || value.length > LIMITS.attachments) throw new InputError('Choose at most eight text files.');
  const result = value.map(item => {
    const v = record(item);
    return { name: text(v.name, 'Filename', 240, true), content: text(v.content, 'File content', LIMITS.attachment) };
  });
  if (result.reduce((n, a) => n + a.content.length, 0) > LIMITS.attachment)
    throw new InputError('Combined attachments exceed 200,000 characters.');
  return result;
}
function list(value: unknown, max: number): unknown[] {
  if (!Array.isArray(value) || value.length > max) throw new InputError('Invalid or oversized list.');
  return value;
}
function stamp(value: unknown): number { return numeric(value, 0, 9e15); }
function validateEdit(value: unknown, content: unknown, reasoning: unknown): ReplyEdit {
  const e = record(value);
  const originalContent=text(e.originalContent,'Original reply',LIMITS.response);
  const originalReasoning=text(e.originalReasoning,'Original reasoning',LIMITS.response);
  if (e.contentEdited !== (content !== originalContent) || e.reasoningEdited !== (reasoning !== originalReasoning))
    throw new InputError('Edit flags do not match the saved original text.');
  if (e.historyRewritten !== undefined && typeof e.historyRewritten !== 'boolean') throw new InputError('Invalid history edit flag.');
  return {originalContent, originalReasoning, contentEdited:e.contentEdited, reasoningEdited:e.reasoningEdited,
    historyRewritten:e.historyRewritten===true || e.contentEdited, editedAt:stamp(e.editedAt)};
}
function reply(value: unknown): Reply {
  const v = record(value);
  const statuses = ['queued','streaming','complete','stopped','error','interrupted','awaiting_approval','executing'];
  if (!statuses.includes(String(v.status))) throw new InputError('Invalid reply state.');
  let usage = null;
  if (v.usage !== null) {
    const u = record(v.usage);
    usage = { input: numeric(u.input, 0, 1e9), output: numeric(u.output, 0, 1e9) };
  }
  return {
    id: identifier(v.id), model: text(v.model, 'Model', 200),
    ...(v.edit === undefined ? {} : {edit:validateEdit(v.edit,v.content,v.reasoning)}),
    tools: list(v.tools ?? [], 96).map(validateTool), toolMessages: list(v.toolMessages ?? [], 24).map(validateToolMessage),
    content: text(v.content, 'Reply', LIMITS.response), reasoning: text(v.reasoning, 'Reasoning', LIMITS.response),
    ...(v.finalContentOffset === undefined ? {} : {finalContentOffset: offset(v.finalContentOffset, String(v.content ?? '').length)}),
    ...(['waiting','thinking','answering'].includes(String(v.phase)) ? {phase: v.phase as Reply['phase']} : {}),
    ...(v.systemPromptName === undefined ? {} : {systemPromptName: instructionName(v.systemPromptName)}),
    status: v.status as Reply['status'], finishReason: v.finishReason === null ? null : text(v.finishReason, 'Finish reason', 100),
    error: v.error === null ? null : text(v.error, 'Error', 1000), usage, elapsedMs: numeric(v.elapsedMs, 0, 1e12),
  };
}
export function validateThread(value: unknown): Thread {
  const v = record(value);
  if (typeof v.pinned !== 'boolean') throw new InputError('Invalid pin state.');
  const turns = list(v.turns, LIMITS.turns).map(item => {
    const t = record(item);
    const replies = list(t.replies, 2).map(reply);
    if (!replies.length) throw new InputError('A turn needs at least one reply.');
    const selectedReplyId = t.selectedReplyId === null ? null : identifier(t.selectedReplyId);
    if (selectedReplyId && !replies.some(r => r.id === selectedReplyId)) throw new InputError('Selected reply does not exist.');
    return {
      id: identifier(t.id), prompt: text(t.prompt, 'Prompt', LIMITS.prompt),
      attachments: attachments(t.attachments), createdAt: stamp(t.createdAt), replies, selectedReplyId,
    };
  });
  const ids = turns.flatMap(t => [t.id, ...t.replies.flatMap(r => [r.id, ...(r.tools ?? []).flatMap(tool => [tool.id, ...tool.artifacts.map(a => a.id)])])]);
  if (new Set(ids).size !== ids.length) throw new InputError('Duplicate identifiers in conversation.');
  return {
    id: identifier(v.id), title: text(v.title, 'Title', 120, true), pinned: v.pinned,
    projectId: v.projectId == null ? null : identifier(v.projectId),
    ...(v.branchOf === undefined ? {} : {branchOf:identifier(v.branchOf)}),
    ...(v.connectionOwner === undefined ? {} : {connectionOwner:text(v.connectionOwner,'Connection owner',250,true)}),
    createdAt: stamp(v.createdAt), updatedAt: stamp(v.updatedAt), settings: settings(v.settings),
    draft: text(v.draft, 'Draft', LIMITS.prompt), draftAttachments: attachments(v.draftAttachments ?? []), turns,
  };
}
export function validateWorkspace(value: unknown): Workspace {
  const v = record(value);
  if (v.version !== 1) throw new InputError('Unsupported workspace version.');
  if(v.connectionMode!==undefined&&!['api-key','chat-account'].includes(String(v.connectionMode)))throw new InputError('Invalid connection mode.');
  if(v.rememberAccount!==undefined&&v.rememberAccount!==false)throw new InputError('Invalid sign-in preference.');
  const threads = list(v.threads, LIMITS.threads).map(validateThread);
  if (!threads.length || new Set(threads.map(t => t.id)).size !== threads.length) throw new InputError('Invalid workspace conversations.');
  const projects = list(v.projects ?? [], 100).map(item => {const p=record(item);return {id:identifier(p.id),name:text(p.name,'Project name',80,true).trim(),createdAt:stamp(p.createdAt)};});
  if(new Set(projects.map(p=>p.id)).size!==projects.length) throw new InputError('Duplicate project identifiers.');
  for(const thread of threads) if(thread.projectId && !projects.some(p=>p.id===thread.projectId)) throw new InputError('Thread project does not exist.');
  const instructionPresets = list(v.instructionPresets ?? [], LIMITS.instructionPresets).map(instructionPreset);
  if(new Set(instructionPresets.map(p=>p.id)).size!==instructionPresets.length) throw new InputError('Duplicate saved instruction identifiers.');
  const activeId = identifier(v.activeId);
  if (!threads.some(t => t.id === activeId)) throw new InputError('Active conversation is missing.');
  return {
    version: 1, activeId, threads, projects, instructionPresets, ...(v.connectionMode?{connectionMode:v.connectionMode as Workspace['connectionMode']}:{}), ...(v.rememberAccount===false?{rememberAccount:false as const}:{}), view: viewPreferences(v.view), pythonPath: text(v.pythonPath ?? '', 'Python interpreter path', 4096),
    apiKey: text(v.apiKey, 'API key', 4096), cacheSecret: text(v.cacheSecret, 'Cache secret', 200, true),
  };
}

export function validateArtifact(value: unknown): Artifact {
  const v = record(value);
  const name = text(v.name, 'Artifact name', 200, true);
  if (/[\\/\x00-\x1f]/.test(name)) throw new InputError('Invalid artifact name.');
  const mime = text(v.mime, 'Artifact MIME type', 80);
  if (!['image/png','image/svg+xml','text/csv','application/json','text/plain','text/markdown','text/html','application/pdf'].includes(mime)) throw new InputError('Unsupported artifact type.');
  const data = text(v.data, 'Artifact data', 2800000);
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(data) || data.length % 4 !== 0) throw new InputError('Invalid artifact encoding.');
  const extra: Partial<Artifact> = {};
  if (v.kind !== undefined) {
    if (!['html','svg','markdown','text','json','pdf','chart','table','diagram'].includes(String(v.kind))) throw new InputError('Unsupported artifact kind.');
    extra.kind = v.kind as Artifact['kind'];
  }
  if (v.source !== undefined) extra.source = text(v.source, 'Artifact source', 120000);
  if (v.title !== undefined) extra.title = text(v.title, 'Artifact title', 160);
  if (v.description !== undefined) extra.description = text(v.description, 'Artifact description', 2000);
  if (v.version !== undefined) { extra.version = numeric(v.version, 1, 1000); if (!Number.isInteger(extra.version)) throw new InputError('Invalid artifact version.'); }
  if (v.parentId !== undefined) extra.parentId = identifier(v.parentId);
  if (v.rootId !== undefined) extra.rootId = identifier(v.rootId);
  return { id: identifier(v.id), name, mime, data, ...extra };
}
function offset(value: unknown, max: number = LIMITS.response): number {
  const n = numeric(value, 0, max);
  if (!Number.isInteger(n)) throw new InputError('Invalid content insertion offset.');
  return n;
}
export function validateTool(value: unknown): ToolRun {
  const v = record(value);
  if (!['queued','awaiting_approval','running','complete','error','denied','cancelled'].includes(String(v.status))) throw new InputError('Invalid tool status.');
  return { id: identifier(v.id), callId: text(v.callId, 'Tool call ID', 200), name: text(v.name, 'Tool name', 80),
    ...(v.contentOffset === undefined ? {} : {contentOffset: offset(v.contentOffset)}),
    ...(v.batchId === undefined ? {} : {batchId:identifier(v.batchId), batchIndex:integer(v.batchIndex,0,3),batchSize:integer(v.batchSize,1,4)}),
    ...(v.delegate === undefined ? {} : {delegate:validateDelegate(v.delegate)}),
    ...(v.provider === undefined ? {} : {provider:validateProvider(v.provider)}),
    arguments: text(v.arguments, 'Tool arguments', 128000), origin: v.origin === 'provider' ? 'provider' : v.origin === 'model' ? 'model' : 'manual', status: v.status as ToolRun['status'],
    stdout: text(v.stdout, 'Tool stdout', 100000), stderr: text(v.stderr, 'Tool stderr', 100000),
    exitCode: v.exitCode === null ? null : numeric(v.exitCode, -2147483648, 4294967295), elapsedMs: numeric(v.elapsedMs, 0, 1e12),
    artifacts: list(v.artifacts ?? [], 8).map(validateArtifact), truncated: v.truncated === true };
}
function validateToolMessage(value: unknown): ApiMessage {
  const v = record(value);
  if (!['assistant','tool'].includes(String(v.role))) throw new InputError('Invalid role in tool history.');
  const message: ApiMessage = { role: v.role as ApiMessage['role'], content: text(v.content, 'Tool history', LIMITS.response) };
  if (v.role === 'tool') message.tool_call_id = text(v.tool_call_id, 'Tool call ID', 200, true);
  if (v.tool_calls !== undefined) message.tool_calls = list(v.tool_calls, 4).map(item => {
    const c = record(item), f = record(c.function);
    if (c.type !== 'function') throw new InputError('Invalid tool-call type.');
    return { id: text(c.id, 'Tool call ID', 200, true), type: 'function', function: { name: text(f.name, 'Tool name', 80, true), arguments: text(f.arguments, 'Tool arguments', 128000) } };
  });
  if (v.reasoning_content !== undefined) message.reasoning_content = text(v.reasoning_content, 'Provider tool reasoning', LIMITS.response);
  return message;
}

function integer(value: unknown, low: number, high: number): number {
  const n=numeric(value,low,high); if(!Number.isInteger(n)) throw new InputError('Expected an integer.'); return n;
}
function validateDelegate(value: unknown): NonNullable<ToolRun['delegate']> {
  const v=record(value);
  if(!['waiting','thinking','answering'].includes(String(v.phase))) throw new InputError('Invalid delegate phase.');
  const u=v.usage===null?null:record(v.usage);
  return {model:text(v.model,'Delegate model',200,true),task:text(v.task,'Delegate task',16000,true),
    content:text(v.content,'Delegate answer',48000),reasoning:text(v.reasoning,'Delegate reasoning',64000),
    phase:v.phase as 'waiting'|'thinking'|'answering',usage:u?{input:numeric(u.input,0,1e9),output:numeric(u.output,0,1e9)}:null};
}
function validateProvider(value: unknown): NonNullable<ToolRun['provider']> {
  const v=record(value);
  if(!['web_search','code_execution'].includes(String(v.family))) throw new InputError('Unknown provider tool family.');
  return {itemId:text(v.itemId,'Provider item',200,true),round:integer(v.round,0,4),family:v.family as 'web_search'|'code_execution',
    sources:list(v.sources,30).map(item=>{const s=record(item),url=text(s.url,'Source URL',2048,true);let u;try{u=new URL(url);}catch{throw new InputError('Invalid source URL.');}
      if(!['https:','http:'].includes(u.protocol)||u.username||u.password)throw new InputError('Unsafe source URL.');
      return {url:u.href,title:text(s.title,'Source title',240)};})};
}
