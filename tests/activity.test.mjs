import test from 'node:test';
import assert from 'node:assert/strict';
import { RouterEventParser, parseRouterEvent } from '../dist/core/provider-events.js';
import { activityGroups, batchSummary, delegateArguments } from '../dist/core/activity.js';
import { validateTool, validateWorkspace, settings } from '../dist/core/validation.js';
import { newWorkspace, defaults, recoverInterrupted, exportMarkdown } from '../dist/core/workspace.js';
const event={type:'tinfoil.web_search_call',item_id:'call_x',status:'completed',action:{type:'search',query:'example'},sources:[{url:'https://example.org/doc',title:'Example'}]};
const marker=v=>`\n<tinfoil-event>${JSON.stringify(v)}</tinfoil-event>\n`;
const tool=(id,status,extra={})=>({id,callId:id,name:'render_chart',arguments:'{}',origin:'model',status,stdout:'',stderr:'',exitCode:null,elapsedMs:0,artifacts:[],truncated:false,...extra});
function decode(chunks){const p=new RouterEventParser(),parts=chunks.flatMap(c=>p.consume(c));return{text:parts.filter(p=>p.type==='text').map(p=>p.text).join('')+p.flush(),events:parts.filter(p=>p.type==='event').map(p=>p.event)};}

test('router events survive every possible two-chunk split without losing adjacent answer text',()=>{
 const raw='Before 中文🙂.'+marker(event)+'After.';
 for(let i=0;i<=raw.length;i++){const parsed=decode([raw.slice(0,i),raw.slice(i)]);assert.equal(parsed.text,'Before 中文🙂.After.',String(i));assert.equal(parsed.events.length,1);assert.equal(parsed.events[0].name,'Web search');}
});
test('one-character streaming preserves padding and multiple event order',()=>{
 const raw='Before\n\n'+marker({...event,status:'in_progress'})+'\n'+marker(event)+'After\n';
 const p=decode([...raw]);assert.equal(p.text,'Before\n\n\nAfter\n');assert.deepEqual(p.events.map(e=>e.status),['running','complete']);
});
test('ordinary text and incomplete delimiters are lossless at every chunk boundary',()=>{
 for(const raw of ['x < y\n','a\n\nb','<tinfoil-even','\n<tinfoil-event>{','console.log("<hello>")','Text\n\n'])for(let i=0;i<=raw.length;i++)assert.equal(decode([raw.slice(0,i),raw.slice(i)]).text,raw);
});
test('unknown, malformed, missing-ID and unsupported-status event markers remain inert source text',()=>{
 for(const v of [{...event,type:'tinfoil.subagent'},{...event,status:'invented'},{...event,item_id:undefined},null]){const raw=marker(v);assert.equal(decode([...raw]).text,raw);assert.equal(decode([raw]).events.length,0);}
 const raw='\n<tinfoil-event>{bad json}</tinfoil-event>\n';assert.equal(decode([...raw]).text,raw);
});
test('oversized event payload is not retained indefinitely or accepted as activity',()=>{
 const raw='<tinfoil-event>'+JSON.stringify({...event,extra:'x'.repeat(70000)})+'</tinfoil-event>';
 const decoded=decode(Array.from({length:Math.ceil(raw.length/500)},(_,i)=>raw.slice(i*500,i*500+500)));assert.equal(decoded.text,raw);assert.equal(decoded.events.length,0);
});
test('secret fields are redacted and unsafe source links are excluded',()=>{
 const parsed=parseRouterEvent(JSON.stringify({...event,action:{type:'search',query:'safe',nested:{accessToken:'secret',encryptionKey:'key',password:'pw'}},sources:[{url:'javascript:alert(1)'},{url:'https://u:p@example.org'},{url:'https://example.org',title:'safe'}]}));
 assert.ok(!parsed.arguments.includes('secret'));assert.equal(parsed.sources.length,1);assert.equal(parsed.sources[0].url,'https://example.org/');
});
test('code-execution metadata is data only, with explicit states',()=>{
 for(const [status,expected] of [['in_progress','running'],['completed','complete'],['failed','error'],['blocked','denied']]){
  const e=parseRouterEvent(JSON.stringify({type:'tinfoil.tool_call',item_id:'exec',status,tool:{name:'python',arguments:{code:'print(1)'},output:'1'}}));
  assert.equal(e.status,expected);assert.equal(e.family,'code_execution');assert.equal(e.output,'1');
 }
});
test('batch grouping requires an explicit batch ID, never inferred simultaneity',()=>{
 const list=[tool('a','complete'),tool('b','running',{batchId:'round_1',batchIndex:0,batchSize:2}),tool('c','queued',{batchId:'round_1',batchIndex:1,batchSize:2}),tool('d','complete')];
 const groups=activityGroups(list);assert.equal(groups.length,3);assert.equal(groups[1].tools.length,2);assert.equal(batchSummary(groups[1].tools),'1 running · 1 queued');
});
test('mixed batch summary distinguishes failed declined and cancelled from done',()=>{
 const label=batchSummary([tool('a','complete'),tool('b','error'),tool('c','denied'),tool('d','cancelled')]);assert.equal(label,'1 done · 1 failed · 1 declined · 1 cancelled');
});
test('delegated tasks have bounded exact input and no credential/model override fields',()=>{
 assert.deepEqual(delegateArguments('{"task":"Review this text."}'),{task:'Review this text.'});
 for(const raw of ['{}','null','{"task":""}','{"task":"x","model":"other"}',JSON.stringify({task:'x'.repeat(16001)})])assert.throws(()=>delegateArguments(raw));
});
test('legacy settings migrate without enabling web search or delegation',()=>{
 const old={...defaults};delete old.webSearch;delete old.delegateMode;assert.equal(settings(old).webSearch,false);assert.equal(settings(old).delegateMode,'off');
});
test('tool activity, delegate output and MCP sources validate and survive workspace persistence',()=>{
 const w=newWorkspace(),t=w.threads[0];t.turns=[{id:'turn',prompt:'hello',attachments:[],createdAt:0,selectedReplyId:'reply',replies:[{id:'reply',model:'fixture',content:'',reasoning:'',status:'complete',finishReason:'stop',error:null,usage:null,elapsedMs:0,tools:[tool('a','complete',{batchId:'batch',batchIndex:0,batchSize:1,delegate:{model:'fixture',task:'review',content:'ok',reasoning:'thought',phase:'answering',usage:{input:1,output:2}}}),tool('b','complete',{origin:'provider',provider:{itemId:'remote',round:0,family:'web_search',sources:[{url:'https://example.org/',title:'example'}]}})]}]}];
 assert.deepEqual(validateWorkspace(w).threads[0].turns[0].replies[0].tools,t.turns[0].replies[0].tools);
});
test('recovery cancels queued actions without running or claiming they completed',()=>{
 const w=newWorkspace();w.threads[0].turns=[{replies:[{status:'executing',tools:[tool('a','queued'),tool('b','running'),tool('c','awaiting_approval')]}]}];
 assert.equal(recoverInterrupted(w),true);assert.deepEqual(w.threads[0].turns[0].replies[0].tools.map(t=>t.status),['cancelled','cancelled','cancelled']);
});
test('untrusted persistence cannot smuggle unsafe provider links or oversized delegates',()=>{
 assert.throws(()=>validateTool(tool('x','complete',{provider:{itemId:'r',round:0,family:'web_search',sources:[{url:'file:///x',title:'x'}]}})));
 assert.throws(()=>validateTool(tool('x','complete',{batchId:'batch',batchIndex:0.5,batchSize:2})));
});


test('plaintext export preserves activity provenance and separate child usage and reasoning',()=>{
 const t=newWorkspace().threads[0];t.turns=[{prompt:'Example',attachments:[],selectedReplyId:'r',replies:[{id:'r',model:'m',status:'complete',content:'Done.',tools:[tool('d','complete',{name:'delegate_task',batchId:'b',batchIndex:0,batchSize:2,delegate:{model:'m',task:'Review',content:'Finding',reasoning:'Actual child reasoning',phase:'answering',usage:{input:4,output:3}},stdout:'Finding'}),tool('p','complete',{origin:'provider',provider:{itemId:'remote',round:0,family:'web_search',sources:[{title:'Source',url:'https://example.org/'}]}})]}]}];
 const output=exportMarkdown(t);assert.match(output,/action 1\/2/);assert.match(output,/Client-orchestrated sub-agent/);assert.match(output,/Delegate usage only: 4 input \/ 3 output/);assert.match(output,/Actual child reasoning/);assert.match(output,/not executed by this client/);
});
