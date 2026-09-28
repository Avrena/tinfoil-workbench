import type { Workspace, Thread } from './types.js';
import { findThread, forkThread } from './workspace.js';
import { InputError, LIMITS, text } from './validation.js';

/** Linear prefix/suffix mapping; never performs an unbounded character diff. */
export function editSpan(before:string, after:string): {start:number; oldEnd:number; newEnd:number} {
  let start=0, tail=0;
  while(start<before.length && start<after.length && before[start]===after[start]) start++;
  while(tail<before.length-start && tail<after.length-start && before[before.length-1-tail]===after[after.length-1-tail]) tail++;
  return {start,oldEnd:before.length-tail,newEnd:after.length-tail};
}
export function mapEditOffset(offset:number,before:string,after:string):number {
  const {start,oldEnd,newEnd}=editSpan(before,after);
  if(offset<=start)return Math.min(offset,after.length);
  if(offset>=oldEnd)return Math.min(after.length,Math.max(0,offset+after.length-before.length));
  return newEnd; // A figure inside replaced text follows that replacement.
}
export interface EditRequest {turnId:string;replyId:string;content:string;reasoning:string;expectedContent:string;expectedReasoning:string}
export function editReply(workspace:Workspace,threadId:string,change:EditRequest):Thread {
  const source=findThread(workspace,threadId),turn=source.turns.find(t=>t.id===change.turnId);
  const reply=turn?.replies.find(r=>r.id===change.replyId);
  if(!reply || reply.status!=='complete')throw new InputError('Only a completed reply can be revised. Stop/retry unfinished replies first.');
  const content=text(change.content,'Reply',LIMITS.response),reasoning=text(change.reasoning,'Thinking text',LIMITS.response);
  if(content.length+reasoning.length>LIMITS.response)throw new InputError('Combined reply and thinking text exceeds the local size limit.');
  if(reply.content!==change.expectedContent||reply.reasoning!==change.expectedReasoning)throw new InputError('This reply changed while the editor was open. Reopen the editor before saving.');
  if(!reply.reasoning && !reply.edit?.originalReasoning && reasoning)throw new InputError('There is no returned thinking text to edit.');
  if(content===reply.content && reasoning===reply.reasoning)throw new InputError('Nothing has changed.');
  const branch=forkThread(workspace,threadId,change.turnId,false,change.replyId);
  branch.title=`${source.title.replace(/ · (branch|edited)$/,'').slice(0,108)} · edited`;
  const edited=branch.turns.at(-1)!.replies.find(r=>r.id===change.replyId)!;
  const originalContent=edited.edit?.originalContent??edited.content,originalReasoning=edited.edit?.originalReasoning??edited.reasoning;
  const historyRewritten=edited.edit?.historyRewritten===true || edited.edit?.contentEdited===true || content!==edited.content;
  if(content!==edited.content){
    for(const tool of edited.tools??[])tool.contentOffset=mapEditOffset(tool.contentOffset??edited.content.length,edited.content,content);
    if(edited.finalContentOffset!==undefined)edited.finalContentOffset=mapEditOffset(edited.finalContentOffset,edited.content,content);
  }
  edited.content=content;edited.reasoning=reasoning;
  edited.edit={originalContent,originalReasoning,contentEdited:content!==originalContent,reasoningEdited:reasoning!==originalReasoning,historyRewritten,editedAt:Date.now()};
  return branch;
}

/** Validate before allocating a branch, and never make a billable request. */
export function editPrompt(workspace:Workspace,id:string,turnId:string,content:string,expectedContent:string):Thread {
  const source=findThread(workspace,id),turn=source.turns.find(t=>t.id===turnId);
  if(!turn)throw new InputError('Turn not found.');
  text(content,'Prompt',LIMITS.prompt,true);
  if(turn.prompt!==expectedContent)throw new InputError('This prompt changed while the editor was open.');
  if(turn.prompt===content)throw new InputError('Nothing has changed.');
  const branch=forkThread(workspace,id,turnId,true);branch.draft=content;return branch;
}
