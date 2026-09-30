import type { Reply, Thread, Turn, Workspace } from './types.js';
import { buildHistory, findThread, uid } from './workspace.js';
import { addVersion } from './versions.js';
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
/** Saves an edited answer or thinking text as a new version of its turn, holding only the edited reply. The turn as it
 * was, and the turns after it, become the version before (core/versions.ts). No model is asked. */
export function editReply(workspace:Workspace,threadId:string,change:EditRequest):Thread {
  const source=findThread(workspace,threadId),index=source.turns.findIndex(t=>t.id===change.turnId),turn=source.turns[index];
  const reply=turn?.replies.find(r=>r.id===change.replyId);
  if(!turn||!reply || reply.status!=='complete')throw new InputError('Only a completed reply can be revised. Stop or retry an unfinished reply first.');
  const content=text(change.content,'Reply',LIMITS.response),reasoning=text(change.reasoning,'Thinking text',LIMITS.response);
  if(content.length+reasoning.length>LIMITS.response)throw new InputError('Combined reply and thinking text exceeds the local size limit.');
  if(reply.content!==change.expectedContent||reply.reasoning!==change.expectedReasoning)throw new InputError('This reply changed while it was being edited. Edit it again.');
  if(!reply.reasoning && !reply.edit?.originalReasoning && reasoning)throw new InputError('There is no returned thinking text to edit.');
  if(content===reply.content && reasoning===reply.reasoning)throw new InputError('Nothing has changed.');
  buildHistory(source,index); // The turns before it must hold completed replies, as a continuation needs.
  const edited:Reply={...structuredClone(reply),id:uid()};
  const originalContent=edited.edit?.originalContent??edited.content,originalReasoning=edited.edit?.originalReasoning??edited.reasoning;
  const historyRewritten=edited.edit?.historyRewritten===true || edited.edit?.contentEdited===true || content!==edited.content;
  if(content!==edited.content){
    for(const tool of edited.tools??[])tool.contentOffset=mapEditOffset(tool.contentOffset??edited.content.length,edited.content,content);
    if(edited.finalContentOffset!==undefined)edited.finalContentOffset=mapEditOffset(edited.finalContentOffset,edited.content,content);
  }
  edited.content=content;edited.reasoning=reasoning;
  edited.edit={originalContent,originalReasoning,contentEdited:content!==originalContent,reasoningEdited:reasoning!==originalReasoning,historyRewritten,editedAt:Date.now()};
  const head:Turn={id:uid(),prompt:turn.prompt,attachments:structuredClone(turn.attachments),createdAt:turn.createdAt,replies:[edited],selectedReplyId:edited.id};
  addVersion(source,index,head);source.updatedAt=Date.now();
  return source;
}
