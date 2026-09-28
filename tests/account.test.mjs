import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { EventEmitter } from 'node:events';
import { AccountSession, TIMING } from '../desktop/account-session.mjs';
import { AccountWindow,sessionScript,identityScript,signInScript } from '../desktop/account-window.mjs';
import { normalizeProfile,normalizeUsage,authOrigin,allowedAccountNavigation,utcTimestamp,CHAT_TOKEN_URL,signedOutAccount } from '../dist/core/account.js';
import { InputError,validateWorkspace } from '../dist/core/validation.js';
import { newWorkspace,buildHistory,beginTurn,forkThread,exportThread,importThread } from '../dist/core/workspace.js';
import { WorkbenchService } from '../desktop/service.mjs';
const T0=Date.parse('2026-09-28T12:00:00Z');
const now=()=>T0;
const at=ms=>new Date(ms).toISOString().replace('.000Z','Z');
const raw=(id='user_test',sid='sess_test')=>({sessionUserId:id,sessionId:sid,bearer:'clerk-secret',profile:{id,name:'Example User',email:'example@example.invalid',emailVerified:true,subscriptionStatus:'active',subscriptionExpiresAt:'2026-10-28T12:00:00Z'}});
const body=()=>({key:'inference-secret',expires_at:'2026-09-28T13:00:00Z',rate_limit:{max_input_tokens:1000,input_tokens_used:100,input_tokens_remaining:900,max_output_tokens:200,output_tokens_used:50,output_tokens_remaining:150,resets_at:'2026-09-28T12:30:00Z'}});
const response=(status=200,b=body(),headers={})=>new Response(JSON.stringify(b),{status,headers:{'content-type':'application/json',...headers}});
const tick=()=>new Promise(r=>setImmediate(r));
// Bounded, so a regression fails the test instead of hanging the runner.
const until=async(ready,label)=>{for(let i=0;i<5000&&!ready();i++)await tick();assert.ok(ready(),'timed out waiting for '+label);};
function fixture(fetcher=async()=>response(),options={}){
  let source=raw(),clock=T0;const requests=[],reads=[],checks=[],events=[];let cleared=0;
  const adapter={login:async()=>source,readSession:async(force,expected)=>{reads.push([force,expected]);return source;},
    identity:async expected=>{checks.push(expected);return source&&{sessionUserId:source.sessionUserId,sessionId:source.sessionId};},
    manage:async expected=>{assert.equal(expected.user,source.profile.id);},clear:async()=>{cleared++;}};
  const account=new AccountSession(adapter,s=>{events.push(s);options.onChange?.(s);},{now:()=>clock,timing:options.timing,fetcher:async(url,init)=>{requests.push([url,init]);return fetcher(url,init,clock);}});
  return {account,adapter,requests,reads,checks,events,set:v=>source=v,tick:ms=>{clock+=ms;},get clock(){return clock;},get cleared(){return cleared;}};
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
test('token times need an explicit UTC designator or offset; zone-less times would be read as local time',()=>{
 assert.equal(utcTimestamp('2026-09-28T12:16:33Z'),Date.parse('2026-09-28T12:16:33Z'));assert.equal(utcTimestamp('2026-09-28T13:16:33.123456+01:00'),Date.parse('2026-09-28T12:16:33.123Z'));
 for(const v of ['2026-09-28T12:16:33','2026-09-28','Mon, 28 Sep 2026 12:16:33 GMT','1790597793',1790597793,null,'2026-09-28T12:16:33Z '+'x'.repeat(40)])assert.equal(utcTimestamp(v),null);
 assert.equal(normalizeUsage({resets_at:'2026-09-28T12:30:00'}).resetsAt,null);
});
test('account origins reject credential URLs, lookalikes, non-HTTPS and nonstandard ports',()=>{
 for(const u of ['http://chat.tinfoil.sh','https://chat.tinfoil.sh.evil.test','https://evil.test/chat.tinfoil.sh','https://user@chat.tinfoil.sh','https://chat.tinfoil.sh:8443','file:///index.html','app://workbench/index.html','javascript:alert(1)']){assert.equal(authOrigin(u),false);assert.equal(allowedAccountNavigation(u),false);}
 assert.equal(authOrigin('https://chat.tinfoil.sh/'),true);assert.equal(allowedAccountNavigation('https://accounts.google.com/o/oauth2'),true);assert.equal(authOrigin('https://accounts.google.com'),false);
});
test('blank optional system prompts are omitted; supplied instructions remain user-controlled',()=>{
 const w=newWorkspace(),t=w.threads[0];assert.equal(t.settings.systemPrompt,'');assert.deepEqual(buildHistory(t),[]);
 t.settings.systemPrompt='   ';assert.deepEqual(buildHistory(t),[]);t.settings.systemPrompt='Use complete sentences.';assert.deepEqual(buildHistory(t),[{role:'system',content:'Use complete sentences.'}]);
});
const clerkUser=()=>({...raw().profile,firstName:'Example',lastName:'User',primaryEmailAddress:{emailAddress:'example@example.invalid',verification:{status:'verified'}},publicMetadata:{chat_subscription_status:'active'},reload:async()=>{}});
test('session script uses Clerk getToken and reload only on demand, with an exact origin check',async()=>{
 let reloads=0,calls=[];const user={...clerkUser(),reload:async()=>{reloads++;}};
 const clerk={loaded:true,user,session:{id:'sess_test',status:'active',user,getToken:async opts=>{calls.push(opts);return 'session-secret';}}};
 const ctx={location:{origin:'https://chat.tinfoil.sh'},window:{Clerk:clerk}},expected={user:'user_test',session:'sess_test'};
 const r=await vm.runInNewContext(sessionScript(false,expected),ctx);assert.equal(r.profile.name,'Example User');assert.equal(r.bearer,'session-secret');assert.equal(r.sessionId,'sess_test');assert.equal(reloads,0);assert.equal(calls[0].skipCache,false);
 await vm.runInNewContext(sessionScript(true,expected),ctx);assert.equal(reloads,1);assert.equal(calls[1].skipCache,true);
 ctx.location.origin='https://attacker.invalid';assert.equal(await vm.runInNewContext(sessionScript(),ctx),null);assert.equal(calls.length,2);
});
test('session script detects user changes both before and during token retrieval',async()=>{
 let calls=0;const user={id:'user_old'},clerk={loaded:true,user,session:{id:'sess_old',user,getToken:async()=>{calls++;clerk.user={id:'user_new'};return 'should-not-escape';}}};
 const ctx={location:{origin:'https://chat.tinfoil.sh'},window:{Clerk:clerk}};
 assert.equal((await vm.runInNewContext(sessionScript(false,{user:'user_other',session:'sess_old'}),ctx)).changed,'user');assert.equal(calls,0);
 const out=await vm.runInNewContext(sessionScript(false,{user:'user_old',session:'sess_old'}),ctx);assert.equal(out.changed,'user');assert.equal(out.bearer,undefined);
});
test('session script refuses another or inactive Clerk session, and a session replaced during token retrieval',async()=>{
 let calls=0;const user={id:'user_test'},clerk={loaded:true,user,session:{id:'sess_test',status:'active',user,getToken:async()=>{calls++;clerk.session={id:'sess_new',status:'active',user};return 'should-not-escape';}}};
 const ctx={location:{origin:'https://chat.tinfoil.sh'},window:{Clerk:clerk}};
 assert.equal((await vm.runInNewContext(sessionScript(false,{user:'user_test',session:'sess_other'}),ctx)).changed,'session');assert.equal(calls,0);
 clerk.session.status='ended';assert.equal((await vm.runInNewContext(sessionScript(false,{user:'user_test',session:'sess_test'}),ctx)).signedOut,true);assert.equal(calls,0);
 clerk.loaded=false;assert.equal(await vm.runInNewContext(sessionScript(false,{user:'user_test',session:'sess_test'}),ctx),null);clerk.loaded=true;
 clerk.session.status='active';const out=await vm.runInNewContext(sessionScript(false,{user:'user_test',session:'sess_test'}),ctx);assert.equal(out.changed,'session');assert.equal(out.bearer,undefined);
});
test('identity script reports the current user and session only on the exact origin',()=>{
 const user={id:'user_test'},ctx={location:{origin:'https://chat.tinfoil.sh'},window:{Clerk:{loaded:true,user,session:{id:'sess_test',user}}}},expected={user:'user_test',session:'sess_test'};
 assert.deepEqual({...vm.runInNewContext(identityScript(expected),ctx)},{sessionUserId:'user_test',sessionId:'sess_test'});
 ctx.window.Clerk.session={id:'sess_new',user};assert.equal(vm.runInNewContext(identityScript(expected),ctx).changed,'session');
 ctx.window.Clerk.user={id:'user_new'};assert.equal(vm.runInNewContext(identityScript(expected),ctx).changed,'user');
 ctx.location.origin='https://attacker.invalid';assert.equal(vm.runInNewContext(identityScript(expected),ctx),null);
});
test('sign-in script uses provider UI without password or token input fields',()=>{
 let calls=0;const ctx={location:{origin:'https://chat.tinfoil.sh'},window:{Clerk:{loaded:true,user:null,openSignIn:()=>{calls++;}}}};
 assert.equal(vm.runInNewContext(signInScript,ctx),true);assert.equal(calls,1);ctx.location.origin='https://attacker.invalid';assert.equal(vm.runInNewContext(signInScript,ctx),false);assert.equal(calls,1);
});
test('login exchanges at the fixed endpoint and never puts credentials in snapshots',async()=>{
 const f=fixture();await f.account.login();assert.equal(f.account.snapshot().status,'signed-in');assert.equal(f.account.snapshot().entitlement,'active');
 assert.equal(f.requests[0][0],CHAT_TOKEN_URL);assert.equal(f.requests[0][1].redirect,'error');assert.equal(f.requests[0][1].cache,'no-store');assert.equal(f.requests[0][1].headers.Authorization,'Bearer clerk-secret');
 assert.deepEqual(f.checks,[{user:'user_test',session:'sess_test'}]);
 const all=JSON.stringify(f.events);assert.equal(all.includes('clerk-secret'),false);assert.equal(all.includes('inference-secret'),false);assert.equal(all.includes('bearer'),false);
 assert.equal(f.account.snapshot().usage.remaining,null);assert.equal(f.account.snapshot().tokenExpiresAt,Date.parse('2026-09-28T13:00:00Z'));
});
test('cached inference token still checks the current identity before reuse',async()=>{
 const f=fixture();await f.account.login();const c=await f.account.getCredential();assert.equal(c.key,'inference-secret');assert.equal(f.requests.length,1);assert.equal(f.reads.length,2);
});
test('concurrent credential requests share one session check and one exchange, bound to one account and session',async()=>{
 let n=0;const f=fixture(async(_u,_i,clock)=>response(200,{key:'key-'+(++n),expires_at:at(clock+15*60_000)}));await f.account.login();f.tick(14*60_000+30_000);
 const results=await Promise.all([f.account.getCredential(),f.account.getCredential(),f.account.getCredential()]);
 assert.equal(f.requests.length,2);assert.equal(f.reads.length,2);assert.equal(f.checks.length,2);
 for(const r of results)assert.deepEqual({key:r.key,owner:r.owner,session:r.session},{key:'key-2',owner:'user_test',session:'sess_test'});
});
test('expiry refresh mints a new credential instead of retaining it indefinitely',async()=>{
 let n=0;const f=fixture(async(_u,_i,clock)=>response(200,{...body(),key:'credential-'+(++n),expires_at:at(clock+15*60_000)}));await f.account.login();
 f.tick(14*60_000);assert.equal((await f.account.getCredential()).key,'credential-2');assert.equal(f.requests.length,2);
 f.tick(13*60_000);assert.equal((await f.account.getCredential()).key,'credential-2');assert.equal(f.requests.length,2);
 assert.equal(f.account.snapshot().tokenExpiresAt,T0+29*60_000);
});
test('a key close to expiry is used once; a cached key is reused only with more than 60 seconds left',async()=>{
 let n=0;const f=fixture(async(_u,_i,clock)=>{n++;return response(200,{key:'key-'+n,expires_at:at(clock+(n===1?45_000:15*60_000))});});
 await f.account.login();assert.equal(f.account.key,'key-1');assert.equal(f.account.snapshot().entitlement,'active');
 assert.equal((await f.account.getCredential()).key,'key-2');assert.equal(f.requests.length,2);
 f.tick(13*60_000);assert.equal((await f.account.getCredential()).key,'key-2');assert.equal(f.requests.length,2);
 f.tick(60_000);assert.equal((await f.account.getCredential()).key,'key-3');assert.equal(f.requests.length,3);
});
test('a missing, malformed, zone-less, expired or too-short expiry is refused and the key is never used',async()=>{
 for(const expires_at of [undefined,'soon',1790597793,'2026-09-28T12:15:00','2026-09-28T11:59:59Z','2026-09-28T12:00:20Z']){
  const f=fixture(async()=>response(200,{key:'inference-secret',...(expires_at===undefined?{}:{expires_at})}));await f.account.login();
  const s=f.account.snapshot();assert.equal(s.status,'signed-in');assert.equal(s.entitlement,'unknown');assert.equal(f.account.key,null);assert.equal(s.tokenExpiresAt,null);
  assert.match(s.message,/expiry time|expired account token|expires too soon/);assert.equal(f.checks.length,0);
  await assert.rejects(f.account.getCredential(),/expiry time|expired account token|expires too soon/);assert.equal(f.account.key,null);
 }
});
test('key lifetime follows the server Date header when the local clock is wrong',async()=>{
 const date={date:'Mon, 28 Sep 2026 12:00:00 GMT'};
 // Local clock 20 minutes fast: by local time this key already expired.
 const fast=fixture(async()=>response(200,{key:'fast',expires_at:'2026-09-28T12:15:00Z'},date));fast.tick(20*60_000);await fast.account.login();assert.equal(fast.account.key,'fast');
 fast.tick(13*60_000);await fast.account.getCredential();assert.equal(fast.requests.length,1);
 fast.tick(90_000);await fast.account.getCredential();assert.equal(fast.requests.length,2);
 // Local clock 20 minutes slow: the key is renewed before its real expiry, not 20 minutes later.
 const slow=fixture(async()=>response(200,{key:'slow',expires_at:'2026-09-28T12:15:00Z'},date));slow.tick(-20*60_000);await slow.account.login();
 slow.tick(14*60_000+30_000);await slow.account.getCredential();assert.equal(slow.requests.length,2);
 // Without a Date header the local clock is trusted, and a fast clock refuses the key as expired.
 const local=fixture(async()=>response(200,{key:'local',expires_at:'2026-09-28T12:15:00Z'}));local.tick(20*60_000);await local.account.login();assert.equal(local.account.key,null);assert.match(local.account.snapshot().message,/expired/);
});
test('401 authorizes exactly one identity refresh, not an inference retry',async()=>{
 let n=0;const f=fixture(async()=>++n===1?response(401,{error:'no'}):response());await f.account.login();assert.equal(f.requests.length,2);assert.deepEqual(f.reads.map(x=>x[0]),[true,true]);assert.equal(f.account.snapshot().entitlement,'active');
});
test('repeated authorization rejection expires session without raw server secrets',async()=>{
 const f=fixture(async()=>response(401,{error:'leak: clerk-secret'}));await f.account.login();assert.equal(f.requests.length,2);assert.equal(f.account.snapshot().status,'expired');assert.equal(JSON.stringify(f.events).includes('clerk-secret'),false);await assert.rejects(f.account.getCredential(),/Sign in/);
});
test('403 clears access and asks for a new sign-in without a second exchange',async()=>{
 const f=fixture(async()=>response(403,{error:'forbidden'}));await f.account.login();assert.equal(f.requests.length,1);assert.equal(f.account.snapshot().status,'expired');assert.equal(f.account.key,null);
});
test('402 keeps identity separate from entitlement and never requests a free or API key',async()=>{
 const f=fixture(async()=>response(402,{error:'subscription'}));await f.account.login();assert.equal(f.account.snapshot().status,'signed-in');assert.equal(f.account.snapshot().entitlement,'subscription-required');assert.equal(f.account.key,null);assert.deepEqual(f.requests.map(x=>x[0]),[CHAT_TOKEN_URL]);
});
test('429 records real reset budgets and blocks repeated minting until reset',async()=>{
 const f=fixture(async()=>response(429,{rate_limit:body().rate_limit,resets_at:'2026-09-28T12:30:00Z'}));await f.account.login();assert.equal(f.account.snapshot().entitlement,'rate-limited');
 await assert.rejects(f.account.getCredential(),/usage limit/);assert.equal(f.requests.length,1);assert.equal(f.account.snapshot().usage.resetsAt,now()+1800000);
});
test('a usage limit waits for the reported reset, then Retry-After, and a missing, past, zone-less or distant time stays bounded',async()=>{
 const date='Mon, 28 Sep 2026 12:00:00 GMT';
 for(const [headers,extra,wait] of [
  [{date},{resets_at:'2026-09-28T12:10:00Z'},600_000],
  [{date},{rate_limit:{resets_at:'2026-09-28T12:02:00Z'}},120_000],
  [{'retry-after':'120',date},{resets_at:'2026-09-28T12:10:00Z'},600_000],
  [{'retry-after':'120'},{},120_000],
  [{'retry-after':'Mon, 28 Sep 2026 12:05:00 GMT',date},{},300_000],
  [{'retry-after':'90'},{resets_at:'2026-09-28T11:00:00Z'},90_000],
  [{},{},TIMING.cooldown],
  [{},{resets_at:'2026-09-28T11:00:00Z'},TIMING.cooldown],
  [{},{resets_at:'2026-09-28T12:00:02Z'},TIMING.minimumCooldown],
  [{},{resets_at:'2026-09-28T12:10:00'},TIMING.cooldown],
  [{},{resets_at:'2026-10-05T12:00:00Z'},TIMING.maximumCooldown],
  [{date:'Mon, 28 Sep 2026 11:40:00 GMT'},{resets_at:'2026-09-28T11:50:00Z'},600_000],
 ]){
  const f=fixture(async()=>response(429,{rate_limit:{},...extra},headers));await f.account.login();
  f.tick(wait-1000);await assert.rejects(f.account.getCredential(),/usage limit/);assert.equal(f.requests.length,1,JSON.stringify(headers)+JSON.stringify(extra));
  f.tick(1000);await assert.rejects(f.account.getCredential(),/usage limit/);assert.equal(f.requests.length,2,JSON.stringify(headers)+JSON.stringify(extra));
 }
});
test('an hourly-limit code is a usage limit even on another status, never a session rejection',async()=>{
 const f=fixture(async()=>response(403,{code:'HOURLY_LIMIT_REACHED',error:'limit',resets_at:'2026-09-28T12:20:00Z'}));await f.account.login();
 assert.equal(f.account.snapshot().status,'signed-in');assert.equal(f.account.snapshot().entitlement,'rate-limited');assert.equal(f.requests.length,1);
 f.tick(19*60_000);await assert.rejects(f.account.getCredential(),/usage limit/);assert.equal(f.requests.length,1);
});
test('during a cooldown, concurrent requests send nothing and explicit refreshes stay spaced',async()=>{
 const f=fixture(async()=>response(429,{rate_limit:{}},{'retry-after':'3600'}));await f.account.login();
 await Promise.allSettled([f.account.getCredential(),f.account.getCredential(),f.account.getCredential()]);assert.equal(f.requests.length,1);
 f.tick(10_000);await f.account.refresh();assert.equal(f.requests.length,1);
 f.tick(20_000);await f.account.refresh();assert.equal(f.requests.length,2);
 f.tick(10_000);await assert.rejects(f.account.getCredential(),/usage limit/);await f.account.refresh();assert.equal(f.requests.length,2);
});
test('malformed token and oversized responses cannot authenticate',async()=>{
 for(const b of [{key:'contains whitespace',expires_at:'2026-09-28T13:00:00Z'}, {foo:'none'}, {key:'x'.repeat(70000),expires_at:'2026-09-28T13:00:00Z'}]){
  const f=fixture(async()=>response(200,b));await f.account.login();assert.notEqual(f.account.snapshot().entitlement,'active');assert.equal(f.account.key,null);
 }
});
test('untrusted transport failures are replaced by a nonsecret message',async()=>{
 const f=fixture(async()=>{throw new Error('private https://foo/?clerk-secret');});await f.account.login();assert.equal(JSON.stringify(f.events).includes('clerk-secret'),false);assert.equal(f.account.key,null);
 assert.match(f.account.snapshot().message,/account access failed/);assert.equal(f.account.snapshot().status,'signed-in');
});
test('a hung token exchange times out and never becomes access',async()=>{
 const f=fixture((_url,init)=>new Promise((_,reject)=>init.signal.addEventListener('abort',()=>reject(new DOMException('aborted','AbortError')))),{timing:{...TIMING,timeout:20}});
 await f.account.login();assert.equal(f.account.key,null);assert.equal(f.account.snapshot().entitlement,'unknown');assert.match(f.account.snapshot().message,/account access failed/);
});
test('changing user after sign-in revokes cached credentials before any further fetch',async()=>{
 const f=fixture();await f.account.login();f.set(raw('user_other'));await assert.rejects(f.account.getCredential(),/account changed/);assert.equal(f.requests.length,1);assert.equal(f.account.snapshot().status,'expired');assert.equal(f.account.key,null);
});
test('the Clerk session is bound at sign-in; another session for the same user is refused before any exchange',async()=>{
 const f=fixture();await f.account.login();f.set(raw('user_test','sess_other'));await assert.rejects(f.account.getCredential(),/session changed/);assert.equal(f.requests.length,1);assert.equal(f.account.snapshot().status,'expired');assert.equal(f.account.key,null);
});
test('a user or session change while the exchange is in flight discards its result',async()=>{
 for(const next of [raw('user_test','sess_new'),raw('user_other','sess_other')]){
  let n=0,f;f=fixture(async()=>{if(++n===2)f.set(next);return response();});await f.account.login();f.tick(59*60_000);
  await assert.rejects(f.account.getCredential(),/changed/);assert.equal(f.requests.length,2);assert.equal(f.account.key,null);assert.equal(f.account.snapshot().status,'expired');
 }
});
test('mismatched Clerk user and session owner cannot authenticate',async()=>{
 const f=fixture();f.set({...raw(),sessionUserId:'user_other'});await f.account.login();assert.equal(f.requests.length,0);assert.equal(f.account.snapshot().status,'error');
});
test('a session read without a Clerk session ID cannot sign in',async()=>{
 for(const sessionId of [undefined,'','user_test','sess_bad id']){
  const f=fixture();f.set({...raw(),sessionId});await f.account.login();assert.equal(f.requests.length,0);assert.equal(f.account.snapshot().status,'error');
 }
});
test('sign-out clears session state, and late token responses cannot restore it',async()=>{
 let release;const pending=new Promise(r=>release=r);const f=fixture(async()=>pending);const login=f.account.login();
 await until(()=>f.requests.length,'the exchange');await f.account.signOut();release(response());await login;
 assert.deepEqual(f.account.snapshot(),signedOutAccount());assert.equal(f.account.key,null);assert.equal(f.cleared,1);
});
test('resume drops an expired cached key without a network request',async()=>{
 const f=fixture();await f.account.login();f.account.resume();assert.equal(f.account.key,'inference-secret');
 f.tick(59*60_000);f.account.resume();assert.equal(f.account.key,null);assert.equal(f.account.snapshot().tokenExpiresAt,null);assert.equal(f.account.snapshot().status,'signed-in');assert.equal(f.requests.length,1);
});
test('profile management calls the provider adapter only while signed in',async()=>{
 const f=fixture();await assert.rejects(f.account.manage(),/Sign in/);await f.account.login();await f.account.manage();await f.account.signOut();assert.equal(f.account.snapshot().profile,null);
});

function fakeElectron(){
 const windows=[],partitions=[];let currentSession;
 class Window extends EventEmitter{
  constructor(opts){super();this.opts=opts;this.dead=false;this.webContents=new EventEmitter();this.webContents.getURL=()=>this.url??'';this.webContents.executeJavaScript=async()=>raw();this.webContents.isLoading=()=>!!this.loading;this.webContents.setWindowOpenHandler=fn=>this.popup=fn;windows.push(this);}
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
 const e=fakeElectron(),refused=[],w=new AccountWindow(e,()=>{},host=>refused.push(host));await w.create();const win=e.windows[0];let blocked=false;
 win.webContents.emit('will-navigate',{preventDefault:()=>{blocked=true;}},'https://attacker.invalid/path?code=secret');assert.equal(blocked,true);assert.deepEqual(refused,['attacker.invalid']);
 assert.equal(win.popup({url:'file:///tmp'}).action,'deny');assert.deepEqual(refused,['attacker.invalid','']);const allowed=win.popup({url:'https://accounts.google.com/'});assert.equal(allowed.action,'allow');assert.equal(allowed.overrideBrowserWindowOptions.webPreferences.preload,undefined);assert.equal(allowed.overrideBrowserWindowOptions.webPreferences.nodeIntegration,false);
 await w.clear();
});
test('the host list governs the page, while a frame redirect cannot stall a provider sign-in',async()=>{
 const e=fakeElectron(),refused=[],w=new AccountWindow(e,()=>{},host=>refused.push(host));await w.create();const wc=e.windows[0].webContents;
 const redirect=(url,isMainFrame)=>{let blocked=false;wc.emit('will-redirect',{isMainFrame,url,preventDefault:()=>{blocked=true;}},url,false,isMainFrame);return blocked;};
 assert.equal(redirect('https://accounts.youtube.com/accounts/SetSID',false),false);assert.equal(redirect('https://clerk.tinfoil.sh/v1/oauth_callback',true),false);
 assert.equal(redirect('https://accounts.youtube.com/accounts/SetSID',true),true);assert.equal(redirect('https://attacker.invalid',undefined),true);
 assert.deepEqual(refused,['accounts.youtube.com','attacker.invalid']);await w.clear();
});
test('a refused sign-in host is shown as a message, with only a plain host name',async()=>{
 const f=fixture();f.account.blocked('accounts.youtube.com');assert.match(f.account.snapshot().message,/tried to open accounts\.youtube\.com/);
 f.account.blocked('<img src=x onerror=alert(1)>');assert.match(f.account.snapshot().message,/tried to open another site/);f.account.blocked('');assert.match(f.account.snapshot().message,/another site/);
});
test('native session scripts are not evaluated outside the exact Tinfoil origin',async()=>{
 const e=fakeElectron(),w=new AccountWindow(e);await w.create();let calls=0;e.windows[0].webContents.executeJavaScript=async()=>{calls++;return raw();};
 e.windows[0].url='https://accounts.google.com';assert.equal(await w.script(sessionScript()),null);assert.equal(calls,0);await w.clear();
});
test('native identity confirmation invalidates a changed session and reports only IDs',async()=>{
 const e=fakeElectron(),invalid=[],w=new AccountWindow(e,m=>invalid.push(m));await w.create();const expected={user:'user_test',session:'sess_test'};
 e.windows[0].webContents.executeJavaScript=async()=>({changed:'session'});await assert.rejects(w.identity(expected),/session changed/);assert.match(invalid[0],/session changed/);
 e.windows[0].webContents.executeJavaScript=async()=>({signedOut:true});await assert.rejects(w.identity(expected),/expired/);assert.equal(invalid.length,2);
 e.windows[0].webContents.executeJavaScript=async()=>({sessionUserId:'user_test',sessionId:'sess_test'});assert.deepEqual(await w.identity(expected),{sessionUserId:'user_test',sessionId:'sess_test'});
 await w.clear();
});
test('a page that is loading or not ready is waited for or refused, never treated as a sign-out',async()=>{
 const e=fakeElectron(),invalid=[],w=new AccountWindow(e,m=>invalid.push(m));await w.create();const win=e.windows[0],expected={user:'user_test',session:'sess_test'};
 let calls=0;win.webContents.executeJavaScript=async()=>{calls++;return {sessionUserId:'user_test',sessionId:'sess_test'};};
 win.loading=true;const pending=w.identity(expected);await tick();assert.equal(calls,0);
 win.loading=false;win.webContents.emit('did-stop-loading');assert.deepEqual(await pending,{sessionUserId:'user_test',sessionId:'sess_test'});assert.equal(calls,1);
 win.webContents.executeJavaScript=async()=>null;await assert.rejects(w.readSession(false,expected),/not ready/);await assert.rejects(w.identity(expected),/not ready/);
 win.url='https://accounts.google.com/';await assert.rejects(w.identity(expected),/not ready/);assert.deepEqual(invalid,[]);await w.clear();
});
test('sign-in is accepted only when two session reads a second apart agree',async()=>{
 const e=fakeElectron(),w=new AccountWindow(e);let reads=0;const sessions=[raw('user_test','sess_first'),raw('user_test','sess_final'),raw('user_test','sess_final')];
 const login=w.login();await until(()=>e.windows[0],'the sign-in window');
 e.windows[0].webContents.executeJavaScript=async source=>source.includes('openSignIn')?true:sessions[Math.min(reads++,2)];
 const value=await login;assert.equal(value.sessionId,'sess_final');assert.equal(reads,3);await w.clear();
});
test('closing sign-in rejects it and cannot report a synthetic successful identity',async()=>{
 const e=fakeElectron(),w=new AccountWindow(e);await w.create();e.windows[0].webContents.executeJavaScript=async()=>null;const login=w.login();e.windows[0].emit('close',{preventDefault(){}});await assert.rejects(login,/cancelled/);await w.clear();
});

const complete=()=>(async function*(){yield {choices:[{delta:{content:'Answer'},finish_reason:'stop'}]};})();
async function serviceFixture(fetcher){
 const saved=[],made=[],requests=[],snapshots=[];let service;
 const f=fixture(fetcher,{onChange:()=>service?.accountChanged()});await f.account.login();
 const api={verified:true,create:async()=>complete()};
 // One client per key, as the provider factory creates; `api` holds the behavior shared by all of them.
 const factory=async(key,cache,mode)=>{made.push([key,cache,mode]);return {ready:async()=>{},getVerificationDocument:async()=>({securityVerified:api.verified,steps:{}}),models:{list:async()=>({data:[{id:'model'}]})},
  chat:{completions:{create:async(body,opts)=>{requests.push(body);return api.create(body,opts,key);}}}};};
 service=new WorkbenchService({read:async()=>null,write:async w=>{validateWorkspace(w);saved.push(structuredClone(w));},flush:async()=>{}},factory,s=>snapshots.push(JSON.stringify(s)),null,{account:f.account});await service.initialize();service.workspace.threads[0].settings.model='model';service.workspace.threads[0].settings.visualTools=false;
 return{service,saved,made,requests,snapshots,api,account:f.account,f};
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
test('a request after expiry renews the key, verifies a new client, and keeps credentials out of snapshots and the vault',async t=>{
 let n=0;const f=await serviceFixture(async(_u,_i,clock)=>response(200,{...body(),key:'key-'+(++n),expires_at:at(clock+15*60_000)}));const s=f.service;t.after(()=>s.shutdown());
 await s.execute({type:'connection.mode',mode:'chat-account'});
 await s.execute({type:'send',id:s.workspace.activeId,text:'First',attachments:[]});await finish(s);const first=s.client;
 f.f.tick(16*60_000);await s.execute({type:'send',id:s.workspace.activeId,text:'Second',attachments:[]});await finish(s);
 assert.deepEqual(s.workspace.threads[0].turns.map(x=>x.replies[0].status),['complete','complete']);
 assert.deepEqual(f.made.map(m=>[m[0],m[2]]),[['key-1','chat-account'],['key-2','chat-account']]);assert.notEqual(s.client,first);assert.equal(f.f.requests.length,2);
 assert.equal(f.account.snapshot().tokenExpiresAt,T0+31*60_000);
 const durable=JSON.stringify([f.saved,f.snapshots,f.f.events,s.snapshot()]);for(const secret of ['key-1','key-2','clerk-secret'])assert.equal(durable.includes(secret),false,secret);
});
test('an unverified enclave stops a Chat request before any content is sent',async t=>{
 const f=await serviceFixture(),s=f.service;t.after(()=>s.shutdown());await s.execute({type:'connection.mode',mode:'chat-account'});f.api.verified=false;
 await s.execute({type:'send',id:s.workspace.activeId,text:'Hello',attachments:[]});await finish(s);
 assert.equal(s.workspace.threads[0].turns[0].replies[0].status,'error');assert.equal(f.requests.length,0);assert.equal(s.verification.state,'failed');
});
test('an unavailable token exchange keeps the billing mode and sends nothing',async t=>{
 for(const bad of [()=>response(503,{error:'down'}),()=>new Response('not json',{status:200}),()=>response(200,{key:'no-expiry-secret'}),()=>{throw new TypeError('fetch failed');}]){
  let n=0;const f=await serviceFixture(async()=>++n===1?response():bad()),s=f.service;t.after(()=>s.shutdown());s.workspace.apiKey='developer-key';
  await s.execute({type:'connection.mode',mode:'chat-account'});f.f.tick(59*60_000);
  await s.execute({type:'send',id:s.workspace.activeId,text:'Hello',attachments:[]});await finish(s);
  const reply=s.workspace.threads[0].turns[0].replies[0];assert.equal(reply.status,'error');assert.equal(f.requests.length,0);assert.equal(f.made.length,0);
  assert.equal(s.workspace.connectionMode,'chat-account');assert.equal(f.account.snapshot().status,'signed-in');assert.equal(JSON.stringify(s.workspace).includes('no-expiry-secret'),false);
 }
});
test('an inference rejection drops only that key and client, keeps partial output and the identity, and a later send renews without replay',async t=>{
 let n=0;const f=await serviceFixture(async()=>response(200,{...body(),key:'key-'+(++n)})),s=f.service;t.after(()=>s.shutdown());
 s.workspace.apiKey='developer-key';await s.execute({type:'connection.mode',mode:'chat-account'});
 f.api.create=async()=>(async function*(){yield {choices:[{delta:{content:'Partial'}}]};throw Object.assign(new Error('raw-secret'),{status:401});})();
 await s.execute({type:'send',id:s.workspace.activeId,text:'Hello',attachments:[]});await finish(s);
 const reply=s.workspace.threads[0].turns[0].replies[0];
 assert.equal(reply.status,'error');assert.equal(reply.content,'Partial');assert.match(reply.error,/rejected this request's Chat access token \(HTTP 401\)/);assert.equal(reply.error.includes('raw-secret'),false);
 assert.equal(f.requests.length,1);assert.equal(f.account.snapshot().status,'signed-in');assert.equal(f.account.key,null);assert.equal(s.client,null);assert.equal(s.clientCredential,null);
 f.api.create=async()=>complete();await s.execute({type:'thread.new'});await s.execute({type:'thread.settings',id:s.workspace.activeId,settings:{...s.workspace.threads.find(x=>x.id===s.workspace.activeId).settings,model:'model'}});
 await s.execute({type:'send',id:s.workspace.activeId,text:'Again',attachments:[]});await finish(s);
 assert.equal(s.workspace.threads.find(x=>x.id===s.workspace.activeId).turns[0].replies[0].status,'complete');assert.equal(f.requests.length,2);
 assert.deepEqual(f.made.map(m=>[m[0],m[2]]),[['key-1','chat-account'],['key-2','chat-account']]);assert.equal(s.workspace.apiKey,'developer-key');
});
test('a renewal between tool rounds replaces the client for that round only and never replays the other lane',async t=>{
 let n=0;const f=await serviceFixture(async(_u,_i,clock)=>response(200,{key:'key-'+(++n),expires_at:at(clock+15*60_000)}));const s=f.service;t.after(()=>s.shutdown());
 await s.execute({type:'connection.mode',mode:'chat-account'});const th=s.workspace.threads[0];th.settings={...th.settings,compare:true,compareModel:'model-b',visualTools:true};
 let releaseA;const gateA=new Promise(r=>releaseA=r),calls=[];
 f.api.create=async(body,_opts,key)=>{calls.push([body.model,key]);
  if(body.model==='model')return (async function*(){yield {choices:[{delta:{content:'A1 '}}]};await gateA;yield {choices:[{delta:{content:'A2'},finish_reason:'stop'}]};})();
  if(calls.filter(c=>c[0]==='model-b').length===1){f.f.tick(14*60_000);return (async function*(){yield {choices:[{delta:{tool_calls:[{index:0,id:'call_1',type:'function',function:{name:'not_offered',arguments:'{}'}}]},finish_reason:'tool_calls'}]};})();}
  return (async function*(){yield {choices:[{delta:{content:'B done'},finish_reason:'stop'}]};})();
 };
 await s.execute({type:'send',id:th.id,text:'Compare',attachments:[]});
 await until(()=>calls.length>=3,'the renewed round');releaseA();await finish(s);
 const [a,b]=s.workspace.threads[0].turns[0].replies;
 assert.deepEqual(calls,[['model','key-1'],['model-b','key-1'],['model-b','key-2']]);assert.equal(a.content,'A1 A2');assert.equal(a.status,'complete');assert.equal(b.status,'complete');
 assert.equal(f.f.requests.length,2);assert.deepEqual(f.made.map(m=>m[0]),['key-1','key-2']);
});
test('sign-out during a request-time renewal ignores the late response and sends nothing',async t=>{
 let release,n=0;const f=await serviceFixture(async()=>++n===1?response():new Promise(r=>release=r)),s=f.service;t.after(()=>s.shutdown());
 await s.execute({type:'connection.mode',mode:'chat-account'});f.f.tick(59*60_000);
 await s.execute({type:'send',id:s.workspace.activeId,text:'Hello',attachments:[]});
 await until(()=>release,'the renewal');await f.account.signOut();release(response(200,{...body(),key:'late-secret',expires_at:'2026-09-28T14:00:00Z'}));await finish(s);
 const reply=s.workspace.threads[0].turns[0].replies[0];
 assert.equal(f.requests.length,0);assert.equal(f.made.length,0);assert.equal(f.account.key,null);assert.deepEqual(f.account.snapshot(),signedOutAccount());assert.notEqual(reply.status,'complete');
 assert.equal(JSON.stringify([s.snapshot(),f.saved]).includes('late-secret'),false);assert.equal(s.workspace.connectionMode,'chat-account');
});
test('replacing the account during a renewal cannot deliver the old key, and old history needs approval',async t=>{
 let release,n=0;const f=await serviceFixture(async()=>{n++;if(n===2)return new Promise(r=>release=r);return response(200,{...body(),key:n===1?'first-secret':'replacement-secret'});}),s=f.service;t.after(()=>s.shutdown());
 await s.execute({type:'connection.mode',mode:'chat-account'});await s.execute({type:'send',id:s.workspace.activeId,text:'Hello',attachments:[]});await finish(s);
 f.f.tick(59*60_000);const pending=f.account.getCredential();await until(()=>release,'the renewal');
 await f.account.signOut();f.f.set(raw('user_b','sess_b'));await f.account.login();
 release(response(200,{...body(),key:'stale-secret',expires_at:'2026-09-28T14:00:00Z'}));await assert.rejects(pending,/cancelled/);
 assert.equal(f.account.key,'replacement-secret');assert.equal(f.account.snapshot().profile.id,'user_b');
 await assert.rejects(s.execute({type:'send',id:s.workspace.activeId,text:'More',attachments:[]}),/allow this existing thread/);
 assert.equal(f.requests.length,1);assert.equal(f.made.some(m=>m[0]==='stale-secret'),false);
});


test('identity IDs are rejected rather than trimmed or truncated into another identity',()=>{
 for(const id of [' user_test','user_test\x00','user_'+ 'a'.repeat(200)])assert.equal(normalizeProfile({...raw().profile,id}),null);
});
test('lost session response invalidates a cached key even if the adapter does not signal it',async()=>{
 const f=fixture();await f.account.login();f.set(null);await assert.rejects(f.account.getCredential(),/session is unavailable/);assert.equal(f.account.key,null);assert.equal(f.account.snapshot().status,'expired');
});
test('a Chat request refuses a client minted for another account',async t=>{
 const f=await serviceFixture(),s=f.service;t.after(()=>s.shutdown());await s.execute({type:'connection.mode',mode:'chat-account'});const other={};
 s.clients.set(other,{key:'other-secret',owner:'chat:user_other'});assert.throws(()=>s.bound(other,'chat:user_test'),/account changed/);
 s.clients.set(other,{key:'other-secret',owner:'chat:user_test'});assert.equal(s.bound(other,'chat:user_test'),other);
});
test('account usage and billing errors do not claim developer API credit is required',async t=>{
 const f=await serviceFixture(),s=f.service;t.after(()=>s.shutdown());await s.execute({type:'connection.mode',mode:'chat-account'});
 assert.match(s.connectionError({status:402}).message,/Chat subscription/);assert.match(s.connectionError({status:429}).message,/Chat usage limit/);assert.equal(s.connectionError({status:500}).status,500);
});

test('a new sign-in waits for the old temporary browser partition to finish clearing',async()=>{
 const f=fixture();await f.account.login();let finishClear,logins=0;
 f.adapter.clear=()=>new Promise(resolve=>{finishClear=resolve;});f.adapter.login=async()=>{logins++;return raw();};
 const exiting=f.account.signOut();await tick();const entering=f.account.login();
 await tick();assert.equal(logins,0);assert.equal(f.account.snapshot().status,'signed-out');
 finishClear();await exiting;await entering;assert.equal(logins,1);assert.equal(f.account.snapshot().status,'signed-in');
});
