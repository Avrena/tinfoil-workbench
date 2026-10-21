import { InputError, record, text } from './validation.js';

export interface RemoteGeneration { systemPrompt: string; systemPromptName: string; temperature: number | null; reasoningEffort: string; thinkingMode: 'default' | 'enabled' | 'disabled' }
export interface RemoteSettings extends RemoteGeneration { maxSeconds: number; maxRounds: number; maxCalls: number; maxTokens: number }
export interface RemoteDraft extends RemoteSettings { workspace: string; prompt: string; model: string }
export interface RemoteHost { id: string; alias: string; name: string; draft: RemoteDraft; jobTitles?: Record<string,string>; pendingJob?: string; pendingDraftHash?: string }
export interface RemoteLocal { version: 1; hosts: RemoteHost[]; selectedHost: string | null }
export interface RemoteWorkspace { id: string; name?: string; createdAt: number; lastUsed: number; quotaBytes: number; activeJobs: string[]; provisioningFailed?: boolean }
export interface RemoteJob { id: string; workspace: string; status: string; reason?: string; prompt?: string; model?: string; createdAt?: number; startedAt?: string; finishedAt?: string; rounds?: number; calls?: number; error?: string; service?: string; verified?: boolean; usage?: { input: number; output: number } }
export type RemoteTranscriptEntry =
  | { id: string; role: 'assistant'; content: string; reasoning: string; partial?: boolean }
  | { id: string; role: 'tool'; tool: number };
export interface RemoteDetail extends RemoteJob { settings?: RemoteSettings; content?: string; reasoning?: string; partial?: { content?: string; reasoning?: string }; truncated?: boolean; transcript?: RemoteTranscriptEntry[]; tools?: { id: string; name: string; arguments: string; status: string; error?: string; result?: { text?: string; diff?: string; stdout?: string; stderr?: string; exitCode?: number; timedOut?: boolean } }[] }
export interface RemoteOverview { protocol: number; features?: { jobSettings: boolean }; auth: { enrolled: boolean; defaultModel: string | null }; workspaces: RemoteWorkspace[]; jobs: RemoteJob[]; jobsTruncated: boolean; checkedAt: number }
export type RemoteCommand =
  | { type: 'load' }
  | { type: 'host.add'; alias: string; name: string }
  | { type: 'host.select' | 'host.remove' | 'submit' | 'enroll' | 'disconnect'; host: string }
  | { type: 'refresh'; host: string; id?: string }
  | { type: 'draft.set'; host: string; draft: RemoteDraft }
  | { type: 'job.rename'; host: string; id: string; title: string }
  | { type: 'workspace.create'; host: string; name: string }
  | { type: 'workspace.archive' | 'workspace.delete' | 'job.read' | 'job.stop' | 'job.delete'; host: string; id: string };
