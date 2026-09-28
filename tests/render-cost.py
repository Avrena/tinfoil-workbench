"""Deterministic synthetic streaming workload, not a live inference benchmark.
Usage: python tests/render-cost.py --baseline /path/to/v0.5-preview.html
Instruments in-memory copies only. Tracks Markdown calls/input, measured function
CPU time, and template characters supplied to updateMarkup (not total heap/GPU).
"""
import argparse, json, statistics
from pathlib import Path
from playwright.sync_api import sync_playwright
parser=argparse.ArgumentParser();parser.add_argument('--baseline');parser.add_argument('--runs',type=int,default=3);parser.add_argument('--chromium',default='/usr/bin/chromium');args=parser.parse_args()
root=Path(__file__).resolve().parents[1]
version='v'+json.loads((root/'package.json').read_text())['version']
fixture=r'''window.__benchSeed=()=>{
 const {chartSpec,chartSVG}=require('/core/visual-tools.js');
 const t=workspace.threads.find(t=>t.id===workspace.activeId); t.settings.visualTools=true;
 const fixed=('A retained explanation with **emphasis**, $x^2+\\sqrt{y}$, and ordinary prose.\n\n```python\nvalues = [2, 4, 6]\nprint(sum(values))\n```\n\n').repeat(8);
 let content='',tools=[];
 for(let i=0;i<5;i++){content+=fixed;const spec=chartSpec({title:'Fixture '+i,type:'line',labels:['a','b','c'],series:[{name:'Sample',values:[1,3,2]}]});tools.push(previewTool('chart',JSON.stringify(spec),chartSVG(spec),'Fixture '+i,content.length));}
 t.turns=[{id:'bench-turn',prompt:'Synthetic repeated rendering fixture',createdAt:1,attachments:[],selectedReplyId:'bench-reply',replies:[{id:'bench-reply',model:'demo/writer',content,reasoning:('Closed provider reasoning $x^2$.\n\n').repeat(300),phase:'answering',status:'streaming',error:null,elapsedMs:0,tools,usage:null}]}];busy=t.id;emit();
 window.__benchAppend=n=>{const r=t.turns[0].replies[0];r.content+=' Token '+n+'.';emit();};
 window.__benchEnd=()=>{t.turns[0].replies[0].status='complete';busy=null;emit();};
};'''
instrument=r'''window.__cost={markdownCalls:0,markdownCharacters:0,markdownMs:0,codeLexCalls:0,templateCalls:0,templateCharacters:0,templateMs:0,mounts:0};
const md=load('/core/markdown.js'),dom=load('/renderer/dom.js'),surfaces=load('/renderer/artifact-surface.js');
for(const [obj,key,calls,chars,ms,arg] of [[md,'markdown','markdownCalls','markdownCharacters','markdownMs',0],[md,'extractCodeBlocks','codeLexCalls',null,null,0],[dom,'updateMarkup','templateCalls','templateCharacters','templateMs',1],[surfaces,'mountArtifact','mounts',null,null,0]]){
 const original=obj[key];obj[key]=function(...args){const c=window.__cost;c[calls]++;if(chars)c[chars]+=String(args[arg]).length;const start=performance.now();try{return original(...args);}finally{if(ms)c[ms]+=performance.now()-start;}};
}
window.__resetCost=()=>Object.keys(window.__cost).forEach(k=>window.__cost[k]=0);
load('/renderer/app.js');'''
marker='const pause = ms => new Promise(r => setTimeout(r, ms));'
def instrumented(path):
 html=Path(path).read_text();assert marker in html;assert "load('/renderer/app.js');" in html
 return html.replace(marker,marker+fixture,1).replace("load('/renderer/app.js');",instrument,1)
results={}
with sync_playwright() as p:
 browser=p.chromium.launch(executable_path=args.chromium,headless=True,args=['--no-sandbox'])
 for name,path in [('baseline',args.baseline),(version,root/'preview/index.html')]:
  if not path:continue
  rows=[]
  for run in range(args.runs):
   page=browser.new_page(viewport={'width':1400,'height':900});errors=[];page.on('pageerror',lambda e:errors.append(str(e)));page.set_content(instrumented(path));page.wait_for_selector('#prompt');page.evaluate('window.__benchSeed()');page.wait_for_timeout(350)
   page.evaluate('window.__resetCost()')
   page.evaluate('''async()=>{for(let i=0;i<30;i++){window.__benchAppend(i);await new Promise(r=>setTimeout(r,85));}window.__benchEnd();await new Promise(r=>setTimeout(r,150));}''')
   assert 'Token 29.' in page.locator('.response-flow').inner_text();assert not errors,errors
   rows.append(page.evaluate('window.__cost'));page.close()
  results[name]={'runs':rows,'median':{k:round(statistics.median(r[k] for r in rows),3) for k in rows[0]}}
 browser.close()
import hashlib
report={'current_version':version,'baseline_sha256':hashlib.sha256(Path(args.baseline).read_bytes()).hexdigest() if args.baseline else None,'scope':'Synthetic production-renderer fixture: 30 paced appends, five retained math/code sections and charts, collapsed reasoning; setup excluded. Not API latency, Windows, GPU power, or token billing. Times are instrumentation on a shared Linux Chromium host.','results':results}
if 'baseline' in results:
 a,b=results['baseline']['median'],results[version]['median'];report['reductions_percent']={k:round(100*(1-b[k]/a[k]),2) for k in ['markdownCharacters','templateCharacters','markdownCalls'] if a[k]}
 # Regression budget, not the earlier v0.4->v0.5 optimization target.
 assert b['markdownCharacters']<=a['markdownCharacters']*1.1
 assert b['templateCharacters']<=a['templateCharacters']*1.30
 report['budget']={'markdown_growth_max_percent':10,'template_growth_max_percent':30,'passed':True}
(root/'docs/render-cost.json').write_text(json.dumps(report,indent=2));print(json.dumps(report,indent=2))
