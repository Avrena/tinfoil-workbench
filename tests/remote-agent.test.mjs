import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runJob, GUIDE } from '../remote/worker.mjs';
import { normalizeCapability } from '../dist/core/capabilities.js';
import { executeTool } from '../remote/container-tools.mjs';

const job = { id: 'a'.repeat(32), workspace: 'b'.repeat(32), model: 'test-model', prompt: 'Test task', maxRounds: 3, maxCalls: 4, maxTokens: 100 };
const answer = text => [{ choices: [{ delta: { content: text }, finish_reason: 'stop' }] }];
const call = (name, args) => [{ choices: [{ delta: { content: 'I will inspect the workspace.', tool_calls: [
  { index: 0, id: 'call_1', type: 'function', function: { name, arguments: JSON.stringify(args) } },
] }, finish_reason: 'tool_calls' }] }];
function provider(rounds, verified = true) {
  let count = 0;
  return { ready: async () => {}, getVerificationDocument: async () => ({ securityVerified: verified }),
    chat: { completions: { create: async function* () { for (const c of rounds[count++]) yield c; } } } };
}

test('remote worker verifies before generation and retains paired IDs across tools', async () => {
  const snapshots = [], actions = [];
  const state = await runJob(job, { client: provider([call('list_files', {}), answer('Done.')]),
    execute: async (name, raw) => { actions.push([name, raw]); return { text: 'test.txt' }; },
    save: async s => snapshots.push(structuredClone(s)), signal: new AbortController().signal });
  assert.equal(state.status, 'complete'); assert.equal(state.calls, 1);
  assert.equal(state.messages[2].tool_calls[0].id, state.messages[3].tool_call_id);
  assert.deepEqual(actions, [['list_files', '{}']]);
  assert.ok(snapshots.some(s => s.tools[0]?.status === 'running'));
  assert.equal(snapshots.at(-1).status, 'complete');
});

test('unverified provider never executes or generates', async () => {
  let generated = false;
  const client = provider([], false); client.chat.completions.create = () => { generated = true; throw new Error(); };
  const state = await runJob(job, { client, execute: () => assert.fail(), save: async () => {}, signal: new AbortController().signal });
  assert.equal(state.status, 'error'); assert.equal(generated, false);
  assert.match(state.error, /attestation/);
});

test('invalid tool batches, exhausted budgets and truncated answers fail closed', async () => {
  for (const [config, rounds] of [
    [job, [call('run_command', { command: 'true', workdir: '../outside' })]],
    [{ ...job, maxCalls: 0 }, [call('list_files', {})]],
    [job, [[{ choices: [{ delta: { content: 'Partial' }, finish_reason: 'length' }] }]]],
  ]) {
    const state = await runJob(config, { client: provider(rounds), execute: () => assert.fail(), save: async () => {}, signal: new AbortController().signal });
    assert.equal(state.status, 'error');
  }
});

test('provider failures are never automatically retried or serialized with secrets', async () => {
  let count = 0;
  const client = provider([]); client.chat.completions.create = () => { count++; throw new Error('key=secret'); };
  const state = await runJob(job, { client, execute: () => assert.fail(), save: async () => {}, signal: new AbortController().signal });
  assert.equal(count, 1); assert.equal(state.status, 'error'); assert.doesNotMatch(JSON.stringify(state), /key=secret/);
});

test('cancellation interrupts stalled verification and preserves a stopped checkpoint', async () => {
  const client = provider([]), controller = new AbortController();
  client.ready = () => new Promise(() => {});
  const timer = setTimeout(() => controller.abort(), 15);
  try {
    const state = await runJob(job, { client, execute: () => assert.fail(), save: async () => {}, signal: controller.signal });
    assert.equal(state.status, 'stopped');
  } finally { clearTimeout(timer); }
});

test('cancellation interrupts an unresolved verification document before generation', async () => {
  const client = provider([]), controller = new AbortController();
  client.getVerificationDocument = () => new Promise(() => {});
  client.chat.completions.create = () => assert.fail('Must wait for verified attestation.');
  const timer = setTimeout(() => controller.abort(), 15);
  try {
    const state = await runJob(job, { client, execute: () => assert.fail(), save: async () => {}, signal: controller.signal });
    assert.equal(state.status, 'stopped');
  } finally { clearTimeout(timer); }
});

test('cancellation interrupts a stalled stream without retry or executing a partial call', async () => {
  const client = provider([]), controller = new AbortController();
  client.chat.completions.create = async () => ({ [Symbol.asyncIterator]: () => ({ next: () => new Promise(() => {}) }) });
  const timer = setTimeout(() => controller.abort(), 15);
  try {
    const state = await runJob(job, { client, execute: () => assert.fail(), save: async () => {}, signal: controller.signal });
    assert.equal(state.status, 'stopped');
  } finally { clearTimeout(timer); }
});

