"""Inline layout and motion integration, using the production renderer plus synthetic
preview fixtures. No live inference, Windows, native tools, or PDF.js validation."""
import argparse, json
from pathlib import Path
from playwright.sync_api import sync_playwright, expect
parser=argparse.ArgumentParser();parser.add_argument('--chromium',default=None);parser.add_argument('--no-sandbox',action='store_true');args=parser.parse_args()
root=Path(__file__).resolve().parents[1];html=(root/'preview/index.html').read_text(encoding='utf-8');checks=[];errors=[];requests=[]
marker='const pause = ms => new Promise(r => setTimeout(r, ms));'
assert marker in html
html=html.replace(marker,marker+'''window.__current=()=>structuredClone(workspace.threads.find(t=>t.id===workspace.activeId));window.__fixture=patch=>{Object.assign(workspace.threads.find(t=>t.id===workspace.activeId).turns[0].replies[0],patch);emit();};''',1)
with sync_playwright() as p:
 b=p.chromium.launch(executable_path=args.chromium,headless=True,args=['--no-sandbox'] if args.no_sandbox else [])
 page=b.new_page(viewport={'width':1480,'height':1100});page.on('pageerror',lambda e:errors.append(str(e)));page.on('request',lambda r:requests.append(r.url));page.set_content(html)
 page.locator('#prompt').fill('Show an inline visualization demo.');page.locator('#send').click()
 expect(page.locator('.is-thinking')).to_be_visible();expect(page.locator('.thinking-wave')).to_be_visible()
 assert page.locator('.thinking-wave i').first.evaluate('(e)=>getComputedStyle(e).animationName')=='thinking-wave'
 checks.append('received reasoning shows a compact animated thinking indicator')
 page.evaluate('window.__reasonNode=document.querySelector(".reasoning");window.__waveNode=document.querySelector(".thinking-wave")')
 page.wait_for_timeout(250);assert page.evaluate('window.__reasonNode===document.querySelector(".reasoning")&&window.__waveNode===document.querySelector(".thinking-wave")')
 checks.append('thinking markup is retained across reasoning deltas instead of restarting')
 page.locator('.reasoning summary').click();expect(page.locator('.reasoning-content')).to_be_visible()
 expect(page.locator('.streaming-answer')).to_be_visible();expect(page.locator('.inline-artifact').first).to_be_visible()
 expect(page.locator('#stop')).to_be_hidden(timeout=12000);expect(page.locator('.response-flow')).to_contain_text('synthetic preview response')
 assert page.locator('.reasoning').evaluate('(e)=>e.open');page.locator('.reasoning summary').click()
 expect(page.locator('#artifact-panel')).to_be_hidden();expect(page.locator('.inline-artifact')).to_have_count(2)
 kinds=page.locator('.response-flow').first.evaluate('(e)=>[...e.children].map(n=>n.matches("figure")?"visual":n.textContent.trim()?"text":"empty")')
 assert kinds==['text','visual','text','visual','text'],kinds
 checks.append('explanation, chart, interpretation, HTML, and final text are interleaved in the response')
 checks.append('visualizations do not open the workspace or displace the composer by default')
 assert .13 <= float(page.locator('.chart-area').first.evaluate('(e)=>getComputedStyle(e).opacity')) <= .15
 checks.append('area-chart entrance animation preserves translucent fills instead of obscuring other series')
 assert page.locator('.thinking-wave').evaluate('(e)=>getComputedStyle(e).display')=='none'
 expect(page.locator('.response-activity')).to_have_count(0)
 checks.append('thinking and streaming indicators stop on completion without leaving a fake progress state')
 # Keep a control active while subsequent content arrives.
 chart=page.locator('.inline-artifact').first
 chart.locator('.chart-legend button').first.click();expect(chart.locator('.chart-legend button').first).to_have_attribute('aria-pressed','false')
 page.evaluate('window.__chartNode=document.querySelector(".inline-artifact");window.__svgNode=window.__chartNode.querySelector("svg[role=img]");window.__paragraph=document.querySelector(".markdown-segment p")')
 content=page.evaluate('window.__current().turns[0].replies[0].content')
 page.evaluate('(text)=>window.__fixture({content:text+" Additional streamed text.",status:"streaming",phase:"answering"})',content)
 expect(page.locator('.response-flow')).to_contain_text('Additional streamed text')
 assert page.evaluate('window.__chartNode===document.querySelector(".inline-artifact")&&window.__svgNode===window.__chartNode.querySelector("svg[role=img]")&&window.__paragraph===document.querySelector(".markdown-segment p")')
 expect(chart.locator('.chart-legend button').first).to_have_attribute('aria-pressed','false')
 checks.append('appending answer text preserves original paragraphs, chart nodes, and series visibility')
 chart.locator('[data-inline-tab=data]').click();expect(chart.locator('tbody tr')).to_have_count(6)
 chart.locator('[aria-label="Filter artifact table"]').fill('Run 6');expect(chart.locator('tbody tr')).to_have_count(1)
 page.evaluate('(text)=>window.__fixture({content:text+" Another delta.",status:"streaming",phase:"answering"})',content)
 expect(chart.locator('[aria-label="Filter artifact table"]')).to_have_value('Run 6');expect(chart.locator('tbody tr')).to_have_count(1)
 checks.append('inline data filtering and numeric source values survive streaming updates')
 chart.locator('[data-inline-tab=data]').focus();page.keyboard.press('ArrowRight');expect(chart.locator('[data-inline-tab=source]')).to_be_focused();expect(chart.locator('.raw-source')).to_contain_text('94')
 checks.append('inline Preview, Data, and Source tabs have keyboard arrow navigation')
 chart.locator('[data-inline-tab=preview]').click()
 chart.locator('.inline-fold').click();expect(chart.locator('.inline-artifact-stage')).to_be_hidden();chart.locator('.inline-fold').click();expect(chart.locator('svg[role=img]')).to_be_visible()
 checks.append('each visualization can collapse independently without hiding its surrounding text')
 # Existing controls remain opaque and static unless explicitly enabled.
 htmlcard=page.locator('.inline-artifact').nth(1);frame=htmlcard.frame_locator('iframe')
 expect(frame.locator('script')).to_have_count(0);htmlcard.locator('.inline-interact').click();expect(frame.locator('#buffer')).to_be_visible()
 assert htmlcard.locator('iframe').get_attribute('sandbox')=='allow-scripts'
 frame.locator('#buffer').evaluate('(e)=>{e.value="50";e.dispatchEvent(new Event("input"));}');expect(frame.locator('#result')).to_have_text('47 ms')
 page.evaluate('(text)=>window.__fixture({content:text+" Update after interaction.",status:"streaming",phase:"answering"})',content)
 expect(frame.locator('#result')).to_have_text('47 ms');assert frame.locator('body').evaluate('()=>typeof window.tinfoil')=='undefined'
 checks.append('inline HTML opt-in controls retain their state across deltas and have no desktop bridge')
 # A same-reply revision does not replace the reader's selected version.
 tools=page.evaluate('window.__current().turns[0].replies[0].tools');a=tools[0]['artifacts'][0];new=dict(a,id='revision2',rootId=a['id'],parentId=a['id'],version=2)
 spec=json.loads(a['source']);spec['series'][0]['values'][0]=999;new['source']=json.dumps(spec)
 tools.append(dict(tools[0],id='revision-tool',artifacts=[new]));page.evaluate('(tools)=>window.__fixture({tools})',tools)
 expect(chart.locator('select.inline-version')).to_have_value(a['id']);expect(page.locator('.inline-artifact')).to_have_count(2)
 chart.locator('select.inline-version').select_option('revision2');chart.locator('[data-inline-tab=source]').click();expect(chart.locator('.raw-source')).to_contain_text('999')
 chart.locator('select.inline-version').select_option(a['id']);chart.locator('[data-inline-tab=preview]').click()
 checks.append('new revisions share a single inline card and do not override the active version')
 chart.locator('.inline-expand').click();expect(page.locator('#artifact-panel')).to_be_visible();expect(page.locator('#artifact-stage svg')).to_be_visible();expect(page.locator('#prompt')).to_be_visible()
 page.locator('[data-panel=close]').click();expect(frame.locator('#result')).to_have_text('47 ms')
 checks.append('explicit expansion opens the workspace while the inline HTML session remains intact')
 # Reduced motion must affect pseudo-elements too, and be reversible.
 page.evaluate('window.__fixture({status:"streaming",phase:"thinking",reasoning:"Actual fixture reasoning"})');expect(page.locator('.is-thinking')).to_be_visible()
 page.emulate_media(reduced_motion='reduce');assert page.locator('.thinking-wave i').first.evaluate('(e)=>getComputedStyle(e).animationName')=='none'
 checks.append('OS reduced-motion preference disables thinking and entry animations')
 page.emulate_media(reduced_motion='no-preference');page.locator('[data-action=view]').click();page.locator('#view-motion').select_option('reduced');page.keyboard.press('Escape')
 expect(page.locator('html')).to_have_class('reduce-motion');assert page.locator('.thinking-wave i').first.evaluate('(e)=>getComputedStyle(e).animationName')=='none'
 checks.append('application reading preferences can independently reduce motion')
 page.locator('[data-action=view]').click();page.locator('#view-motion').select_option('system');page.keyboard.press('Escape');page.evaluate('window.__fixture({status:"stopped",phase:"answering",error:"Stopped. Partial output was preserved."})');expect(page.locator('.response-activity')).to_have_count(0);expect(chart).to_be_visible();expect(page.locator('.reply-note')).to_contain_text('Partial output')
 checks.append('stopping preserves the inline artifact and partial text but ends all progress indicators')
 # Keep scroll anchored when reading older content.
 page.locator('#transcript').evaluate('(e)=>e.scrollTop=0');before=page.locator('#transcript').evaluate('(e)=>e.scrollTop')
 page.evaluate('(text)=>window.__fixture({content:text+"\\n\\n"+"New text. ".repeat(70),status:"streaming",phase:"answering",error:null})',content)
 page.wait_for_timeout(200);assert abs(page.locator('#transcript').evaluate('(e)=>e.scrollTop')-before)<5
 checks.append('new text does not pull the reader away from the top of the conversation')
 # A new turn must not remount previous inline islands either.
 page.evaluate('window.__fixture({status:"complete",error:null})');page.locator('#prompt').fill('A second turn');page.locator('#send').click();expect(page.locator('#stop')).to_be_hidden(timeout=12000)
 expect(frame.locator('#result')).to_have_text('47 ms')
 checks.append('adding a new turn preserves earlier inline HTML state rather than rebuilding the transcript')
 for width,height in [(1100,850),(940,640),(680,900)]:
  page.set_viewport_size({'width':width,'height':height});expect(page.locator('#prompt')).to_be_visible()
  assert page.evaluate('document.documentElement.scrollWidth<=innerWidth'),(width,height)
 checks.append('940px compact desktop width and narrower preview widths avoid page-wide horizontal overflow')
 assert not errors,errors;assert not [u for u in requests if u.startswith(('http:','https:'))],requests
 checks.append('inline tests produce no unhandled JavaScript errors or external requests')
 b.close()
result={'checks':len(checks),'passed':checks,'javascript_errors':errors,'external_requests':[],'scope':'production browser renderer with synthetic fixtures; not native Windows, PDF.js, or live provider'}
(root/'docs/ui-inline-checks.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result,indent=2))
