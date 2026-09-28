import { randomUUID } from 'node:crypto';
import { CHAT_ORIGIN, authOrigin, allowedAccountNavigation } from '../dist/core/account.js';
import { InputError } from '../dist/core/validation.js';

// These scripts read only Clerk's public identity API on the exact Tinfoil origin.
// No selectors, password fields, arbitrary scripts, pasted cookies or native preload.
export function sessionScript(force=false,expected=null){return `(async()=>{
  if(location.origin!==${JSON.stringify(CHAT_ORIGIN)})return null;
  const clerk=window.Clerk;if(!clerk?.loaded||!clerk.user||!clerk.session)return null;
  const id=clerk.user.id;if(${JSON.stringify(expected)}&&id!==${JSON.stringify(expected)})return {changed:true};
  if(${JSON.stringify(force)})await clerk.user.reload();
  if(clerk.user?.id!==id||clerk.session?.user?.id!==id)return {changed:true};
  const bearer=await clerk.session.getToken({skipCache:${JSON.stringify(force)}});
  if(clerk.user?.id!==id||clerk.session?.user?.id!==id)return {changed:true};
  const u=clerk.user,p=u.publicMetadata??{},email=u.primaryEmailAddress;
  return {sessionUserId:id,bearer,profile:{id,name:[u.firstName,u.lastName].filter(Boolean).join(' ')||u.username||'Tinfoil account',email:email?.emailAddress??'',emailVerified:email?.verification?.status==='verified',subscriptionStatus:p.chat_subscription_status??null,subscriptionExpiresAt:p.chat_subscription_expires_at??null}};
})()`;}
export const signInScript=`(()=>{if(location.origin!==${JSON.stringify(CHAT_ORIGIN)})return false;const c=window.Clerk;if(!c?.loaded)return false;if(!c.user)c.openSignIn({forceRedirectUrl:${JSON.stringify(CHAT_ORIGIN+'/')},signUpForceRedirectUrl:${JSON.stringify(CHAT_ORIGIN+'/')}});return true;})()`;
/** Electron is injected so boundary behavior can be tested without native binaries. */
export class AccountWindow {
  constructor({BrowserWindow,session},onInvalid=()=>{}){this.BrowserWindow=BrowserWindow;this.sessions=session;this.onInvalid=onInvalid;this.window=null;this.ses=null;this.children=new Set();this.rejectLogin=null;this.closing=false;this.epoch=0;}
  preferences(){return {session:this.ses,sandbox:true,contextIsolation:true,nodeIntegration:false,nodeIntegrationInWorker:false,nodeIntegrationInSubFrames:false,webSecurity:true,webviewTag:false,allowRunningInsecureContent:false,devTools:false,spellcheck:false};}
  secure(win){
    const wc=win.webContents;
    wc.on('will-navigate',(event,url)=>{if(!allowedAccountNavigation(url??event.url))event.preventDefault();});
    wc.on('will-redirect',(event,url)=>{if(!allowedAccountNavigation(url??event.url))event.preventDefault();});
    wc.on('will-attach-webview',event=>event.preventDefault());
    wc.setWindowOpenHandler(({url})=>allowedAccountNavigation(url)?{action:'allow',overrideBrowserWindowOptions:{title:'Tinfoil account — website',autoHideMenuBar:true,webPreferences:this.preferences()}}:{action:'deny'});
    wc.on('did-create-window',child=>{this.children.add(child);this.secure(child);child.once('closed',()=>this.children.delete(child));});
    wc.on('render-process-gone',()=>{if(!this.closing)this.onInvalid('The Tinfoil sign-in page stopped. Sign in again.');});
    wc.on('will-prevent-unload',event=>event.preventDefault());
  }
  async create(){
    if(this.window&&!this.window.isDestroyed())return this.window;
    this.closing=false;
    this.ses=this.sessions.fromPartition('tinfoil-account-'+randomUUID(),{cache:false});
    this.ses.setPermissionRequestHandler((_wc,_p,cb)=>cb(false));this.ses.setPermissionCheckHandler(()=>false);
    this.ses.on('will-download',event=>event.preventDefault());
    this.ses.webRequest.onBeforeRequest((details,cb)=>{let allow=false;try{const u=new URL(details.url);allow=['https:','wss:','data:','blob:','about:'].includes(u.protocol);}catch{}cb({cancel:!allow});});
    const win=new this.BrowserWindow({width:1000,height:760,minWidth:420,minHeight:520,title:'Sign in — chat.tinfoil.sh',autoHideMenuBar:true,backgroundColor:'#1e1e1e',webPreferences:this.preferences()});
    this.window=win;this.secure(win);
    // Keep an active session page available for on-demand token refresh, not polling.
    win.on('close',event=>{if(!this.closing){event.preventDefault();win.hide();if(this.rejectLogin){const reject=this.rejectLogin;this.rejectLogin=null;reject(new InputError('Sign-in was cancelled.'));}}});
    win.on('closed',()=>{if(this.window===win)this.window=null;});
    await win.loadURL(CHAT_ORIGIN+'/');return win;
  }
  async script(source){
    const win=this.window;if(!win||win.isDestroyed()||!authOrigin(win.webContents.getURL()))return null;
    let timer,value;try{value=await Promise.race([win.webContents.executeJavaScript(source,true),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new InputError('Tinfoil sign-in did not respond. Reopen it and try again.')),15000);})]);}finally{clearTimeout(timer);}
    if(win!==this.window||win.isDestroyed()||!authOrigin(win.webContents.getURL()))return null;return value;
  }
  async login(){
    const epoch=++this.epoch;
    let timer;const cancel=new Promise((_,reject)=>{this.rejectLogin=reject;});
    const task=(async()=>{const win=await this.create();win.show();win.focus();let opened=false;const deadline=Date.now()+600000;
      while(epoch===this.epoch&&Date.now()<deadline){
        if(!opened)opened=await this.script(signInScript)===true;
        const value=await this.script(sessionScript());
        if(value?.bearer&&value?.profile){this.rejectLogin=null;win.hide();return value;}
        await new Promise(r=>{timer=setTimeout(r,1000);});
      }throw new InputError('Sign-in timed out or was cancelled. Reopen Account to try again.');
    })();
    try{return await Promise.race([task,cancel]);}catch(error){this.epoch++;throw error;}finally{clearTimeout(timer);this.rejectLogin=null;}
  }
  async readSession(force=false,expected=null){
    const value=await this.script(sessionScript(force,expected));
    if(value?.changed){this.onInvalid('The website account changed. Sign out here and reconnect before sending.');throw new InputError('The website account changed. Reconnect it in Account.');}
    if(!value?.bearer){this.onInvalid('Your Tinfoil sign-in expired. Sign in again.');throw new InputError('Your Tinfoil sign-in expired. Sign in again.');}
    return value;
  }
  async manage(expected){
    await this.readSession(false,expected);this.window.show();this.window.focus();
    await this.script(`(()=>{if(location.origin===${JSON.stringify(CHAT_ORIGIN)}&&window.Clerk?.user?.id===${JSON.stringify(expected)}){window.Clerk.openUserProfile();return true;}return false;})()`);
  }
  async clear(){
    this.epoch++;this.closing=true;this.rejectLogin?.(new InputError('Sign-in was cancelled.'));this.rejectLogin=null;
    // Revoke just this app's Clerk session where available; cleanup is unconditional.
    try{await this.script(`(async()=>{if(location.origin===${JSON.stringify(CHAT_ORIGIN)}&&window.Clerk?.session)await window.Clerk.session.end();})()`);}catch{}
    for(const child of this.children)if(!child.isDestroyed())child.destroy();this.children.clear();
    if(this.window&&!this.window.isDestroyed())this.window.destroy();this.window=null;
    const ses=this.ses;this.ses=null;if(ses)await Promise.allSettled([ses.closeAllConnections(),ses.clearStorageData(),ses.clearCache()]);
  }
}
