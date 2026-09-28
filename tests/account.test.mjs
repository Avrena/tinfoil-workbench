import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { EventEmitter } from 'node:events';
import { AccountSession } from '../desktop/account-session.mjs';
import { AccountWindow,sessionScript,signInScript } from '../desktop/account-window.mjs';
import { normalizeProfile,normalizeUsage,authOrigin,allowedAccountNavigation,CHAT_TOKEN_URL,signedOutAccount } from '../dist/core/account.js';
import { InputError,validateWorkspace } from '../dist/core/validation.js';
import { newWorkspace,buildHistory,beginTurn,forkThread,exportThread,importThread } from '../dist/core/workspace.js';
import { WorkbenchService } from '../desktop/service.mjs';
const now=()=>Date.parse('2026-09-28T12:00:00Z');
const raw=(id='user_test')=>({sessionUserId:id,bearer:'clerk-secret',profile:{id,name:'Example User',email:'example@example.invalid',emailVerified:true,subscriptionStatus:'active',subscriptionExpiresAt:'2026-10-28T12:00:00Z'}});
const body=()=>({key:'inference-secret',expires_at:'2026-09-28T13:00:00Z',rate_limit:{max_input_tokens:1000,input_tokens_used:100,input_tokens_remaining:900,max_output_tokens:200,output_tokens_used:50,output_tokens_remaining:150,resets_at:'2026-09-28T12:30:00Z'}});
const response=(status=200,b=body())=>new Response(JSON.stringify(b),{status,headers:{'content-type':'application/json'}});
function fixture(fetcher=async()=>response()){
  let source=raw();const requests=[],reads=[],events=[];let cleared=0;
  const adapter={login:async()=>source,readSession:async(force,id)=>{reads.push([force,id]);return source;},manage:async id=>{assert.equal(id,source.profile.id);},clear:async()=>{cleared++;}};
  const account=new AccountSession(adapter,s=>events.push(s),{now,fetcher:async(...args)=>{requests.push(args);return fetcher(...args);}});
  return {account,adapter,requests,reads,events,set:v=>source=v,get cleared(){return cleared;}};
}

