/** Account display data only. Credentials never belong in snapshots or exports. */
export type ConnectionMode = 'api-key' | 'chat-account';
export type AccountStatus = 'signed-out' | 'signing-in' | 'signed-in' | 'expired' | 'error';
export interface AccountProfile {
  id: string; name: string; email: string; emailVerified: boolean;
  subscriptionStatus: string | null; subscriptionExpiresAt: number | null;
}
export interface TokenBudget { max: number; used: number; remaining: number }
export interface AccountUsage {
  maxRequests: number | null; remaining: number | null; resetsAt: number | null;
  inputTokens: TokenBudget | null; outputTokens: TokenBudget | null;
}
export interface AccountSnapshot {
  status: AccountStatus; profile: AccountProfile | null;
  entitlement: 'unknown' | 'active' | 'subscription-required' | 'rate-limited';
  usage: AccountUsage | null; checkedAt: number | null; tokenExpiresAt: number | null;
  message: string | null;
}
export const signedOutAccount = (): AccountSnapshot => ({status:'signed-out', profile:null, entitlement:'unknown', usage:null, checkedAt:null, tokenExpiresAt:null, message:null});
export const CHAT_ORIGIN = 'https://chat.tinfoil.sh';
export const CHAT_TOKEN_URL = 'https://api.tinfoil.sh/api/chat/token';
const obj = (v: unknown): Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
const clean = (v: unknown, n: number): string => typeof v === 'string' ? v.replace(/[\x00-\x1f\x7f]/g,'').slice(0,n).trim() : '';
export function accountDate(v: unknown): number | null {
  if (typeof v !== 'string' || v.length > 100 || !v.trim()) return null;
  const t=Date.parse(v); return Number.isFinite(t) && t > 0 ? t : null;
}
/** Token-response times: RFC 3339 with Z or an explicit offset. JavaScript reads a zone-less date-time as local time, so it is refused. */
export function utcTimestamp(v: unknown): number | null {
  if (typeof v !== 'string' || v.length > 40 || !/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(v)) return null;
  const t=Date.parse(v); return Number.isFinite(t) && t > 0 ? t : null;
}
export function normalizeProfile(value: unknown): AccountProfile | null {
  const v=obj(value), id=v.id;
  if(typeof id!=='string'||id.length>200||!/^user_[A-Za-z0-9_-]+$/.test(id))return null;
  const statuses=['active','canceled','incomplete','incomplete_expired','past_due','paused','trialing','unpaid'];
  return {id, name:clean(v.name,160)||'Tinfoil account',email:clean(v.email,320),emailVerified:v.emailVerified===true,
    subscriptionStatus:typeof v.subscriptionStatus==='string'&&statuses.includes(v.subscriptionStatus)?v.subscriptionStatus:null,
    subscriptionExpiresAt:accountDate(v.subscriptionExpiresAt)};
}
const count=(v:unknown):number|null=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0?v:null;
function budget(v:unknown):TokenBudget|null {const b=obj(v);const max=count(b.max),used=count(b.used),remaining=count(b.remaining);return max!==null&&used!==null&&remaining!==null?{max,used,remaining}:null;}
export function normalizeUsage(value: unknown): AccountUsage | null {
  if(!value||typeof value!=='object'||Array.isArray(value))return null;
  const v=obj(value);
  return {maxRequests:count(v.max_requests),remaining:count(v.remaining),resetsAt:utcTimestamp(v.resets_at),
    inputTokens:budget({max:v.max_input_tokens,used:v.input_tokens_used,remaining:v.input_tokens_remaining}),outputTokens:budget({max:v.max_output_tokens,used:v.output_tokens_used,remaining:v.output_tokens_remaining})};
}
export function authOrigin(url: string): boolean {
  try {const u=new URL(url);return u.origin===CHAT_ORIGIN && !u.username && !u.password; }catch{return false;}
}
/** Google's own domains, from its published list (https://www.google.com/supported_domains, 187 entries,
 * retrieved 28 September 2026). At the end of its sign-in, Google moves the page itself through
 * accounts.youtube.com and accounts.<the Google domain for the user's country> to set account cookies,
 * then returns to accounts.google.com. Only those accounts hosts are allowed, not the rest of each domain. */
const GOOGLE_DOMAINS = new Set(`
com ad ae com.af com.ag al am co.ao com.ar as at com.au az ba com.bd be bf bg com.bh bi bj com.bn com.bo com.br bs bt co.bw by com.bz ca cd cf cg ch
ci co.ck cl cm cn com.co co.cr com.cu cv com.cy cz de dj dk dm com.do dz com.ec ee com.eg es com.et fi com.fj fm fr ga ge gg com.gh com.gi gl gm gr
com.gt gy com.hk hn hr ht hu co.id ie co.il im co.in iq is it je com.jm jo co.jp co.ke com.kh ki kg co.kr com.kw kz la com.lb li lk co.ls lt lu lv
com.ly co.ma md me mg mk ml com.mm mn com.mt mu mv mw com.mx com.my co.mz com.na com.ng com.ni ne nl no com.np nr nu co.nz com.om com.pa com.pe com.pg
com.ph com.pk pl pn com.pr ps pt com.py com.qa ro ru rw com.sa com.sb sc se com.sg sh si sk com.sl sn so sm sr st com.sv td tg co.th com.tj tl tm tn
to com.tr tt com.tw co.tz com.ua co.ug co.uk com.uy co.uz com.vc co.ve co.vi com.vn vu ws rs co.za co.zm co.zw cat
`.trim().split(/\s+/).map(suffix => 'google.' + suffix));
const ACCOUNT_HOSTS = ['chat.tinfoil.sh','clerk.tinfoil.sh','accounts.tinfoil.sh','accounts.youtube.com','appleid.apple.com','github.com','login.microsoftonline.com','login.live.com'];
/** Top-level login navigation only; remote pages never receive a native bridge. */
export function allowedAccountNavigation(url: string): boolean {
  try {const u=new URL(url),h=u.hostname;return u.protocol==='https:'&&!u.username&&!u.password&&!u.port&&
    (ACCOUNT_HOSTS.includes(h)||h.startsWith('accounts.')&&GOOGLE_DOMAINS.has(h.slice('accounts.'.length)));
  }catch{return false;}
}
export function initials(name:string):string {return name.trim().split(/\s+/).slice(0,2).map(x=>Array.from(x)[0]??'').join('').toLocaleUpperCase()||'TF';}
export function accountLabel(account?:AccountSnapshot):string {return account?.profile?.name??'Account';}
