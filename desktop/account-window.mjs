import { randomUUID } from 'node:crypto';
import { CHAT_ORIGIN, authOrigin, allowedAccountNavigation, accountCookieDomain } from '../dist/core/account.js';
import { InputError } from '../dist/core/validation.js';
import { storableCookie } from './account-store.mjs';

// These scripts read only Clerk's public identity API on the exact Tinfoil origin.
// No selectors, password fields, arbitrary scripts, pasted cookies or native preload.
// `expected` is the {user, session} pair bound at sign-in; the user and the Clerk session must both
// still match before and after every asynchronous step. null means the page is not ready (another
// origin, or Clerk still loading); {signedOut:true} means Clerk is loaded without an active session.
export function sessionScript(force=false,expected=null){return `(async()=>{
  if(location.origin!==${JSON.stringify(CHAT_ORIGIN)})return null;
  const clerk=window.Clerk;if(!clerk?.loaded)return null;if(!clerk.user||!clerk.session)return {signedOut:true};
  const id=clerk.user.id,sid=clerk.session.id,user=${JSON.stringify(expected?.user??null)},session=${JSON.stringify(expected?.session??null)};
  if(user&&id!==user)return {changed:'user'};
  if(session&&sid!==session)return {changed:'session'};
  if(typeof clerk.session.status==='string'&&clerk.session.status!=='active')return {signedOut:true};
  const drift=()=>clerk.user?.id!==id?{changed:'user'}:clerk.session?.id!==sid||clerk.session?.user?.id!==id?{changed:'session'}:null;
  let moved=drift();if(moved)return moved;
  if(${JSON.stringify(force)})await clerk.user.reload();
  moved=drift();if(moved)return moved;
  const bearer=await clerk.session.getToken({skipCache:${JSON.stringify(force)}});
  moved=drift();if(moved)return moved;
  const u=clerk.user,p=u.publicMetadata??{},email=u.primaryEmailAddress;
  return {sessionUserId:id,sessionId:sid,bearer,profile:{id,name:[u.firstName,u.lastName].filter(Boolean).join(' ')||u.username||'Tinfoil account',email:email?.emailAddress??'',emailVerified:email?.verification?.status==='verified',subscriptionStatus:p.chat_subscription_status??null,subscriptionExpiresAt:p.chat_subscription_expires_at??null}};
})()`;}
/** Reads only the current user and session IDs, to confirm them after a token exchange. */
export function identityScript(expected){return `(()=>{
  if(location.origin!==${JSON.stringify(CHAT_ORIGIN)})return null;
  const clerk=window.Clerk;if(!clerk?.loaded)return null;if(!clerk.user||!clerk.session)return {signedOut:true};
  if(clerk.user.id!==${JSON.stringify(expected.user)})return {changed:'user'};
  if(clerk.session.id!==${JSON.stringify(expected.session)}||clerk.session.user?.id!==clerk.user.id)return {changed:'session'};
  return {sessionUserId:clerk.user.id,sessionId:clerk.session.id};
})()`;}
/** Tinfoil's own sign-in page. It offers Google, Apple and email codes, and after a provider redirect its
 * /sso-callback page resumes the account's second factor (/signin?resume=1). Clerk's generic modal did not. */