test('profile exposes only normalized identity and explicit metadata',()=>{
 const p=normalizeProfile({...raw().profile,name:' A\x00 Name ',role:'admin',password:'secret',subscriptionStatus:'invented',subscriptionExpiresAt:'bad'});
 assert.equal(p.name,'A Name');assert.equal(p.subscriptionStatus,null);assert.equal(p.subscriptionExpiresAt,null);assert.equal(p.password,undefined);assert.equal(p.role,undefined);
 for(const x of [null,[],{}, {id:'not-clerk'}, {id:'https://attacker'}])assert.equal(normalizeProfile(x),null);
});
test('usage uses actual flat wire fields without inventing unlimited quotas',()=>{
 const u=normalizeUsage(body().rate_limit);assert.deepEqual(u.inputTokens,{max:1000,used:100,remaining:900});assert.equal(u.maxRequests,null);assert.equal(u.remaining,null);
 assert.equal(normalizeUsage({input_tokens:{max:10,used:1,remaining:9}}).inputTokens,null);
 assert.equal(normalizeUsage({remaining:-1,max_requests:Infinity}).remaining,null);assert.equal(normalizeUsage(null),null);
});
test('account origins reject credential URLs, lookalikes, non-HTTPS and nonstandard ports',()=>{
 for(const u of ['http://chat.tinfoil.sh','https://chat.tinfoil.sh.evil.test','https://evil.test/chat.tinfoil.sh','https://user@chat.tinfoil.sh','https://chat.tinfoil.sh:8443','file:///index.html','app://workbench/index.html','javascript:alert(1)']){assert.equal(authOrigin(u),false);assert.equal(allowedAccountNavigation(u),false);}
 assert.equal(authOrigin('https://chat.tinfoil.sh/'),true);assert.equal(allowedAccountNavigation('https://accounts.google.com/o/oauth2'),true);assert.equal(authOrigin('https://accounts.google.com'),false);
});
test('blank optional system prompts are omitted; supplied instructions remain user-controlled',()=>{
 const w=newWorkspace(),t=w.threads[0];assert.equal(t.settings.systemPrompt,'');assert.deepEqual(buildHistory(t),[]);
 t.settings.systemPrompt='   ';assert.deepEqual(buildHistory(t),[]);t.settings.systemPrompt='Use complete sentences.';assert.deepEqual(buildHistory(t),[{role:'system',content:'Use complete sentences.'}]);
});
test('session script uses Clerk getToken and reload only on demand, with an exact origin check',async()=>{
 let reloads=0,calls=[];const user={...raw().profile,firstName:'Example',lastName:'User',primaryEmailAddress:{emailAddress:'example@example.invalid',verification:{status:'verified'}},publicMetadata:{chat_subscription_status:'active'},reload:async()=>{reloads++;}};
 const clerk={loaded:true,user,session:{user,getToken:async opts=>{calls.push(opts);return 'session-secret';}}};
 const ctx={location:{origin:'https://chat.tinfoil.sh'},window:{Clerk:clerk}};
 const r=await vm.runInNewContext(sessionScript(false,'user_test'),ctx);assert.equal(r.profile.name,'Example User');assert.equal(r.bearer,'session-secret');assert.equal(reloads,0);assert.equal(calls[0].skipCache,false);
 await vm.runInNewContext(sessionScript(true,'user_test'),ctx);assert.equal(reloads,1);assert.equal(calls[1].skipCache,true);
 ctx.location.origin='https://attacker.invalid';assert.equal(await vm.runInNewContext(sessionScript(),ctx),null);assert.equal(calls.length,2);
});
test('session script detects user changes both before and during token retrieval',async()=>{
 let calls=0;const user={id:'user_old'},clerk={loaded:true,user,session:{user,getToken:async()=>{calls++;clerk.user={id:'user_new'};return 'should-not-escape';}}};
 const ctx={location:{origin:'https://chat.tinfoil.sh'},window:{Clerk:clerk}};
 assert.equal((await vm.runInNewContext(sessionScript(false,'user_other'),ctx)).changed,true);assert.equal(calls,0);
 const out=await vm.runInNewContext(sessionScript(false,'user_old'),ctx);assert.equal(out.changed,true);assert.equal(out.bearer,undefined);
});
test('sign-in script uses provider UI without password or token input fields',()=>{
 let calls=0;const ctx={location:{origin:'https://chat.tinfoil.sh'},window:{Clerk:{loaded:true,user:null,openSignIn:()=>{calls++;}}}};
 assert.equal(vm.runInNewContext(signInScript,ctx),true);assert.equal(calls,1);ctx.location.origin='https://attacker.invalid';assert.equal(vm.runInNewContext(signInScript,ctx),false);assert.equal(calls,1);
});
test('login exchanges at the fixed endpoint and never puts credentials in snapshots',async()=>{
 const f=fixture();await f.account.login();assert.equal(f.account.snapshot().status,'signed-in');assert.equal(f.account.snapshot().entitlement,'active');
 assert.equal(f.requests[0][0],CHAT_TOKEN_URL);assert.equal(f.requests[0][1].redirect,'error');assert.equal(f.requests[0][1].headers.Authorization,'Bearer clerk-secret');
 const all=JSON.stringify(f.events);assert.equal(all.includes('clerk-secret'),false);assert.equal(all.includes('inference-secret'),false);assert.equal(all.includes('bearer'),false);
 assert.equal(f.account.snapshot().usage.remaining,null);
});
test('cached inference token still checks the current identity before reuse',async()=>{
 const f=fixture();await f.account.login();const c=await f.account.getCredential();assert.equal(c.key,'inference-secret');assert.equal(f.requests.length,1);assert.equal(f.reads.length,2);
});
test('concurrent credential requests share one session check and one token mint',async()=>{
 const f=fixture();f.account.state={...signedOutAccount(),status:'signed-in',profile:normalizeProfile(raw().profile)};
 const results=await Promise.all([f.account.getCredential(),f.account.getCredential(),f.account.getCredential()]);assert.equal(f.requests.length,1);assert.equal(f.reads.length,1);assert.equal(results[2].key,'inference-secret');
});
test('expiry refresh mints a new credential instead of retaining it indefinitely',async()=>{
 let i=0;const f=fixture(async()=>response(200,{...body(),key:'credential-'+(++i)}));await f.account.login();f.account.now=()=>now()+3590000;
 assert.equal((await f.account.getCredential()).key,'credential-2');assert.equal(f.requests.length,2);
});
test('401 authorizes exactly one identity refresh, not an inference retry',async()=>{
 let n=0;const f=fixture(async()=>++n===1?response(401,{error:'no'}):response());await f.account.login();assert.equal(f.requests.length,2);assert.deepEqual(f.reads.map(x=>x[0]),[true,true]);assert.equal(f.account.snapshot().entitlement,'active');
});
test('repeated authorization rejection expires session without raw server secrets',async()=>{
 const f=fixture(async()=>response(401,{error:'leak: clerk-secret'}));await f.account.login();assert.equal(f.requests.length,2);assert.equal(f.account.snapshot().status,'expired');assert.equal(JSON.stringify(f.events).includes('clerk-secret'),false);await assert.rejects(f.account.getCredential(),/Sign in/);
});
test('402 keeps identity separate from entitlement and never requests a free or API key',async()=>{
 const f=fixture(async()=>response(402,{error:'subscription'}));await f.account.login();assert.equal(f.account.snapshot().status,'signed-in');assert.equal(f.account.snapshot().entitlement,'subscription-required');assert.equal(f.account.key,null);assert.deepEqual(f.requests.map(x=>x[0]),[CHAT_TOKEN_URL]);
});
test('429 records real reset budgets and blocks repeated minting until reset',async()=>{
 const f=fixture(async()=>response(429,{rate_limit:body().rate_limit,resets_at:'2026-09-28T12:30:00Z'}));await f.account.login();assert.equal(f.account.snapshot().entitlement,'rate-limited');
 await assert.rejects(f.account.getCredential(),/usage limit/);assert.equal(f.requests.length,1);assert.equal(f.account.snapshot().usage.resetsAt,now()+1800000);
});
test('malformed token, expired token and oversized responses cannot authenticate',async()=>{
 for(const b of [{key:'contains whitespace'}, {key:'valid',expires_at:'2020-01-01'}, {foo:'none'}, {key:'x'.repeat(70000)}]){
  const f=fixture(async()=>response(200,b));await f.account.login();assert.notEqual(f.account.snapshot().status,'signed-in');assert.equal(f.account.key,null);
 }
});
test('untrusted transport failures are replaced by a nonsecret message',async()=>{
 const f=fixture(async()=>{throw new Error('private https://foo/?clerk-secret');});await f.account.login();assert.equal(JSON.stringify(f.events).includes('clerk-secret'),false);assert.equal(f.account.key,null);
});
test('changing user after sign-in revokes cached credentials before any further fetch',async()=>{
 const f=fixture();await f.account.login();f.set(raw('user_other'));await assert.rejects(f.account.getCredential(),/account changed/);assert.equal(f.requests.length,1);assert.equal(f.account.snapshot().status,'expired');assert.equal(f.account.key,null);
});
test('mismatched Clerk user and session owner cannot authenticate',async()=>{
 const f=fixture();f.set({...raw(),sessionUserId:'user_other'});await f.account.login();assert.equal(f.requests.length,0);assert.equal(f.account.snapshot().status,'error');
});
test('sign-out clears session state, and late token responses cannot restore it',async()=>{
 let release;const pending=new Promise(r=>release=r);const f=fixture(async()=>pending);const login=f.account.login();
 while(!f.requests.length)await new Promise(r=>setImmediate(r));await f.account.signOut();release(response());await login;
 assert.deepEqual(f.account.snapshot(),signedOutAccount());assert.equal(f.account.key,null);assert.equal(f.cleared,1);
});
test('profile management calls the provider adapter only while signed in',async()=>{
 const f=fixture();await assert.rejects(f.account.manage(),/Sign in/);await f.account.login();await f.account.manage();await f.account.signOut();assert.equal(f.account.snapshot().profile,null);
});

