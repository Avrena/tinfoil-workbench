"""v0.4 renderer integration; production UI + synthetic in-memory fixtures.
Does not validate live Tinfoil, Electron printing, Windows, or real PDF.js.
"""
import argparse,base64,json
from pathlib import Path
from playwright.sync_api import sync_playwright, expect
parser=argparse.ArgumentParser();parser.add_argument('--chromium',default=None);parser.add_argument('--no-sandbox',action='store_true');args=parser.parse_args()
root=Path(__file__).resolve().parents[1];html=(root/'preview/index.html').read_text(encoding='utf-8');checks=[];errors=[];requests=[]
marker='const pause = (ms) => new Promise((r) => setTimeout(r, ms));'
assert marker in html
html=html.replace(marker,marker+'''window.__fixture = patch => { const t=workspace.threads.find(t=>t.id===workspace.activeId);Object.assign(t.turns[0].replies[0],patch);emit();};window.__current=()=>structuredClone(workspace.threads.find(t=>t.id===workspace.activeId));''',1)
with sync_playwright() as p:
 opts={'headless':True}
 if args.chromium:opts['executable_path']=args.chromium
 if args.no_sandbox:opts['args']=['--no-sandbox']
 b=p.chromium.launch(**opts);page=b.new_page(viewport={'width':1520,'height':1040});page.on('pageerror',lambda e:errors.append(str(e)));page.on('request',lambda r:requests.append(r.url));page.set_content(html)
 expect(page.locator('#artifact-panel')).to_be_hidden();page.keyboard.press('Control+Shift+a');expect(page.locator('#artifact-panel')).to_be_visible();expect(page.locator('.artifact-empty')).to_be_visible();expect(page.locator('.artifact-panel-tools')).to_be_hidden();page.keyboard.press('Control+Shift+a')
 checks.append('artifact workspace is hidden initially and available through keyboard navigation')
 page.locator('#prompt').fill('Show the repair observations as a chart, table and interactive calculator.');page.locator('#send').click();expect(page.locator('#stop')).to_be_hidden(timeout=10000);expect(page.locator('#artifact-panel')).to_be_hidden();page.locator('.inline-expand').first.click();expect(page.locator('#artifact-stage svg')).to_be_visible();expect(page.locator('#prompt')).to_be_visible()
 assert page.locator('.tool-activity').evaluate('(e)=>!e.open');assert page.locator('.inline-artifact').count()==4
 checks.append('visual artifacts render inline; expansion is explicit and tool details remain collapsed')
 page.locator('#artifact-panel .chart-legend button').first.click();expect(page.locator('#artifact-panel .chart-legend button').first).to_have_attribute('aria-pressed','false');page.locator('#prompt').fill('Draft update');page.wait_for_timeout(700);expect(page.locator('#artifact-panel .chart-legend button').first).to_have_attribute('aria-pressed','false')
 checks.append('chart series visibility survives streamed workspace snapshots')
 page.locator('#artifact-panel .chart-legend button').first.click();page.locator('[data-panel=data]').click();expect(page.locator('#artifact-panel .data-table-wrap tbody tr')).to_have_count(3);page.locator('#artifact-panel [aria-label="Filter artifact table"]').fill('Round 2');expect(page.locator('#artifact-panel .data-table-wrap tbody tr')).to_have_count(1);page.locator('#artifact-panel [aria-label="Filter artifact table"]').fill('');page.locator('#artifact-panel [data-column="1"]').click();expect(page.locator('#artifact-panel th[aria-sort=ascending]')).to_have_count(1)
 checks.append('chart underlying data are searchable and sortable without executing model code')
 page.locator('[data-panel=source]').click();expect(page.locator('#artifact-stage')).to_contain_text('142');expect(page.locator('#artifact-stage svg')).to_have_count(0);page.locator('[data-panel=preview]').click()
 checks.append('source and rendered output remain separate views of the same artifact')
 page.locator('[data-panel=expand]').click();expect(page.locator('.main')).to_be_hidden();page.locator('[data-panel=expand]').click();expect(page.locator('.main')).to_be_visible()
 checks.append('expanded artifact view can return to the same split conversation')
 page.locator('#artifact-picker').select_option(label='Sample observations');page.locator('#artifact-panel [data-column="1"]').click();page.locator('#artifact-panel [data-column="1"]').click();expect(page.locator('#artifact-panel .data-table-wrap tbody tr').first).to_contain_text('218')
 checks.append('typed table artifacts sort numerical values rather than lexical strings')
 page.locator('#artifact-picker').select_option(label='Response workflow');expect(page.locator('#artifact-stage svg')).to_be_visible();page.locator('[data-panel=data]').click();expect(page.locator('#artifact-panel .data-table-wrap tbody tr')).to_have_count(2)
 checks.append('diagram preview and directed-edge data are both available')
 page.locator('#artifact-picker').select_option(label='Buffer calculator');frame=page.frame_locator('#artifact-stage iframe');expect(frame.locator('script')).to_have_count(0);assert page.locator('#artifact-stage iframe').get_attribute('sandbox')=='';page.locator('[data-panel=interact]').click();expect(frame.locator('#buffer')).to_be_visible();assert page.locator('#artifact-stage iframe').get_attribute('sandbox')=='allow-scripts';frame.locator('#buffer').evaluate('(e)=>{e.value="40";e.dispatchEvent(new Event("input"));}');expect(frame.locator('#result')).to_have_text('252 seconds')
 checks.append('HTML is static until explicit per-preview opt-in, after which inline controls actually run')
 assert frame.locator('body').evaluate('()=>typeof window.tinfoil')=='undefined'
 assert frame.locator('body').evaluate('()=>{try{return !!parent.document}catch{return false}}') is False
 assert frame.locator('body').evaluate('()=>{try{localStorage.setItem("x","1");return true}catch{return false}}') is False
 checks.append('interactive child has an opaque origin, no desktop bridge and no parent DOM or localStorage access')
 page.locator('#prompt').fill('Another draft');page.wait_for_timeout(700);expect(frame.locator('#result')).to_have_text('252 seconds');page.locator('[data-panel=interact]').click();expect(frame.locator('script')).to_have_count(0)
 checks.append('interactive state survives conversation snapshots and Stop interaction removes executable content')
 # A new immutable version arrives while the reader is viewing its parent.
 tools=page.evaluate('window.__current().turns[0].replies[0].tools');first=tools[0]['artifacts'][0];version=dict(first,id='fixture-revision-2',parentId=first['id'],rootId=first['id'],version=2);spec=json.loads(first['source']);spec['series'][0]['values'][0]=150;version['source']=json.dumps(spec);tools.append(dict(tools[0],id='fixture-revision-tool',callId='fixture-revision-call',artifacts=[version]));page.locator('#artifact-picker').select_option(label='Repair duration');page.evaluate('(tools)=>window.__fixture({tools})',tools);expect(page.locator('#artifact-version')).to_be_visible();expect(page.locator('#artifact-version')).to_have_value(first['id']);page.locator('#artifact-version').select_option('fixture-revision-2');page.locator('[data-panel=source]').click();expect(page.locator('#artifact-stage')).to_contain_text('150');page.locator('#artifact-version').select_option(first['id']);page.locator('[data-panel=source]').click();expect(page.locator('#artifact-stage')).to_contain_text('142')
 checks.append('arrival of a revision preserves the reader’s current version and exposes both source revisions')
 page.locator('[data-panel=close]').click();page.locator('#prompt').fill('Do not reopen');page.wait_for_timeout(700);expect(page.locator('#artifact-panel')).to_be_hidden()
 checks.append('closing the panel is respected by later snapshots in the same turn')
 page.keyboard.press('Control+n');page.keyboard.press('Control+Shift+a');expect(page.locator('.artifact-empty')).to_be_visible();expect(page.locator('#artifact-picker option')).to_have_count(0);page.locator('[data-panel=close]').click()
 checks.append('changing conversations clears the previous artifact selector without sharing artifacts across threads')
 page.locator('#composer-model').click();page.locator('#quick-model').fill('deepseek-v4-pro');page.locator('#model-form button[type=submit]').click();expect(page.locator('#quick-effort')).to_be_visible();page.locator('#quick-effort').click();expect(page.locator('#effort-panel')).to_be_visible();expect(page.locator('#effort-slider')).to_be_focused();assert page.locator('#effort-stops button').all_text_contents()==['Default','High','Max'];assert page.locator('#effort-slider').input_value()=='0';page.locator('#effort-slider').fill('2');assert page.evaluate('window.__current().settings.reasoningEffort')=='max'
 gauge=page.locator('#effort-gauge svg');expect(gauge).to_have_attribute('data-level','2');expect(gauge).to_have_class('active');expect(page.locator('#quick-effort')).to_have_attribute('title','Thinking effort: Max')
 expect(page.locator('#effort-value')).to_have_text('Max');page.locator('#effort-stops button').first.click();expect(gauge).to_have_attribute('data-level','0');expect(gauge).not_to_have_class('active')
 page.locator('#effort-slider').fill('2');page.keyboard.press('Escape');expect(page.locator('#effort-panel')).to_be_hidden();expect(page.locator('#quick-effort')).to_be_focused()
 checks.append('DeepSeek V4 profile exposes only its Tinfoil high/max effort choices and provider default')
 checks.append('the gauge opens a slider over the levels of the model; sliding or a stop sets the effort, the gauge fills and is highlighted unless the provider default is used, and Escape closes it')
 page.locator('#composer-model').click();page.locator('#quick-model').fill('kimi-k3');page.locator('#model-form button[type=submit]').click();expect(page.locator('#quick-effort')).to_be_hidden();assert page.evaluate('window.__current().settings.reasoningEffort')=='default';page.locator('.toolbar [data-action=inspector]').click();expect(page.locator('#reasoning-controls')).to_be_hidden();expect(page.locator('#thinking-controls')).to_be_hidden();expect(page.locator('#capability-note')).to_contain_text('No adjustable thinking control')
 checks.append('Kimi K3 profile hides unsupported generation controls and model switching clears earlier effort overrides')
 # Pending Advanced edits must not let the compact picker display an unsaved override.
 page.locator('#composer-model').click();page.locator('#quick-model').fill('deepseek-v4-pro');page.locator('#model-form button[type=submit]').click();page.locator('#instructions').fill('Unsaved');page.locator('#quick-effort').click();page.locator('#effort-slider').fill('2');expect(page.locator('#effort-slider')).to_have_value('0');expect(page.locator('#toast')).to_contain_text('Apply pending Advanced');page.keyboard.press('Escape')
 checks.append('pending advanced edits cannot silently change the quick effort control')
 page.locator('#apply-settings').click();page.locator('#inspector [data-action=inspector]').click();page.locator('#prompt').fill('Create the sample');page.locator('#send').click();expect(page.locator('#stop')).to_be_hidden(timeout=10000)
 page.locator('.inline-expand').first.click();page.locator('[data-panel=save]').click();expect(page.locator('#toast')).to_contain_text('Offline preview');page.locator('[data-panel=pdf]').click();expect(page.locator('#toast')).to_contain_text('Offline preview')
 checks.append('offline fixtures do not pretend to save files or produce native PDFs')
 # The real PDF library is deliberately not faked. A local fixture tests the missing-module error only.
 pdf={'id':'pdf-fixture','name':'sample.pdf','mime':'application/pdf','data':base64.b64encode(b'%PDF-1.7\nfixture').decode()};tool={'id':'pdf-tool','callId':'pdf-call','name':'create_artifact','arguments':'{}','origin':'model','status':'complete','stdout':'','stderr':'','exitCode':0,'elapsedMs':0,'artifacts':[pdf],'truncated':False}
 page.evaluate('(tool)=>window.__fixture({tools:[tool]})',tool);page.locator('.inline-expand').first.click();expect(page.locator('#artifact-stage')).to_contain_text('Run npm run bootstrap',timeout=10000)
 checks.append('missing PDF.js fails visibly instead of claiming a rendered PDF (real library not tested here)')
 # PDF.js 6 supports Chromium 125 and newer; an older engine is named before PDF.js is loaded.
 page.evaluate("()=>{window.__supports=CSS.supports.bind(CSS);CSS.supports=(p,v)=>p==='width'&&String(v).startsWith('round(')?false:window.__supports(p,v)}")
 page.evaluate('(tool)=>window.__fixture({tools:[tool]})',{**tool,'id':'pdf-tool-old','artifacts':[{**pdf,'id':'pdf-old-engine'}]});page.locator('.inline-expand').first.click();expect(page.locator('#artifact-stage')).to_contain_text('Chromium 125',timeout=10000);expect(page.locator('#artifact-stage')).not_to_contain_text('npm run bootstrap');page.evaluate('()=>{CSS.supports=window.__supports}')
 checks.append('a browser engine older than PDF.js supports is named instead of reported as a missing PDF.js')
 page.locator('[data-panel=close]').click();page.keyboard.press('Control+Shift+f');expect(page.locator('#artifact-panel')).to_be_hidden();expect(page.locator('#prompt')).to_be_visible();page.keyboard.press('Control+Shift+f')
 checks.append('focus mode still leaves the composer visible after artifact use')
 assert not errors,errors;assert not [u for u in requests if u.startswith(('http:','https:'))],requests
 checks.append('visualization tests produced no unhandled JavaScript errors or external requests')
 b.close()
result={'checks':len(checks),'passed':checks,'javascript_errors':errors,'external_requests':[], 'scope':'synthetic browser renderer; not live inference, Windows, native printing, or real PDF.js'}
(root/'docs/ui-artifact-checks.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result,indent=2))
