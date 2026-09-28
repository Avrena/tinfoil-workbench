/** A display-only parser for Tinfoil's documented inline router events.
 * Payloads are untrusted observations, NEVER instructions to invoke local tools.
 * Unknown/malformed markers are losslessly left in answer text.
 */
export const TINFOIL_EVENT_HEADERS = { 'X-Tinfoil-Events': 'web_search,code_execution' };
const OPEN='<tinfoil-event>', CLOSE='</tinfoil-event>', MAX_MARKER=65536;
export interface RouterEvent {
  itemId: string; family: 'web_search'|'code_execution';
  status: 'running'|'complete'|'error'|'denied'; name: string;
  arguments?: string; output?: string; error?: string;
  sources?: {url:string;title:string}[];
}
export type EventPart = {type:'text';text:string} | {type:'event';event:RouterEvent};
const obj=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
function redact(value: unknown, depth=0): unknown {
  if(depth>8)return '[nested value omitted]';
  if(Array.isArray(value))return value.slice(0,100).map(v=>redact(v,depth+1));
  if(obj(value))return Object.fromEntries(Object.entries(value).slice(0,100).map(([k,v])=>[k,/token|secret|password|authorization|api.?key|encryption.?key/i.test(k)?'[redacted]':redact(v,depth+1)]));
  return typeof value==='string'?value.slice(0,48000):value;
}
export function parseRouterEvent(raw: string): RouterEvent | null {
  let v:unknown;try{v=JSON.parse(raw);}catch{return null;}
  if(!obj(v)||typeof v.item_id!=='string'||!v.item_id||v.item_id.length>200)return null;
  if(!['in_progress','searching','completed','failed','blocked'].includes(String(v.status)))return null;
  const web=v.type==='tinfoil.web_search_call';if(!web&&v.type!=='tinfoil.tool_call')return null;
  const status=v.status==='completed'?'complete':v.status==='failed'?'error':v.status==='blocked'?'denied':'running';
  const tool=obj(v.tool)?v.tool:{},action=obj(v.action)?v.action:{};
  const event:RouterEvent={itemId:v.item_id,family:web?'web_search':'code_execution',status,
    name:web?(action.type==='open_page'?'Open page':'Web search'):typeof tool.name==='string'?tool.name.slice(0,80):'Code execution'};
  const args=web?action:tool.arguments;
  if(obj(args)&&Object.keys(args).length)event.arguments=JSON.stringify(redact(args)).slice(0,64000);
  if(typeof tool.output==='string')event.output=tool.output.slice(0,64000);
  if(obj(v.error)&&typeof v.error.code==='string')event.error=v.error.code.slice(0,240);
  if(Array.isArray(v.sources))event.sources=v.sources.slice(0,30).flatMap(s=>{
    if(!obj(s)||typeof s.url!=='string'||s.url.length>2048)return [];
    try{const u=new URL(s.url);if(!['https:','http:'].includes(u.protocol)||u.username||u.password)return [];
      return [{url:u.href,title:typeof s.title==='string'?s.title.slice(0,240):u.hostname}];}catch{return [];}
  });
  return event;
}
export class RouterEventParser {
  private buffer=''; private skipNewline=false;
  consume(chunk: string): EventPart[] {
    this.buffer+=chunk;const out:EventPart[]=[];
    const emit=(text:string)=>{if(text)out.push({type:'text',text});};
    if(this.skipNewline&&this.buffer){if(this.buffer[0]==='\n')this.buffer=this.buffer.slice(1);this.skipNewline=false;}
    while(this.buffer){
      const start=this.buffer.indexOf(OPEN);
      if(start<0){
        let hold=0;
        for(let n=1;n<OPEN.length&&n<=this.buffer.length;n++)if(this.buffer.endsWith(OPEN.slice(0,n)))hold=n;
        // Hold one leading pad newline so its removal never needs a retroactive text edit.
        if(this.buffer[this.buffer.length-hold-1]==='\n')hold++;
        emit(this.buffer.slice(0,this.buffer.length-hold));this.buffer=this.buffer.slice(this.buffer.length-hold);break;
      }
      const end=this.buffer.indexOf(CLOSE,start+OPEN.length);
      if(end<0){
        if(this.buffer.length-start>MAX_MARKER){emit(this.buffer.slice(0,start+OPEN.length));this.buffer=this.buffer.slice(start+OPEN.length);continue;}
        const before=start>0&&this.buffer[start-1]==='\n'?start-1:start;
        emit(this.buffer.slice(0,before));this.buffer=this.buffer.slice(before);break;
      }
      const event=end-start<=MAX_MARKER?parseRouterEvent(this.buffer.slice(start+OPEN.length,end)):null;
      if(event){emit(this.buffer.slice(0,start>0&&this.buffer[start-1]==='\n'?start-1:start));out.push({type:'event',event});}
      else emit(this.buffer.slice(0,end+CLOSE.length));
      this.buffer=this.buffer.slice(end+CLOSE.length);
      if(event){if(this.buffer.startsWith('\n'))this.buffer=this.buffer.slice(1);else if(!this.buffer)this.skipNewline=true;}
    }
    return out;
  }
  flush():string {const tail=this.buffer;this.buffer='';this.skipNewline=false;return tail;}
}