function fakeElectron(){
 const windows=[],partitions=[];let currentSession;
 class Window extends EventEmitter{
  constructor(opts){super();this.opts=opts;this.dead=false;this.webContents=new EventEmitter();this.webContents.getURL=()=>this.url??'';this.webContents.executeJavaScript=async()=>raw();this.webContents.setWindowOpenHandler=fn=>this.popup=fn;windows.push(this);}
  isDestroyed(){return this.dead;}async loadURL(url){this.url=url;}show(){}hide(){}focus(){}destroy(){this.dead=true;this.emit('closed');}
 }
 const session={fromPartition:(name,opts)=>{partitions.push([name,opts]);const ses=new EventEmitter();ses.setPermissionRequestHandler=fn=>ses.permissions=fn;ses.setPermissionCheckHandler=fn=>ses.check=fn;ses.webRequest={onBeforeRequest:fn=>ses.request=fn};ses.closeAllConnections=async()=>{};ses.clearStorageData=async()=>{ses.cleared=true;};ses.clearCache=async()=>{};currentSession=ses;return ses;}};
 return{BrowserWindow:Window,session,windows,partitions,get ses(){return currentSession;}};
}
test('native account window has a separate memory-only partition and no preload or Node bridge',async()=>{
 const e=fakeElectron(),w=new AccountWindow(e);await w.create();const opts=e.windows[0].opts.webPreferences;
 assert.equal(e.partitions[0][0].startsWith('persist:'),false);assert.equal(e.partitions[0][1].cache,false);assert.equal(opts.preload,undefined);
 assert.equal(opts.nodeIntegration,false);assert.equal(opts.contextIsolation,true);assert.equal(opts.sandbox,true);assert.equal(opts.webSecurity,true);assert.equal(opts.devTools,false);
 let decision;e.ses.permissions(null,'media',v=>decision=v);assert.equal(decision,false);assert.equal(e.ses.check(),false);
 e.ses.request({url:'file:///tmp/x'},v=>decision=v);assert.equal(decision.cancel,true);e.ses.request({url:'app://workbench/index.html'},v=>decision=v);assert.equal(decision.cancel,true);
 await w.clear();assert.equal(e.windows[0].dead,true);assert.equal(e.ses.cleared,true);
});
test('native account navigation and popups keep the same unprivileged boundaries',async()=>{
 const e=fakeElectron(),w=new AccountWindow(e);await w.create();const win=e.windows[0];let blocked=false;
 win.webContents.emit('will-navigate',{preventDefault:()=>{blocked=true;}},'https://attacker.invalid');assert.equal(blocked,true);
 assert.equal(win.popup({url:'file:///tmp'}).action,'deny');const allowed=win.popup({url:'https://accounts.google.com/'});assert.equal(allowed.action,'allow');assert.equal(allowed.overrideBrowserWindowOptions.webPreferences.preload,undefined);assert.equal(allowed.overrideBrowserWindowOptions.webPreferences.nodeIntegration,false);
 await w.clear();
});
test('native session scripts are not evaluated outside the exact Tinfoil origin',async()=>{
 const e=fakeElectron(),w=new AccountWindow(e);await w.create();let calls=0;e.windows[0].webContents.executeJavaScript=async()=>{calls++;return raw();};
 e.windows[0].url='https://accounts.google.com';assert.equal(await w.script(sessionScript()),null);assert.equal(calls,0);await w.clear();
});
test('closing sign-in rejects it and cannot report a synthetic successful identity',async()=>{
 const e=fakeElectron(),w=new AccountWindow(e);await w.create();e.windows[0].webContents.executeJavaScript=async()=>null;const login=w.login();e.windows[0].emit('close',{preventDefault(){}});await assert.rejects(login,/cancelled/);await w.clear();
});