export interface RemoteResponse { local: RemoteLocal; overview?: RemoteOverview; detail?: RemoteDetail; selectedJob?: string; message?: string; cancelled?: boolean }
export const emptyRemoteDraft = (): RemoteDraft => ({ workspace: '', prompt: '', model: 'default', systemPrompt: '', systemPromptName: '', temperature: null, reasoningEffort: 'default', thinkingMode: 'default', maxSeconds: 1800, maxRounds: 20, maxCalls: 40, maxTokens: 4096 });
export const remoteActive = (status: string): boolean => ['starting', 'authenticating', 'running', 'stopping'].includes(status);
export function remoteID(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-f0-9]{32}$/.test(value)) throw new InputError('Invalid remote identifier.');
  return value;
}
export function remoteAlias(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,100}$/.test(value)) throw new InputError('Enter an SSH configuration alias, without spaces or command options.');
  return value;
}
export function remoteName(value: unknown): string {
  const name = text(value, 'Name', 80, true).trim();
  if (!name || /[\x00-\x1f\x7f]/.test(name)) throw new InputError('Enter a name of 1–80 characters on one line.');
  return name;
}
/** Display-only labels in the encrypted local vault. Never sent to the host or provider. */
export function remoteTitle(value: unknown): string {
  const title = text(value,'Task title',200,true).trim();
  if(!title || /[\x00-\x1f\x7f]/.test(title))throw new InputError('Enter a title of 1–200 characters on one line.');
  return title;
}
export function remoteTitles(value: unknown): Record<string,string> {
  const entries=Object.entries(record(value??{}));
  if(entries.length>200)throw new InputError('Too many local task titles.');
  return Object.fromEntries(entries.map(([id,title])=>[remoteID(id),remoteTitle(title)]));
}
/** New fields have defaults so existing encrypted drafts and retained jobs still open. */
export function remoteGeneration(value: unknown): RemoteGeneration {
  const input = record(value), systemPrompt = text(input.systemPrompt === undefined ? '' : input.systemPrompt, 'System instructions', 40000);
  const name = text(input.systemPromptName === undefined ? '' : input.systemPromptName, 'Instructions name', 80).trim();
  if (/[\x00-\x1f\x7f]/.test(name)) throw new InputError('Instructions name must be on one line.');
  const temperature = input.temperature ?? null;
  if (temperature !== null && (typeof temperature !== 'number' || !Number.isFinite(temperature) || temperature < 0 || temperature > 2)) throw new InputError('Temperature must be between 0 and 2, or blank for provider default.');
  const reasoningEffort = input.reasoningEffort === undefined ? 'default' : input.reasoningEffort, thinkingMode = input.thinkingMode === undefined ? 'default' : input.thinkingMode;
  if (typeof reasoningEffort !== 'string' || !['default','minimal','low','medium','high','xhigh','max','ultra'].includes(reasoningEffort)) throw new InputError('Invalid reasoning effort.');
  if (thinkingMode !== 'default' && thinkingMode !== 'enabled' && thinkingMode !== 'disabled') throw new InputError('Invalid thinking mode.');
  return { systemPrompt, systemPromptName: systemPrompt.trim() ? name : '', temperature, reasoningEffort, thinkingMode };
}
export function remoteSettings(value: unknown): RemoteSettings {
  const input = record(value), result = { ...remoteGeneration(input), maxSeconds: 1800, maxRounds: 20, maxCalls: 40, maxTokens: 4096 };
  for (const [key, max] of [['maxSeconds',3600],['maxRounds',30],['maxCalls',60],['maxTokens',16384]] as const) {
    const n = input[key]; if (typeof n !== 'number' || !Number.isInteger(n) || n < 1 || n > max) throw new InputError(`${key} must be between 1 and ${max}.`);
    result[key] = n;
  }
  return result;
}
export function remoteDraft(value: unknown): RemoteDraft {
  const input = record(value), result: RemoteDraft = { ...emptyRemoteDraft(), ...remoteSettings(input) };
  result.workspace = input.workspace === '' ? '' : remoteID(input.workspace);
  result.prompt = text(input.prompt, 'Task', 160000);
  result.model = text(input.model, 'Model', 200, true).trim();
  if (!result.model || /[\x00-\x1f\x7f]/.test(result.model)) throw new InputError('Enter an exact model ID, or default.');
  return result;
}

