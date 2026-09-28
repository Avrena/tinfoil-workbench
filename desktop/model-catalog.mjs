import { normalizeCapability } from '../dist/core/capabilities.js';
/** Public UI metadata only; never sends an API key, prompt, or transcript.
 * Inference still exclusively uses the attested Tinfoil SDK. */
export async function loadModelCapabilities(fetcher = fetch) {
  const response=await fetcher('https://api.tinfoil.sh/api/config/models',{
    redirect:'error',signal:AbortSignal.timeout(10000),headers:{Accept:'application/json'},credentials:'omit',
  });
  if(!response.ok)throw new Error('Model capabilities unavailable');
  const reader=response.body?.getReader();if(!reader)throw new Error('Missing catalog body');
  let size=0;const chunks=[];
  try { while(true){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>2*1024*1024)throw new Error('Catalog too large');chunks.push(value);} }
  catch(e){await reader.cancel().catch(()=>{});throw e;}
  const data=JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if(!Array.isArray(data)||data.length>2000)throw new Error('Invalid catalog');
  return data.map(normalizeCapability).filter(Boolean);
}