async function serviceFixture(){
 const saved=[],made=[],requests=[];const f=fixture();await f.account.login();const client={ready:async()=>{},getVerificationDocument:async()=>({securityVerified:true,steps:{}}),models:{list:async()=>({data:[{id:'model'}]})},chat:{completions:{create:async(body)=>{requests.push(body);return(async function*(){yield {choices:[{delta:{content:'Answer'},finish_reason:'stop'}]};})();}}}};
 const service=new WorkbenchService({read:async()=>null,write:async w=>{validateWorkspace(w);saved.push(structuredClone(w));},flush:async()=>{}},async(key,cache,mode)=>{made.push([key,cache,mode]);return client;},()=>{},null,{account:f.account});await service.initialize();service.workspace.threads[0].settings.model='model';service.workspace.threads[0].settings.visualTools=false;
 return{service,saved,made,requests,client,account:f.account};
}
const finish=async s=>{while(s.tasks.size)await Promise.all([...s.tasks]);};
test('account mode uses subscription credentials while the saved developer key remains separate',async t=>{
 const f=await serviceFixture(),s=f.service;t.after(()=>s.shutdown());s.workspace.apiKey='developer-key';await s.execute({type:'connection.mode',mode:'chat-account'});
 await s.execute({type:'send',id:s.workspace.activeId,text:'Hello',attachments:[]});await finish(s);
 assert.equal(f.made[0][0],'inference-secret');assert.equal(f.made[0][2],'chat-account');assert.equal(s.workspace.apiKey,'developer-key');assert.equal(s.workspace.threads[0].connectionOwner,'chat:user_test');
 assert.equal(f.requests[0].messages.some(m=>m.role==='system'),false);assert.equal(JSON.stringify(f.saved).includes('inference-secret'),false);assert.equal(JSON.stringify(s.snapshot()).includes('developer-key'),false);
});
test('signed-out account mode never falls back to a saved developer key',async t=>{
 const f=await serviceFixture(),s=f.service;t.after(()=>s.shutdown());s.workspace.apiKey='developer-key';await s.execute({type:'connection.mode',mode:'chat-account'});await f.account.signOut();
 await assert.rejects(s.execute({type:'send',id:s.workspace.activeId,text:'Hello',attachments:[]}),/Sign in/);assert.equal(f.made.length,0);
});
test('existing threads require native-scoped authorization after a connection change',async t=>{
 const f=await serviceFixture(),s=f.service;t.after(()=>s.shutdown());s.workspace.apiKey='developer-key';await s.execute({type:'send',id:s.workspace.activeId,text:'Hello',attachments:[]});await finish(s);
 await s.execute({type:'connection.mode',mode:'chat-account'});await assert.rejects(s.execute({type:'send',id:s.workspace.activeId,text:'More',attachments:[]}),/allow this existing thread/);
 assert.equal(f.requests.length,1);await assert.rejects(s.execute({type:'thread.authorize-account',id:s.workspace.activeId}),/Unsupported/);
 await s.authorizeThread(s.workspace.activeId);assert.equal(f.requests.length,1);await s.execute({type:'send',id:s.workspace.activeId,text:'More',attachments:[]});await finish(s);assert.equal(f.requests.length,2);
});
test('binding survives branches but cannot be imported as a forged approval or leak in an export',()=>{
 const w=newWorkspace(),t=w.threads[0];t.settings.model='fixture';beginTurn(t,'Hi',[]);const r=t.turns[0].replies[0];r.status='complete';r.content='Hello';t.connectionOwner='chat:user_private';
 const branch=forkThread(w,t.id,t.turns[0].id,false);assert.equal(branch.connectionOwner,t.connectionOwner);assert.equal(exportThread(t).includes('user_private'),false);
 const exported=JSON.parse(exportThread(t));exported.conversation.connectionOwner='chat:user_forged';assert.equal(importThread(w,exported).connectionOwner,undefined);
});
test('account mode migration preserves old workspaces without requiring a system prompt or login',()=>{
 const w=newWorkspace();const v=validateWorkspace(w);assert.equal(v.connectionMode,undefined);assert.equal(v.threads[0].settings.systemPrompt,'');assert.throws(()=>validateWorkspace({...w,connectionMode:'fallback'}),/connection mode/);
});


