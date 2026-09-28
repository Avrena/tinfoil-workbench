import { signedOutAccount, normalizeProfile, normalizeUsage, accountDate, CHAT_TOKEN_URL } from '../dist/core/account.js';
import { InputError } from '../dist/core/validation.js';

const secret = value => typeof value === 'string' && value.length > 0 && value.length <= 16384 && !/[\x00-\x20\x7f]/.test(value);
/** Isolated, memory-only account credentials; this object is never serialized. */
export class AccountSession {
  constructor(adapter, onChange = () => {}, {fetcher=globalThis.fetch, now=Date.now} = {}) {
    this.adapter=adapter;this.onChange=onChange;this.fetcher=fetcher;this.now=now;
    this.state=signedOutAccount();this.key=null;this.epoch=0;this.flight=null;this.abort=null;this.clearing=null;
  }
  snapshot(){return structuredClone(this.state);}
  emit(){this.onChange(this.snapshot());}
  invalidate(message='Your Tinfoil session expired. Sign in again.'){
    this.epoch++;this.abort?.abort();this.key=null;this.flight=null;
    this.state={...this.state,status:'expired',entitlement:'unknown',usage:null,tokenExpiresAt:null,message};this.emit();
  }
  accept(raw, expected=null){
    const profile=normalizeProfile(raw?.profile);
    if(!profile || raw?.sessionUserId!==profile.id || !secret(raw?.bearer)){
      if(expected)this.invalidate('Your Tinfoil session is unavailable. Sign in again.');
      throw new InputError('Your Tinfoil session is unavailable. Sign in again.');
    }
    if(expected&&profile.id!==expected){this.invalidate('The website account changed. Sign out here and reconnect before sending.');throw new InputError(this.state.message);}
    this.state={...this.state,status:'signed-in',profile};return raw.bearer;
  }
  async login(){
    // Never reuse a browser partition that is still being cleared by sign-out.
    if(this.clearing)await this.clearing;
    if(this.state.status==='signing-in')throw new InputError('Sign-in is already open.');
    if(this.state.profile)throw new InputError('Sign out before connecting another account.');
    const epoch=++this.epoch;this.state={...signedOutAccount(),status:'signing-in'};this.emit();
    try{
      const raw=await this.adapter.login();if(epoch!==this.epoch)return;
      this.accept(raw);this.emit();
      // A signed-in identity is separate from subscription entitlement.
      try{await this.getCredential(true);}catch(error){if(epoch!==this.epoch)return;if(!['subscription-required','rate-limited'].includes(this.state.entitlement))throw error;}
    }catch(error){
      if(epoch!==this.epoch)return;
      this.key=null;this.state={...this.state,status:this.state.profile?'expired':'error',tokenExpiresAt:null,message:error instanceof InputError?error.message:'Sign-in could not finish. Reopen Tinfoil sign-in and try again.'};this.emit();
    }
  }
  async refresh(){
    if(this.state.status!=='signed-in')throw new InputError('Sign in before refreshing your profile.');
    try{await this.getCredential(true);}catch(error){if(!['subscription-required','rate-limited'].includes(this.state.entitlement))throw error;}
  }
  async getCredential(force=false){
    if(this.state.status!=='signed-in'||!this.state.profile)throw new InputError('Sign in to Tinfoil Chat in Account first. No API-key fallback is used.');
    if(this.flight)return this.flight;
    const epoch=this.epoch,expected=this.state.profile.id;
    const promise=(async()=>{
      try{
        const raw=await this.adapter.readSession(force,expected);this.assert(epoch);
        let bearer=this.accept(raw,expected);
        if(!force&&this.key&&this.state.tokenExpiresAt>this.now()+60_000)return {key:this.key,owner:expected,expiresAt:this.state.tokenExpiresAt};
        if(this.state.entitlement==='rate-limited'&&this.state.usage?.resetsAt>this.now())throw new InputError('Tinfoil reports a usage limit. Wait until the displayed reset time.');
        let response=await this.request(bearer,epoch);
        // Only refresh identity authorization once; never retry a generation.
        if(response.status===401){
          const refreshed=await this.adapter.readSession(true,expected);this.assert(epoch);bearer=this.accept(refreshed,expected);response=await this.request(bearer,epoch);
        }
        this.assert(epoch);this.key=null;
        this.state.checkedAt=this.now();this.state.tokenExpiresAt=null;
        if(response.status===401||response.status===403){this.invalidate('Tinfoil rejected this session. Sign in again.');throw new InputError(this.state.message);}
        if(response.status===402){this.state.entitlement='subscription-required';this.state.usage=null;this.state.message='Tinfoil reports that a Chat subscription is required. API-key access is separate.';this.emit();throw new InputError(this.state.message);}
        if(response.status===429){this.state.entitlement='rate-limited';this.state.usage=normalizeUsage({...response.body?.rate_limit,resets_at:response.body?.resets_at??response.body?.rate_limit?.resets_at});this.state.message='Tinfoil reports a usage limit. Requests are not retried or switched to another billing mode.';this.emit();throw new InputError(this.state.message);}
        if(response.status!==200)throw new InputError('Tinfoil account access could not be checked. Refresh when the service is available.');
        if(!secret(response.body?.key))throw new InputError('Tinfoil returned an invalid account token response.');
        const expiry=accountDate(response.body.expires_at);
        if(expiry!==null&&expiry<=this.now())throw new InputError('Tinfoil returned an expired account token. Refresh your session.');
        this.key=response.body.key;this.state={...this.state,entitlement:'active',usage:normalizeUsage(response.body.rate_limit),tokenExpiresAt:expiry??this.now()+60_000,message:null};this.emit();
        return {key:this.key,owner:expected,expiresAt:this.state.tokenExpiresAt};
      }catch(error){
        if(epoch===this.epoch){this.key=null;this.state.tokenExpiresAt=null;
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
  async request(bearer,epoch){
    this.assert(epoch);const controller=new AbortController();this.abort=controller;const timer=setTimeout(()=>controller.abort(),15000);
    try{
      const r=await this.fetcher(CHAT_TOKEN_URL,{method:'GET',headers:{Authorization:`Bearer ${bearer}`,Accept:'application/json'},redirect:'error',cache:'no-store',signal:controller.signal});
      this.assert(epoch);
      if(Number(r.headers?.get('content-length'))>65536)throw new InputError('The account response exceeded its size limit.');
      const reader=r.body?.getReader();let body=null;
      if(reader){let size=0,parts=[];try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>65536){await reader.cancel();throw new InputError('The account response exceeded its size limit.');}parts.push(value);}}finally{reader.releaseLock();}
        const bytes=new Uint8Array(size);let offset=0;for(const p of parts){bytes.set(p,offset);offset+=p.length;}try{body=JSON.parse(new TextDecoder().decode(bytes));}catch{}}
      this.assert(epoch);return {status:r.status,body};
    }finally{clearTimeout(timer);if(this.abort===controller)this.abort=null;}
  }
  async manage(){if(this.state.status!=='signed-in')throw new InputError('Sign in before managing your profile.');await this.adapter.manage(this.state.profile.id);}
  async signOut(){
    if(this.clearing)return this.clearing;
    this.epoch++;this.abort?.abort();this.key=null;this.flight=null;this.state=signedOutAccount();this.emit();
    const cleanup=Promise.resolve().then(()=>this.adapter.clear());this.clearing=cleanup;
    try{await cleanup;}finally{if(this.clearing===cleanup)this.clearing=null;}
  }
  async shutdown(){await this.signOut();}
}
