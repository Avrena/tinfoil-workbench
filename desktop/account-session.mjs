import { signedOutAccount, normalizeProfile, normalizeUsage, utcTimestamp, CHAT_TOKEN_URL } from '../dist/core/account.js';
import { InputError } from '../dist/core/validation.js';

const secret = value => typeof value === 'string' && value.length > 0 && value.length <= 16384 && !/[\x00-\x20\x7f]/.test(value);
const sessionId = value => typeof value === 'string' && value.length <= 200 && /^sess_[A-Za-z0-9]+$/.test(value);
/** Request-time renewal rules, in milliseconds. Key lifetimes are measured on the server's clock. */
export const TIMING = Object.freeze({
  refreshMargin: 60_000,    // a cached Chat key is reused only while more than this remains
  minimumLifetime: 30_000,  // a new key that expires sooner than this is refused
  maximumReuse: 3_600_000,  // one key is never reused for longer than this, whatever its expiry
  cooldown: 60_000, minimumCooldown: 10_000, maximumCooldown: 3_600_000, // after a usage limit; budgets are hourly
  refreshSpacing: 30_000,   // between explicit refreshes during a cooldown
  timeout: 15_000, maxBytes: 65_536,
});
// An HTTP-date is always GMT. Retry-After is either an HTTP-date or a delay in seconds.
const httpDate = value => { if (typeof value !== 'string' || value.length > 40 || !/ GMT$/.test(value)) return null; const t = Date.parse(value); return Number.isFinite(t) ? t : null; };
function retryDelay(value, serverNow) {
  if (typeof value !== 'string') return null;
  const v = value.trim();
  if (/^\d{1,8}$/.test(v)) return Number(v) * 1000;
  const at = httpDate(v); return at === null ? null : at - serverNow;
}
/** Isolated, memory-only account credentials; this object is never serialized.
 * A key is renewed when a request needs one, not by a timer, so sleep or suspension cannot leave an expired key in use. */