test('remote file tools share Workbench edit, search and confinement checks', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'tw-remote-'));
  try {
    await executeTool('write_file', '{"path":"a.txt","content":"hello\\n"}', folder);
    await executeTool('edit_file', '{"path":"a.txt","old_text":"hello","new_text":"world"}', folder);
    assert.equal(await readFile(join(folder, 'a.txt'), 'utf8'), 'world\n');
    assert.match((await executeTool('search_files', '{"pattern":"world"}', folder)).text, /a.txt:1/);
    await assert.rejects(executeTool('read_file', '{"path":"../secret"}', folder), /above/);
  } finally { await rm(folder, { recursive: true, force: true }); }
});

const configurable = normalizeCapability({modelName:'test-model',chatConfig:{reasoningConfig:{supportsEffort:true,
  effortMap:{high:'high',max:'max'},supportsToggle:true,params:{'/v1/chat/completions':{
    enable:{reasoning_effort:'$EFFORT',thinking:{type:'enabled'},api_key:'forbidden',messages:'forbidden'},disable:{thinking:{type:'disabled'}},
  }}}}});

test('remote job applies captured instructions and generation settings to every tool round',async()=>{
  const sent=[];let catalogs=0;
  const client=provider([call('list_files',{}),answer('Done.')]),generate=client.chat.completions.create;
  client.chat.completions.create=(request,options)=>{sent.push(structuredClone(request));return generate(request,options);};
  const settings={systemPrompt:'Keep these exact\ninstructions.',systemPromptName:'DISPLAY_LABEL_ONLY',temperature:0.25,reasoningEffort:'high',thinkingMode:'enabled'};
  const state=await runJob({...job,...settings},{client,execute:async()=>({text:'file.txt'}),save:async()=>{},signal:new AbortController().signal,
    loadCapabilities:async()=>{catalogs++;return[configurable];}});
  assert.equal(state.status,'complete');assert.equal(catalogs,1);assert.equal(sent.length,2);
  for(const request of sent){
    assert.deepEqual(request.messages.slice(0,3),[{role:'system',content:GUIDE},{role:'system',content:settings.systemPrompt},{role:'user',content:job.prompt}]);
    assert.equal(request.temperature,0.25);assert.equal(request.max_tokens,100);assert.equal(request.reasoning_effort,'high');assert.deepEqual(request.thinking,{type:'enabled'});
    assert.equal(request.api_key,undefined);assert.doesNotMatch(JSON.stringify(request),/DISPLAY_LABEL_ONLY|forbidden/);
  }
});

test('default remote settings preserve the provider default without a catalog dependency',async()=>{
  let request;
  const client=provider([answer('Done.')]),generate=client.chat.completions.create;
  client.chat.completions.create=(r,o)=>{request=structuredClone(r);return generate(r,o);};
  const state=await runJob({...job,systemPrompt:' ',systemPromptName:'Unused'},{client,execute:()=>assert.fail(),save:async()=>{},signal:new AbortController().signal,loadCapabilities:()=>assert.fail()});
  assert.equal(state.status,'complete');assert.equal(request.messages.length,2);assert.equal(request.temperature,undefined);
  assert.equal(request.reasoning_effort,undefined);assert.equal(request.thinking,undefined);
});

test('unsupported or unavailable reasoning controls fail before generation with no fallback',async()=>{
  for(const [settings,loadCapabilities] of [
    [{reasoningEffort:'low'},async()=>[configurable]],
    [{thinkingMode:'enabled'},async()=>[]],
    [{reasoningEffort:'high'},async()=>{throw Error('private headers');}],
  ]){
    const client=provider([]);client.chat.completions.create=()=>assert.fail('Do not silently ignore the reviewed settings.');
    const state=await runJob({...job,...settings},{client,execute:()=>assert.fail(),save:async()=>{},signal:new AbortController().signal,loadCapabilities});
    assert.equal(state.status,'error');assert.equal(state.reason,'configuration');assert.doesNotMatch(state.error,/private headers/);
  }
});

test('thinking off is independent of effort and stalled catalog lookup remains cancellable',async()=>{
  let request;
  const client=provider([answer('Done.')]),generate=client.chat.completions.create;
  client.chat.completions.create=(r,o)=>{request=r;return generate(r,o);};
  const state=await runJob({...job,reasoningEffort:'high',thinkingMode:'disabled'},{client,execute:()=>assert.fail(),save:async()=>{},signal:new AbortController().signal,loadCapabilities:async()=>[configurable]});
  assert.equal(state.status,'complete');assert.equal(request.reasoning_effort,undefined);assert.deepEqual(request.thinking,{type:'disabled'});
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15);
  try{
    const stopped=await runJob({...job,reasoningEffort:'high'},{client:provider([]),execute:()=>assert.fail(),save:async()=>{},signal:controller.signal,loadCapabilities:()=>new Promise(()=>{})});
    assert.equal(stopped.status,'stopped');
  }finally{clearTimeout(timer);}
});