export const SIGN_IN_URL=CHAT_ORIGIN+'/signin';
/** Electron is injected so boundary behavior can be tested without native binaries. */
export class AccountWindow {
  constructor({BrowserWindow,session},onInvalid=()=>{},onBlocked=()=>{},onCookies=()=>{}){this.BrowserWindow=BrowserWindow;this.sessions=session;this.onInvalid=onInvalid;this.onBlocked=onBlocked;this.onCookies=onCookies;this.window=null;this.ses=null;this.children=new Set();this.rejectLogin=null;this.closing=false;this.epoch=0;}
  // The page stays hidden after sign-in and answers every token read. Throttled as a hidden page, its timers (Clerk's
  // token refresh among them) slowed until reads passed the 15-second limit and cloud sync failed.
  preferences(){return {session:this.ses,sandbox:true,contextIsolation:true,nodeIntegration:false,nodeIntegrationInWorker:false,nodeIntegrationInSubFrames:false,webSecurity:true,webviewTag:false,allowRunningInsecureContent:false,devTools:false,spellcheck:false,backgroundThrottling:false};}
  secure(win){
    const wc=win.webContents;
    // A refusal is reported by host, so a provider flow that needs another site does not just stall.
    const refuse=url=>{let host='';try{host=new URL(url).hostname;}catch{}this.onBlocked(host);};
    const guard=(event,url)=>{if(!allowedAccountNavigation(url)){event.preventDefault();refuse(url);}};
    wc.on('will-navigate',(event,url)=>guard(event,url??event.url));
    // The host list governs the page itself. Frames (provider cookie checks, CAPTCHAs) are limited to
    // HTTPS by the session filter below, and a frame's redirect must not stall the page's sign-in.
    wc.on('will-redirect',(event,url,_inPlace,isMainFrame)=>{if((event.isMainFrame??isMainFrame)!==false)guard(event,url??event.url);});
    wc.on('will-attach-webview',event=>event.preventDefault());
    wc.setWindowOpenHandler(({url})=>{if(allowedAccountNavigation(url))return {action:'allow',overrideBrowserWindowOptions:{title:'Tinfoil account — website',autoHideMenuBar:true,webPreferences:this.preferences()}};refuse(url);return {action:'deny'};});
    wc.on('did-create-window',child=>{this.children.add(child);this.secure(child);child.once('closed',()=>this.children.delete(child));});
    wc.on('render-process-gone',()=>{if(!this.closing)this.onInvalid('The Tinfoil sign-in page stopped. Sign in again.');});
    wc.on('will-prevent-unload',event=>event.preventDefault());
  }
  /** A saved sign-in's cookies go into the new memory-only partition before the page loads; a restored session
   * opens hidden. */
  async create(url=CHAT_ORIGIN+'/',{show=true,cookies=[]}={}){
    if(this.window&&!this.window.isDestroyed())return this.window;
    this.closing=false;
    this.ses=this.sessions.fromPartition('tinfoil-account-'+randomUUID(),{cache:false});
    this.ses.setPermissionRequestHandler((_wc,_p,cb)=>cb(false));this.ses.setPermissionCheckHandler(()=>false);
    this.ses.on('will-download',event=>event.preventDefault());
    this.ses.webRequest.onBeforeRequest((details,cb)=>{let allow=false;try{const u=new URL(details.url);allow=['https:','wss:','data:','blob:','about:'].includes(u.protocol);}catch{}cb({cancel:!allow});});
    const ses=this.ses;ses.cookies.on('changed',(_event,cookie)=>{if(this.ses===ses&&accountCookieDomain(cookie?.domain??''))this.onCookies();});
    for(const cookie of cookies){const valid=storableCookie({...cookie,domain:cookie.domain??new URL(cookie.url).hostname,hostOnly:cookie.domain===undefined});if(valid)await this.ses.cookies.set(valid).catch(()=>{});}
    const win=new this.BrowserWindow({width:1000,height:760,minWidth:420,minHeight:520,title:'Sign in — chat.tinfoil.sh',autoHideMenuBar:true,backgroundColor:'#1e1e1e',show,webPreferences:this.preferences()});
    this.window=win;this.secure(win);
    // Keep an active session page available for on-demand token refresh, not polling.
    win.on('close',event=>{if(!this.closing){event.preventDefault();win.hide();if(this.rejectLogin){const reject=this.rejectLogin;this.rejectLogin=null;reject(new InputError('Sign-in was cancelled.'));}}});
    win.on('closed',()=>{if(this.window===win)this.window=null;});
    await win.loadURL(url);return win;
  }
  /** A reload or provider redirect may be in progress: wait briefly for the page to stop loading. */
  settle(win){
    if(!win.webContents.isLoading())return;
    return new Promise(resolve=>{const wc=win.webContents,timer=setTimeout(done,10000);function done(){clearTimeout(timer);wc.removeListener('did-stop-loading',done);resolve();}wc.once('did-stop-loading',done);});
  }
  async script(source){
    const win=this.window;if(!win||win.isDestroyed())return null;
    await this.settle(win);
    if(win!==this.window||win.isDestroyed()||!authOrigin(win.webContents.getURL()))return null;
    let timer,value;try{value=await Promise.race([win.webContents.executeJavaScript(source,true),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new InputError('Tinfoil sign-in did not respond. Reopen it and try again.')),15000);})]);}finally{clearTimeout(timer);}
    if(win!==this.window||win.isDestroyed()||!authOrigin(win.webContents.getURL()))return null;return value;
  }
  async login(){
    const epoch=++this.epoch;
    let timer;const cancel=new Promise((_,reject)=>{this.rejectLogin=reject;});
    const task=(async()=>{const win=await this.create(SIGN_IN_URL);win.show();win.focus();let seen=null;const deadline=Date.now()+600000;
      while(epoch===this.epoch&&Date.now()<deadline){
        const value=await this.script(sessionScript());
        // Two reads a second apart must agree, so the redirect that follows sign-in (a provider
        // callback, then the chat page) has settled before any token is requested.
        if(value?.bearer&&value?.profile){
          if(seen?.sessionUserId===value.sessionUserId&&seen?.sessionId===value.sessionId){this.rejectLogin=null;win.hide();return value;}
          seen=value;
        }else seen=null;
        await new Promise(r=>{timer=setTimeout(r,1000);});
      }throw new InputError('Sign-in timed out or was cancelled. Reopen Account to try again.');
    })();
    try{return await Promise.race([task,cancel]);}catch(error){this.epoch++;throw error;}finally{clearTimeout(timer);this.rejectLogin=null;}
  }
  checked(value){
    if(value?.changed){
      const what=value.changed==='user'?'account':'session';
      this.onInvalid(`The website ${what} changed. Sign out here and reconnect before sending.`);throw new InputError(`The website ${what} changed. Reconnect it in Account.`);
    }
    if(value?.signedOut){this.onInvalid('Your Tinfoil sign-in expired. Sign in again.');throw new InputError('Your Tinfoil sign-in expired. Sign in again.');}
    // Not ready is not a sign-out: nothing is invalidated, and the request is refused for now.
    if(!value)throw new InputError('The Tinfoil sign-in page is not ready. Try again in a moment.');
    return value;
  }
  async readSession(force=false,expected=null){
    const value=this.checked(await this.script(sessionScript(force,expected)));
    if(!value.bearer){this.onInvalid('Your Tinfoil sign-in expired. Sign in again.');throw new InputError('Your Tinfoil sign-in expired. Sign in again.');}
    return value;
  }
  async identity(expected){return this.checked(await this.script(identityScript(expected)));}
  /** The persistent cookies of Tinfoil's hosts in this sign-in's partition, for a saved sign-in. */
  async cookies(){if(!this.ses)return [];return (await this.ses.cookies.get({})).map(storableCookie).filter(Boolean);}
  /** Opens Tinfoil's page hidden with a saved sign-in's cookies and reads the session bound to it. Returns that read,
   * {signedOut} or {changed}, or null if the page never became ready (for example offline), so it can be retried. */
  async restore(saved,{timeout=30000,interval=1000}={}){
    const epoch=++this.epoch;let timer;
    if(this.window&&!this.window.isDestroyed())await this.window.loadURL(CHAT_ORIGIN+'/').catch(()=>{});
    else await this.create(CHAT_ORIGIN+'/',{show:false,cookies:saved.cookies}).catch(()=>{});
    try{
      for(const deadline=Date.now()+timeout;epoch===this.epoch&&Date.now()<deadline;){
        const value=await this.script(sessionScript(false,saved.binding)).catch(()=>null);
        if(value)return value;
        await new Promise(r=>{timer=setTimeout(r,interval);});
      }
      return null;
    }finally{clearTimeout(timer);}
  }
  async manage(expected){
    await this.readSession(false,expected);this.window.show();this.window.focus();
    await this.script(`(()=>{if(location.origin===${JSON.stringify(CHAT_ORIGIN)}&&window.Clerk?.user?.id===${JSON.stringify(expected.user)}&&window.Clerk.session?.id===${JSON.stringify(expected.session)}){window.Clerk.openUserProfile();return true;}return false;})()`);
  }
  /** Closes the page and its partition. `end` also ends this app's Clerk session; quitting while staying signed in
   * keeps it, so the saved sign-in stays valid. */
  async clear({end=true}={}){
    this.epoch++;this.closing=true;this.rejectLogin?.(new InputError('Sign-in was cancelled.'));this.rejectLogin=null;
    // Revoke just this app's Clerk session where available; cleanup is unconditional.
    if(end)try{await this.script(`(async()=>{if(location.origin===${JSON.stringify(CHAT_ORIGIN)}&&window.Clerk?.session)await window.Clerk.session.end();})()`);}catch{}
    for(const child of this.children)if(!child.isDestroyed())child.destroy();this.children.clear();
    if(this.window&&!this.window.isDestroyed())this.window.destroy();this.window=null;
    const ses=this.ses;this.ses=null;if(ses)await Promise.allSettled([ses.closeAllConnections(),ses.clearStorageData(),ses.clearCache()]);
  }
}