test('identity IDs are rejected rather than trimmed or truncated into another identity',()=>{
 for(const id of [' user_test','user_test\x00','user_'+ 'a'.repeat(200)])assert.equal(normalizeProfile({...raw().profile,id}),null);
});
test('lost session response invalidates a cached key even if the adapter does not signal it',async()=>{
 const f=fixture();await f.account.login();f.set(null);await assert.rejects(f.account.getCredential(),/session is unavailable/);assert.equal(f.account.key,null);assert.equal(f.account.snapshot().status,'expired');
});
test('inference authorization failure requires reconnect without retrying or blaming a saved API key',async t=>{
 const f=await serviceFixture(),s=f.service;t.after(()=>s.shutdown());s.workspace.apiKey='developer-key';await s.execute({type:'connection.mode',mode:'chat-account'});let requests=0;
 f.client.chat.completions.create=async()=>{requests++;throw Object.assign(new Error('raw-secret'),{status:401});};
 await s.execute({type:'send',id:s.workspace.activeId,text:'Hello',attachments:[]});await finish(s);
 const reply=s.workspace.threads[0].turns[0].replies[0];assert.equal(reply.status,'error');assert.match(reply.error,/Reconnect in Account/);assert.equal(reply.error.includes('raw-secret'),false);assert.equal(requests,1);assert.equal(f.account.snapshot().status,'expired');assert.equal(s.client,null);assert.equal(s.clientCredential,null);
});
test('account usage and billing errors do not claim developer API credit is required',async t=>{
 const f=await serviceFixture(),s=f.service;t.after(()=>s.shutdown());await s.execute({type:'connection.mode',mode:'chat-account'});
 assert.match(s.connectionError({status:402}).message,/Chat subscription/);assert.match(s.connectionError({status:429}).message,/Chat usage limit/);assert.equal(s.connectionError({status:500}).status,500);
});

test('a new sign-in waits for the old temporary browser partition to finish clearing',async()=>{
 const f=fixture();await f.account.login();let finishClear,logins=0;
 f.adapter.clear=()=>new Promise(resolve=>{finishClear=resolve;});f.adapter.login=async()=>{logins++;return raw();};
 const exiting=f.account.signOut();await new Promise(r=>setImmediate(r));const entering=f.account.login();
 await new Promise(r=>setImmediate(r));assert.equal(logins,0);assert.equal(f.account.snapshot().status,'signed-out');
 finishClear();await exiting;await entering;assert.equal(logins,1);assert.equal(f.account.snapshot().status,'signed-in');
});