export class AccountSession {
  constructor(adapter, onChange = () => {}, {fetcher=globalThis.fetch, now=Date.now, timing=TIMING} = {}) {
    this.adapter=adapter;this.onChange=onChange;this.fetcher=fetcher;this.now=now;this.timing=timing;
    this.state=signedOutAccount();this.binding=null;this.key=null;this.keyDeadline=0;this.cooldownUntil=0;this.lastAttempt=0;
    this.epoch=0;this.flight=null;this.abort=null;this.clearing=null;
  }
  snapshot(){return structuredClone(this.state);}
  emit(){this.onChange(this.snapshot());}
  forget(){this.key=null;this.keyDeadline=0;}
  invalidate(message='Your Tinfoil session expired. Sign in again.'){
    this.epoch++;this.abort?.abort();this.forget();this.binding=null;this.flight=null;
    this.state={...this.state,status:'expired',entitlement:'unknown',usage:null,tokenExpiresAt:null,message};this.emit();
  }
  /** Accepts a website session read. Sign-in binds its user and Clerk session; every later read must match both. */
  accept(raw, expected=null){
    const profile=normalizeProfile(raw?.profile);
    if(!profile || raw?.sessionUserId!==profile.id || !sessionId(raw?.sessionId) || !secret(raw?.bearer)){
      if(expected)this.invalidate('Your Tinfoil session is unavailable. Sign in again.');
      throw new InputError('Your Tinfoil session is unavailable. Sign in again.');
    }
    if(expected&&(profile.id!==expected.user||raw.sessionId!==expected.session)){
      this.invalidate(profile.id!==expected.user?'The website account changed. Sign out here and reconnect before sending.':'The website session changed. Sign out here and reconnect before sending.');
      throw new InputError(this.state.message);
    }
    if(!expected)this.binding={user:profile.id,session:raw.sessionId};
    this.state={...this.state,status:'signed-in',profile};return raw.bearer;
  }
  async login(){
    // Never reuse a browser partition that is still being cleared by sign-out.
    if(this.clearing)await this.clearing;
    if(this.state.status==='signing-in')throw new InputError('Sign-in is already open.');
    if(this.state.profile)throw new InputError('Sign out before connecting another account.');
    const epoch=++this.epoch;this.binding=null;this.forget();this.cooldownUntil=0;this.state={...signedOutAccount(),status:'signing-in'};this.emit();
    try{
      const raw=await this.adapter.login();if(epoch!==this.epoch)return;
      this.accept(raw);this.emit();
      // A signed-in identity is separate from Chat access. A failed access check is recorded in the
      // state and keeps the identity, so Refresh can try again; an invalidated session ends sign-in.
      try{await this.getCredential(true);}catch{}
    }catch(error){
      if(epoch!==this.epoch)return;
      this.forget();this.state={...this.state,status:this.state.profile?'expired':'error',tokenExpiresAt:null,message:error instanceof InputError?error.message:'Sign-in could not finish. Reopen Tinfoil sign-in and try again.'};this.emit();
    }
  }
  async refresh(){
    if(this.state.status!=='signed-in')throw new InputError('Sign in before refreshing your profile.');
    try{await this.getCredential(true);}catch(error){if(!['subscription-required','rate-limited'].includes(this.state.entitlement))throw error;}
  }
  credential(expected){return {key:this.key,owner:expected.user,session:expected.session,expiresAt:this.state.tokenExpiresAt};}
  async getCredential(force=false){
    if(this.state.status!=='signed-in'||!this.state.profile||!this.binding)throw new InputError('Sign in to Tinfoil Chat in Account first. No API-key fallback is used.');
    // Concurrent callers share one session read and at most one exchange for this sign-in.
    if(this.flight)return this.flight;
    const epoch=this.epoch,expected={...this.binding},t=this.timing;
    const promise=(async()=>{
      try{
        let bearer=this.accept(await this.adapter.readSession(force,expected),expected);this.assert(epoch);
        if(!force&&this.key&&this.keyDeadline-this.now()>t.refreshMargin)return this.credential(expected);
        const now=this.now();
        if(this.cooldownUntil>now&&(!force||now-this.lastAttempt<t.refreshSpacing))throw new InputError('Tinfoil reports a usage limit. Wait until the displayed reset time before sending again.');
        let response=await this.request(bearer,epoch);
        // Only refresh identity authorization once; never retry a generation.
        if(response.status===401){
          bearer=this.accept(await this.adapter.readSession(true,expected),expected);this.assert(epoch);response=await this.request(bearer,epoch);
        }
        this.assert(epoch);this.forget();
        this.state.checkedAt=this.now();this.state.tokenExpiresAt=null;
        // Tinfoil's own client treats either signal as the hourly usage limit, before any other status.
        if(response.status===429||(response.status!==200&&response.body?.code==='HOURLY_LIMIT_REACHED')){
          this.cooldownUntil=this.cooldown(response);this.state.entitlement='rate-limited';
          this.state.usage=normalizeUsage({...response.body?.rate_limit,resets_at:response.body?.resets_at??response.body?.rate_limit?.resets_at});
          this.state.message='Tinfoil reports a usage limit. Requests are not retried or switched to another billing mode.';this.emit();throw new InputError(this.state.message);
        }
        if(response.status===401||response.status===403){this.invalidate('Tinfoil rejected this session. Sign in again.');throw new InputError(this.state.message);}
        if(response.status===402){this.cooldownUntil=0;this.state.entitlement='subscription-required';this.state.usage=null;this.state.message='Tinfoil reports that a Chat subscription is required. API-key access is separate.';this.emit();throw new InputError(this.state.message);}
        if(response.status!==200)throw new InputError('Tinfoil account access could not be checked. Refresh when the service is available.');
        const key=response.body?.key;
        if(!secret(key))throw new InputError('Tinfoil returned an invalid account token response.');
        // The expiry must be an explicit UTC time. Its lifetime is taken from the server's Date header when
        // present, so a wrong local clock neither refuses a valid key nor reuses an expired one.
        const expiry=utcTimestamp(response.body.expires_at);
        if(expiry===null)throw new InputError('Tinfoil returned an account token without a valid expiry time. It was not used.');
        const lifetime=expiry-response.serverNow;
        if(lifetime<=0)throw new InputError('Tinfoil returned an expired account token. Refresh your session.');
        if(lifetime<t.minimumLifetime)throw new InputError('Tinfoil returned an account token that expires too soon to use. Refresh your session.');
        // The exchange took time: the same user and Clerk session must still own the page.
        await this.confirm(expected,epoch);
        this.key=key;this.keyDeadline=response.receivedAt+Math.min(lifetime,t.maximumReuse);this.cooldownUntil=0;
        this.state={...this.state,entitlement:'active',usage:normalizeUsage(response.body.rate_limit),tokenExpiresAt:expiry,message:null};this.emit();
        return this.credential(expected);
      }catch(error){
        if(epoch===this.epoch){this.forget();this.state.tokenExpiresAt=null;
          if(!['subscription-required','rate-limited'].includes(this.state.entitlement)){this.state.entitlement='unknown';this.state.usage=null;}
          if(!(error instanceof InputError))this.state.message='Tinfoil account access failed. Check your connection and sign-in session.';
          else this.state.message=error.message;
          this.emit();}
        throw error instanceof InputError?error:new InputError('Tinfoil account access failed. Check your connection and sign-in session.');
      }
    })();this.flight=promise;
    try{return await promise;}finally{if(this.flight===promise)this.flight=null;}
  }
  assert(epoch){if(epoch!==this.epoch)throw new InputError('The account operation was cancelled.');}
  async confirm(expected,epoch){
    const live=await this.adapter.identity(expected);this.assert(epoch);
    if(live?.sessionUserId!==expected.user||live?.sessionId!==expected.session){this.invalidate('The website session changed. Sign out here and reconnect before sending.');throw new InputError(this.state.message);}
  }
  /** After a usage limit, in the order Tinfoil's own client uses: the reported reset on the server's clock, then
   * Retry-After, then a default. Bounded, so a missing, past or skewed time cannot allow an exchange loop. */
  cooldown(response){
    const t=this.timing,body=response.body,reset=utcTimestamp(body?.resets_at??body?.rate_limit?.resets_at);
    let wait=reset===null?null:reset-response.serverNow;
    if(!(wait>0))wait=retryDelay(response.retryAfter,response.serverNow);
    if(!(wait>0))wait=t.cooldown;
    return response.receivedAt+Math.min(t.maximumCooldown,Math.max(t.minimumCooldown,wait));
  }
  async request(bearer,epoch){
    this.assert(epoch);const t=this.timing,controller=new AbortController();this.abort=controller;const timer=setTimeout(()=>controller.abort(),t.timeout);
    this.lastAttempt=this.now();
    try{
      const r=await this.fetcher(CHAT_TOKEN_URL,{method:'GET',headers:{Authorization:`Bearer ${bearer}`,Accept:'application/json'},redirect:'error',cache:'no-store',signal:controller.signal});
      const receivedAt=this.now();this.assert(epoch);
      if(Number(r.headers?.get('content-length'))>t.maxBytes){await r.body?.cancel().catch(()=>{});throw new InputError('The account response exceeded its size limit.');}
      const reader=r.body?.getReader();let body=null;
      if(reader){let size=0,parts=[];try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>t.maxBytes){await reader.cancel();throw new InputError('The account response exceeded its size limit.');}parts.push(value);}}finally{reader.releaseLock();}
        const bytes=new Uint8Array(size);let offset=0;for(const p of parts){bytes.set(p,offset);offset+=p.length;}try{body=JSON.parse(new TextDecoder().decode(bytes));}catch{}}
      this.assert(epoch);
      return {status:r.status,body,receivedAt,serverNow:httpDate(r.headers?.get('date'))??receivedAt,retryAfter:r.headers?.get('retry-after')??null};
    }finally{clearTimeout(timer);if(this.abort===controller)this.abort=null;}
  }
  /** Inference refused this key: stop reusing it. The website session stays, so the next explicit request exchanges again. */
  reject(key,message){
    if(!key||key!==this.key)return false;
    this.forget();this.state={...this.state,tokenExpiresAt:null,message};this.emit();return true;
  }
  /** The website window refused to open a host outside its list. Say so, instead of leaving a stalled page unexplained. */
  blocked(host){
    const site=typeof host==='string'&&/^[a-z0-9.-]{1,253}$/i.test(host)?host:'another site';
    this.state={...this.state,message:`The sign-in page tried to open ${site}, which Workbench does not open in its sign-in window. Try another sign-in method.`};this.emit();
  }
  /** After system sleep: drop a key that has expired or is about to, without a network request. */
  resume(){if(this.key&&this.keyDeadline-this.now()<=this.timing.refreshMargin){this.forget();this.state={...this.state,tokenExpiresAt:null};this.emit();}}
  async manage(){if(this.state.status!=='signed-in'||!this.binding)throw new InputError('Sign in before managing your profile.');await this.adapter.manage(this.binding);}
  async signOut(){
    if(this.clearing)return this.clearing;
    this.epoch++;this.abort?.abort();this.forget();this.binding=null;this.cooldownUntil=0;this.flight=null;this.state=signedOutAccount();this.emit();
    const cleanup=Promise.resolve().then(()=>this.adapter.clear());this.clearing=cleanup;
    try{await cleanup;}finally{if(this.clearing===cleanup)this.clearing=null;}
  }
  async shutdown(){await this.signOut();}
}