/** Remote host data is untrusted: whitelist fields before it reaches renderer templates. */
const list = (value: unknown, max: number): unknown[] => {if(!Array.isArray(value)||value.length>max)throw new InputError('Invalid remote response.');return value;};
const count = (value: unknown): number => {if(typeof value!=='number'||!Number.isFinite(value)||value<0)throw new InputError('Invalid remote response.');return value;};
function jobData(value:unknown):RemoteJob {
  const r=record(value),job:RemoteJob={id:remoteID(r.id),workspace:remoteID(r.workspace),status:text(r.status,'Job status',40,true)};
  for(const key of ['prompt','model','startedAt','finishedAt','error','reason','service'] as const)if(r[key]!==undefined)job[key]=text(r[key],key,key==='prompt'?16000:2000);
  for(const key of ['createdAt','rounds','calls'] as const)if(r[key]!==undefined)job[key]=count(r[key]);
  if(r.verified!==undefined)job.verified=r.verified===true;
  if(r.usage){const u=record(r.usage);job.usage={input:count(u.input),output:count(u.output)};}
  return job;
}
export function remoteDetail(value:unknown):RemoteDetail {
  const r=record(value),detail:RemoteDetail=jobData(r);
  if(r.settings!==undefined)detail.settings=remoteSettings(r.settings);
  for(const key of ['content','reasoning'] as const)if(r[key]!==undefined)detail[key]=text(r[key],key,100000);
  if(r.partial){const p=record(r.partial);detail.partial={content:text(p.content??'','Partial answer',100000),reasoning:text(p.reasoning??'','Partial reasoning',100000)};}
  detail.truncated=r.truncated===true;
  detail.tools=list(r.tools??[],60).map(item=>{const t=record(item),raw=record(t.result??{}),result:NonNullable<NonNullable<RemoteDetail['tools']>[number]['result']>={};
    for(const key of ['text','diff','stdout','stderr'] as const)if(raw[key]!==undefined)result[key]=text(raw[key],key,8000);
    if(raw.exitCode!=null){if(typeof raw.exitCode!=='number'||!Number.isInteger(raw.exitCode))throw new InputError('Invalid tool exit code.');result.exitCode=raw.exitCode;}
    if(raw.timedOut!==undefined)result.timedOut=raw.timedOut===true;
    return {id:text(t.id,'Tool ID',16000),name:text(t.name,'Tool name',16000),arguments:text(t.arguments,'Tool arguments',16000),status:text(t.status,'Tool status',40),error:text(t.error??'','Tool error',16000),result};});
  if(r.transcript!==undefined){
    const seen=new Set<string>();let characters=0;
    detail.transcript=list(r.transcript,100).map(item=>{
      const entry=record(item),id=text(entry.id,'Transcript ID',80,true);
      if(!/^[a-zA-Z0-9_-]+$/.test(id)||seen.has(id))throw new InputError('Invalid remote transcript identifier.');
      seen.add(id);
      if(entry.role==='tool'){
        const index=entry.tool;
        if(typeof index!=='number'||!Number.isInteger(index)||index<0||index>=detail.tools!.length)throw new InputError('Invalid remote transcript tool.');
        return {id,role:'tool',tool:index};
      }
      if(entry.role!=='assistant')throw new InputError('Invalid remote transcript role.');
      const content=text(entry.content??'','Transcript content',100000),reasoning=text(entry.reasoning??'','Transcript reasoning',60000);
      characters+=content.length+reasoning.length;
      if(characters>160000)throw new InputError('Remote transcript exceeds its display limit.');
      return {id,role:'assistant',content,reasoning,...(entry.partial===true?{partial:true}:{})};
    });
  }
  return detail;
}
export function remoteOverview(value:unknown):RemoteOverview & {detail?:RemoteDetail} {
  const r=record(value);if(r.protocol!==1)throw new InputError('Update the remote worker to use the Workbench interface.');
  const a=record(r.auth);
  return {protocol:1,...(r.features!==undefined?{features:{jobSettings:record(r.features).jobSettings===true}}:{}),auth:{enrolled:a.enrolled===true,defaultModel:a.defaultModel===null?null:text(a.defaultModel,'Default model',200)},checkedAt:count(r.checkedAt),jobsTruncated:r.jobsTruncated===true,
    workspaces:list(r.workspaces,32).map(item=>{const w=record(item);return {id:remoteID(w.id),...(w.name!==undefined?{name:remoteName(w.name)}:{}),createdAt:count(w.createdAt),lastUsed:count(w.lastUsed),quotaBytes:count(w.quotaBytes),activeJobs:list(w.activeJobs,100).map(remoteID),provisioningFailed:w.provisioningFailed===true};}),
    jobs:list(r.jobs,200).map(jobData),...(r.detail?{detail:remoteDetail(r.detail)}:{})};
}
