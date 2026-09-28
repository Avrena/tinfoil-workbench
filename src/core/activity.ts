import type { ToolRun } from './types.js';
import { InputError, record, text } from './validation.js';

export const DELEGATE_TOOL = {
  type: 'function', function: {
    name: 'delegate_task',
    description: 'Request one independent text-only sub-agent analysis using the SAME model, subject to explicit user approval and extra inference usage. Supply the complete task and only necessary context. The child cannot read this conversation, use tools, access files, or delegate again. At most two approved delegated requests per user send (shared by comparison lanes). Return is a tool result, not a background agent.',
    parameters: { type: 'object', properties: { task: { type: 'string', description: 'Self-contained task and selected context, at most 16,000 characters.' } }, required: ['task'], additionalProperties: false },
  },
};
export function delegateArguments(raw: string): { task: string } {
  if(raw.length>24000)throw new InputError('Delegated task arguments exceed 24,000 characters.');
  let value;try {value=record(JSON.parse(raw));}catch{throw new InputError('Invalid delegated task arguments.');}
  if(Object.keys(value).some(key=>key!=='task'))throw new InputError('Delegation accepts only a self-contained task.');
  return {task:text(value.task,'Delegated task',16000,true)};
}
export const toolActive = (tool: ToolRun): boolean => ['queued','running','awaiting_approval'].includes(tool.status);
export interface ActivityGroup { id: string; tools: ToolRun[]; batch: boolean }
/** Group only explicit call-round identifiers; never infer concurrency from proximity or tool names. */
export function activityGroups(tools: ToolRun[]): ActivityGroup[] {
  const groups: ActivityGroup[]=[],batches=new Map<string,ActivityGroup>();
  for(const tool of tools){
    if(tool.batchId){let group=batches.get(tool.batchId);if(!group){group={id:tool.batchId,tools:[],batch:true};batches.set(tool.batchId,group);groups.push(group);}group.tools.push(tool);}
    else groups.push({id:tool.id,tools:[tool],batch:false});
  }
  return groups;
}
export function batchSummary(tools: ToolRun[]): string {
  const count=(state:ToolRun['status'])=>tools.filter(t=>t.status===state).length;
  const parts=[count('complete')?`${count('complete')} done`:'',count('running')?`${count('running')} running`:'',count('awaiting_approval')?'approval needed':'',count('queued')?`${count('queued')} queued`:'',count('error')?`${count('error')} failed`:'',count('denied')?`${count('denied')} declined`:'',count('cancelled')?`${count('cancelled')} cancelled`:''];
  return parts.filter(Boolean).join(' · ');
}
