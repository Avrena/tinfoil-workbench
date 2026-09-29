"""v0.5 regression tests: seamless surfaces, deferred rendering, retained view
state and lazy reasoning. Uses only synthetic data in an in-memory preview copy.
"""
import argparse, json, io
from PIL import Image
from pathlib import Path
from playwright.sync_api import sync_playwright, expect
parser=argparse.ArgumentParser();parser.add_argument('--chromium',default=None);parser.add_argument('--no-sandbox',action='store_true');args=parser.parse_args()
root=Path(__file__).resolve().parents[1];html=(root/'preview/index.html').read_text(encoding='utf-8');checks=[];errors=[];requests=[]
marker='const pause = (ms) => new Promise((r) => setTimeout(r, ms));'
fixture=r'''window.__seed=(count=1)=>{
 const {chartSpec,chartSVG}=require('/core/visual-tools.js');const t=workspace.threads.find(t=>t.id===workspace.activeId);
 const prefix='An explanation with $x^2$.\n\n```python\nprint(2)\n```\n\n';
 const spec=chartSpec({title:'Illustrative comparison',type:'line',labels:['One','Two','Three'],series:[{name:'First',values:[4,5,6]},{name:'Second',values:[2,3,4]}]});
 const tools=Array.from({length:count},(_,i)=>previewTool('chart',JSON.stringify(spec),chartSVG(spec),'Illustrative '+i,prefix.length));
 t.turns=[{id:'test-turn',prompt:'A synthetic display test',createdAt:1,attachments:[],selectedReplyId:'test-reply',replies:[{id:'test-reply',model:'demo/writer',content:prefix+'Interpretation follows.',reasoning:'Fixture reasoning with $x^3$.',phase:'answering',status:'streaming',error:null,elapsedMs:0,tools,usage:null}]}];busy=t.id;emit();
 window.__patch=patch=>{Object.assign(t.turns[0].replies[0],patch);emit();};window.__get=()=>structuredClone(t.turns[0].replies[0]);
};'''
instrument=r'''window.__probe={reasoning:0,markdown:0,mounts:0};
const md=load('/core/markdown.js'),surfaces=load('/renderer/artifact-surface.js');
const original=md.markdown;md.markdown=(text,...rest)=>{window.__probe.markdown++;if(text.startsWith('Fixture reasoning'))window.__probe.reasoning++;return original(text,...rest);};
const mount=surfaces.mountArtifact;surfaces.mountArtifact=(...args)=>{window.__probe.mounts++;return mount(...args);};
window.__resetProbe=()=>{for(const k in window.__probe)window.__probe[k]=0;};load('/renderer/app.js');'''
html=html.replace(marker,marker+fixture,1).replace("load('/renderer/app.js');",instrument,1)
with sync_playwright() as p:
 b=p.chromium.launch(executable_path=args.chromium,headless=True,args=['--no-sandbox'] if args.no_sandbox else [])
 page=b.new_page(viewport={'width':1440,'height':1000});page.on('pageerror',lambda e:errors.append(str(e)));page.on('request',lambda r:requests.append(r.url));page.set_content(html);page.wait_for_selector('#prompt');page.evaluate('window.__seed()')
 figure=page.locator('.inline-artifact').first;expect(figure.locator('svg[role=img]')).to_be_visible()
 style=figure.evaluate('(e)=>{const s=getComputedStyle(e);return [s.backgroundColor,s.borderTopWidth,s.boxShadow]}');assert style==['rgba(0, 0, 0, 0)','0px','none'],style
 assert page.locator('.main').evaluate('(e)=>getComputedStyle(e).backgroundColor')=='rgb(30, 30, 30)'
 assert figure.locator('svg[role=img] > rect[width="100%"] ').count()==0
 checks.append('figures have transparent backgrounds and no enclosing border, shadow, or navy canvas')
 assert figure.locator('.inline-artifact-header').bounding_box()['height']<=36
 checks.append('title and optional controls share one compact baseline instead of two card headers')
 assert page.locator('.reasoning-content').inner_text()=='';assert page.evaluate('window.__probe.reasoning')==0
 checks.append('initially collapsed reasoning is not Markdown-parsed or materialized')
 before=page.evaluate('window.__get().content');page.evaluate('window.__resetProbe()')
 page.evaluate('(content)=>window.__patch({content:content+" More output."})',before);expect(page.locator('.response-flow')).to_contain_text('More output.')
 assert page.evaluate('window.__probe.markdown')==1;assert page.evaluate('window.__probe.reasoning')==0;assert page.evaluate('window.__probe.mounts')==0
 checks.append('an answer delta parses only its changed text segment and does not remount charts')
 page.locator('.reasoning summary').click();expect(page.locator('.reasoning-content')).to_contain_text('Fixture reasoning');assert page.evaluate('window.__probe.reasoning')==1
 page.locator('.reasoning summary').click();page.evaluate('window.__resetProbe();window.__patch({reasoning:"Fixture reasoning updated $x^4$."})');page.wait_for_timeout(120);assert page.evaluate('window.__probe.reasoning')==0
 page.locator('.reasoning summary').click();expect(page.locator('.reasoning-content')).to_contain_text('updated');assert page.locator('.reasoning-content math').count()==1;page.locator('.reasoning summary').click()
 checks.append('opening reasoning renders the latest text; closed updates do no parsing')
 page.evaluate(r'window.__svg=document.querySelector(".inline-artifact svg[role=img]");window.__second=document.querySelector("[data-series=\"1\"]")')
 figure.locator('.chart-legend button').first.click();assert page.evaluate(r'window.__svg===document.querySelector(".inline-artifact svg[role=img]")&&window.__second===document.querySelector("[data-series=\"1\"]")')
 checks.append('series toggles reconcile the SVG and preserve unchanged series nodes')
 figure.locator('[data-inline-tab=data]').click();figure.locator('[aria-label="Filter artifact table"]').fill('Two');expect(figure.locator('tbody tr')).to_have_count(1)
 figure.locator('[data-inline-tab=source]').click();figure.locator('[data-inline-tab=preview]').click();expect(figure.locator('.chart-legend button').first).to_have_attribute('aria-pressed','false');assert page.evaluate(r'window.__svg===document.querySelector(".inline-artifact svg[role=img]")')
 figure.locator('[data-inline-tab=data]').click();expect(figure.locator('[aria-label="Filter artifact table"]')).to_have_value('Two');expect(figure.locator('tbody tr')).to_have_count(1)
 checks.append('Preview, Data and Source reuse at most three retained views including filter and series state')
 mounts=page.evaluate('window.__probe.mounts');figure.locator('[data-inline-tab=data]').click();assert page.evaluate('window.__probe.mounts')==mounts
 figure.locator('.inline-fold').click();expect(figure.locator('.inline-artifact-stage')).to_be_hidden();figure.locator('.inline-fold').click();expect(figure.locator('[aria-label="Filter artifact table"]')).to_have_value('Two')
 checks.append('active-view clicks and collapsing static figures do not rebuild their content')
 # A real opaque HTML frame must be stopped when its preview is left, never
 # merely hidden with a claim that its script is suspended.
 tools=page.evaluate('window.__get().tools');a={'id':'html-fixture','rootId':'html-fixture','version':1,'name':'sample.html','title':'Fixture HTML','kind':'html','mime':'text/html','data':'','source':'<p>Neutral HTML</p><input id="value" value="7"><script>window.marker=7</script>'};tools.append(dict(tools[0],id='html-tool',artifacts=[a]))
 page.evaluate('(tools)=>window.__patch({tools})',tools);htmlfigure=page.locator('.inline-artifact').nth(1);htmlfigure.scroll_into_view_if_needed();expect(htmlfigure.locator('iframe')).to_be_visible()
 assert htmlfigure.frame_locator('iframe').locator('body').evaluate('(e)=>getComputedStyle(e).backgroundColor')=='rgba(0, 0, 0, 0)'
 # Actual composited pixels, not only computed body styles: a mismatched
 # iframe/root color-scheme makes Chromium paint an opaque white canvas.
 assert htmlfigure.frame_locator('iframe').locator('html').evaluate('(e)=>getComputedStyle(e).colorScheme')=='dark'
 canvas=Image.open(io.BytesIO(htmlfigure.locator('iframe').screenshot()));assert canvas.getpixel((20,220))[:3]==(30,30,30),canvas.getpixel((20,220))
 checks.append('the composited HTML canvas matches the neutral transcript rather than turning white')
 htmlfigure.locator('.inline-interact').click();expect(htmlfigure.frame_locator('iframe').locator('#value')).to_be_visible();assert htmlfigure.locator('iframe').get_attribute('sandbox')=='allow-scripts'
 htmlfigure.locator('[data-inline-tab=source]').click();assert htmlfigure.locator('iframe').count()==0;htmlfigure.locator('[data-inline-tab=preview]').click();assert htmlfigure.locator('iframe').get_attribute('sandbox')==''
 checks.append('HTML defaults to transparent and leaving an interactive preview actually terminates its frame')
 page.locator('[data-action=view]').click();expect(page.locator('#view-dialog')).to_be_visible();page.evaluate('window.__resetProbe();window.__patch({content:"Modal update queued."});');page.wait_for_timeout(100)
 assert page.evaluate('window.__probe.markdown')==0;assert 'Modal update queued.' not in page.locator('.response-flow').inner_text()
 page.locator('#view-math').uncheck();page.locator('#view-math').check();page.keyboard.press('Escape');expect(page.locator('.response-flow')).to_contain_text('Modal update queued.')
 checks.append('modal controls remain usable above lazy frames while transcript updates wait until dismissal')
 # Simulate visibility without making claims about Windows battery measurements.
 page.evaluate('window.__resetProbe();Object.defineProperty(document,"hidden",{configurable:true,value:true});document.dispatchEvent(new Event("visibilitychange"));window.__patch({content:"Background change pending."});');page.wait_for_timeout(120)
 assert page.evaluate('window.__probe.markdown')==0;assert 'Background change pending.' not in page.locator('.response-flow').inner_text()
 page.evaluate('delete document.hidden;document.dispatchEvent(new Event("visibilitychange"));');expect(page.locator('.response-flow')).to_contain_text('Background change pending.')
 checks.append('hidden-window transcript rendering is deferred and catches up to the latest snapshot on visibility')
 page.evaluate('window.__patch({content:"final "+"x".repeat(40000),status:"streaming"});window.__patch({content:"Final exact text.",status:"stopped",error:"Stopped."});')
 expect(page.locator('.response-flow')).to_contain_text('Final exact text.');expect(page.locator('.response-activity')).to_have_count(0)
 checks.append('coalesced streaming preserves final and cancellation states without dropping text')
 # New thread ensures a clean root and lets initial off-screen work be counted.
 page.keyboard.press('Control+n');page.evaluate('window.__resetProbe();window.__seed(24)');page.wait_for_timeout(250)
 assert page.locator('.inline-artifact').count()==24;assert page.locator('.deferred-surface').count()>10;assert page.evaluate('window.__probe.mounts')<12
 checks.append('a long reply defers initial mounts of figures outside the viewport preload margin')
 first=page.locator('.inline-artifact').first;first.scroll_into_view_if_needed();expect(first.locator('svg[role=img]')).to_be_visible();page.locator('.inline-artifact').last.scroll_into_view_if_needed();expect(page.locator('.inline-artifact').last.locator('svg[role=img]')).to_be_visible()
 assert page.locator('.deferred-surface').count()>0
 checks.append('scrolling to a deferred visualization mounts it on demand without eagerly drawing the entire history')
 first.scroll_into_view_if_needed();first.locator('[data-inline-tab=data]').focus();page.keyboard.press('ArrowRight');expect(first.locator('[data-inline-tab=source]')).to_be_focused()
 checks.append('quiet inline controls remain keyboard accessible')
 page.set_viewport_size({'width':720,'height':880});first.scroll_into_view_if_needed();assert first.evaluate('(e)=>e.getBoundingClientRect().right')<=720
 assert not errors,errors;assert not [u for u in requests if u.startswith(('http:','https:'))],requests
 checks.append('neutral inline layout fits a narrow window without external requests or JavaScript errors')
 b.close()
(root/'docs/ui-seamless-checks.json').write_text(json.dumps({'checks':len(checks),'passed':checks,'errors':errors},indent=2));print(json.dumps({'checks':len(checks),'passed':checks,'errors':errors},indent=2))
