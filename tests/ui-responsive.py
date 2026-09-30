"""Touch and viewport emulation, not physical devices or a native mobile app.
Includes keyboard-height simulation; does not claim real iOS/Android keyboard tests.
"""
import argparse,json
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
parser=argparse.ArgumentParser();parser.add_argument('--chromium',default=None);args=parser.parse_args()
root=Path(__file__).resolve().parents[1];html=(root/'preview/index.html').read_text(encoding='utf-8');checks=[];errors=[];matrix=[]
marker='const pause = (ms) => new Promise((r) => setTimeout(r, ms));'
fixture=r'''window.__inspect=()=>structuredClone(workspace);
window.__seed=()=>{
 const {chartSpec,chartSVG,tableSpec,tableHTML}=require('/core/visual-tools.js');
 const t=workspace.threads.find(t=>t.id===workspace.activeId);t.title='Repair measurements and revised timing';
 const project={id:'project-design',name:'Workbench design',createdAt:Date.now()};workspace.projects=[project];t.projectId=project.id;
 const intro='The revised configuration is faster in these six **synthetic sample runs**. Both series use the same scale.\n\n';
 const body='\n\nThe largest gap is in run 6. Use Data to inspect the values. This preview is not a measured performance claim.\n\n';
 const chart=chartSpec({title:'Response time',description:'Synthetic preview data · lower is faster.',type:'line',labels:['Run 1','Run 2','Run 3','Run 4','Run 5','Run 6'],y_label:'Milliseconds',series:[{name:'Baseline',values:[48,62,56,79,70,94]},{name:'Revised',values:[36,43,39,51,48,61]}]});
 const table=tableSpec({title:'Measurement details',columns:['Measurement','Observed milliseconds','Revised milliseconds','Dataset description'],rows:[['Measurement-one-with-a-long-name',48,36,'Synthetic local fixture'],['Measurement two',62,43,'Synthetic local fixture']]});
 const tools=[previewTool('chart',JSON.stringify(chart),chartSVG(chart),'Response time',intro.length),previewTool('table',JSON.stringify(table),tableHTML(table),'Measurement details',intro.length+body.length,'text/html')];
 t.turns=[{id:'responsive-turn',prompt:'Compare the measurements, then show the underlying data.',attachments:[],createdAt:Date.now(),selectedReplyId:'responsive-reply',replies:[{id:'responsive-reply',model:'demo/writer',content:intro+body+'\n\nA transparent visualization should sit naturally within the explanation.\n\n```python\nvalues = [48, 62, 56, 79, 70, 94]\nprint(sum(values) / len(values))\n```',reasoning:'Synthetic returned reasoning. Keep both series comparable and distinguish observations from assumptions.',status:'complete',finishReason:'stop',error:null,usage:null,elapsedMs:1200,tools,toolMessages:[]}]}];emit();
};
window.__longNames=()=>{const t=workspace.threads.find(t=>t.id===workspace.activeId);t.title='Long thread name '.repeat(7);workspace.projects[0].name='A longer project name for a narrow viewport '.repeat(2).slice(0,80);t.settings.model='example/model-name-with-an-extremely-long-identifier';emit();};
window.__thinking=()=>{const t=workspace.threads.find(t=>t.id===workspace.activeId),r=t.turns[0].replies[0];r.status='streaming';r.phase='thinking';busy=t.id;emit();};
window.__done=()=>{workspace.threads.find(t=>t.id===workspace.activeId).turns[0].replies[0].status='complete';busy=null;emit();};
'''
assert marker in html;html=html.replace(marker,marker+fixture,1)
with sync_playwright() as p:
 b=p.chromium.launch(executable_path=args.chromium,headless=True,args=['--no-sandbox'])
 sizes=[('phone-small',320,740),('phone-android',360,800),('phone',390,844),('phone-large',430,932),('tablet-portrait',768,1024),('tablet-large',820,1180),('tablet-landscape',1024,768),('tablet-wide',1280,800)]
 for name,w,h in sizes:
  context=b.new_context(viewport={'width':w,'height':h},is_mobile=True,has_touch=True,device_scale_factor=1);page=context.new_page();page.on('pageerror',lambda e:errors.append(str(e)))
  page.set_content(html);page.evaluate('window.__seed()');expect(page.locator('.inline-artifact')).to_have_count(2);page.locator('#transcript').evaluate('(e)=>e.scrollTop=0');page.wait_for_timeout(250)
  assert page.evaluate('document.documentElement.scrollWidth<=innerWidth+1');assert page.locator('.main').bounding_box()['width']<=w;checks.append(f'{name}: transcript and header fit {w}×{h} without page overflow')
  chart=page.locator('.inline-artifact').first;chart.locator('svg[role=img]').scroll_into_view_if_needed();page.wait_for_timeout(100)
  pixels=chart.locator('svg[role=img]').evaluate("svg=>{const t=[...svg.querySelectorAll('text')].find(t=>t.textContent.trim());return Number(t.getAttribute('font-size'))*svg.getScreenCTM().a;}");assert pixels>=9,(name,pixels);checks.append(f'{name}: chart labels remain at least 9 CSS pixels at actual render scale')
  chart.locator('[data-inline-tab=data]').tap();expect(chart.locator('table')).to_be_visible();chart.locator('[data-inline-tab=preview]').tap();chart.locator('.chart-legend button').first.tap();expect(chart.locator('.chart-legend button').first).to_have_attribute('aria-pressed','false');checks.append(f'{name}: chart view tabs and series toggles respond to touch-sized controls')
  page.locator('.inline-artifact').last.scroll_into_view_if_needed();expect(page.locator('.inline-artifact').last.locator('table')).to_be_visible();assert page.evaluate('document.documentElement.scrollWidth<=innerWidth+1');checks.append(f'{name}: wide tables scroll inside their visualization, not the page')
  page.locator('[data-action=edit-reply]').tap();page.locator('#inline-content').fill('A revised answer for the touch editor.\n\n中文输入 and **Markdown**.')
  expect(page.locator('#inline-content')).to_have_value('A revised answer for the touch editor.\n\n中文输入 and **Markdown**.')
  page.locator('[data-action=inline-save]').scroll_into_view_if_needed();save=page.locator('[data-action=inline-save]').bounding_box();area=page.locator('#inline-content').bounding_box()
  assert save['y']>=0 and save['y']+save['height']<=h+1 and save['x']+save['width']<=w+1 and area['height']>=60 and area['x']+area['width']<=w+1,(name,save,area);assert page.evaluate('document.documentElement.scrollWidth<=innerWidth+1')
  checks.append(f'{name}: the answer editor fits in place, keeps Unicode text and reaches Save without widening the page')
  page.locator('#inline-content').press('Escape');expect(page.locator('.inline-editor-discard')).to_be_visible();page.locator('[data-action=inline-discard]').tap();expect(page.locator('.inline-editor')).to_have_count(0)
  page.locator('[data-action=edit-reply]').first.tap();page.locator('#inline-content').fill('A second version of the answer.');page.locator('[data-action=inline-save]').tap();expect(page.locator('.reply .version-pager')).to_be_visible()
  page.locator('.reply-footer').first.scroll_into_view_if_needed();outside=page.evaluate("()=>{const f=document.querySelector('.reply-footer').getBoundingClientRect();return [...document.querySelectorAll('.reply-footer .reply-actions > *')].filter(e=>{const r=e.getBoundingClientRect();return r.right>f.right+1||r.left<f.left-1;}).map(e=>e.getAttribute('aria-label')||e.textContent)}")
  assert not outside and page.evaluate('document.documentElement.scrollWidth<=innerWidth+1'),(name,outside);checks.append(f'{name}: with version arrows, the reply actions wrap inside the reply instead of running past the screen')
  if w<=1000:
   page.locator('[data-action=sidebar]').tap();expect(page.locator('.sidebar')).to_be_visible();assert page.locator('.main').evaluate('(e)=>e.inert');page.locator('.sidebar [data-action=close-drawers]').tap();expect(page.locator('.sidebar')).to_be_hidden();page.locator('[data-action=sidebar]').tap();page.locator('#drawer-backdrop').tap(position={'x':w-8,'y':100});expect(page.locator('.sidebar')).to_be_hidden();assert not page.locator('.main').evaluate('(e)=>e.inert');checks.append(f'{name}: navigation opens as a modal drawer and dismisses without trapping the conversation')
   page.locator('.toolbar [data-action=inspector]').tap();expect(page.locator('#inspector')).to_be_visible();page.locator('#inspector [data-action=inspector]').tap();expect(page.locator('#inspector')).to_be_hidden();checks.append(f'{name}: advanced settings are reachable and dismissible on compact screens')
  chart.locator('.inline-expand').tap();expect(page.locator('#artifact-panel')).to_be_visible();assert page.locator('#artifact-panel').bounding_box()['width']<=w+1;page.locator('[data-panel=close]').tap();expect(page.locator('.main')).to_be_visible();checks.append(f'{name}: artifact inspection expands within the viewport and returns to chat')
  page.locator('#prompt').fill('First line');page.locator('#prompt').press('Enter');expect(page.locator('#prompt')).to_have_value('First line\n');assert page.locator('.turn').count()==1;checks.append(f'{name}: touch Enter inserts a newline instead of accidentally sending')
  page.evaluate('window.__longNames()');page.wait_for_timeout(150);assert page.evaluate('document.documentElement.scrollWidth<=innerWidth+1');checks.append(f'{name}: long thread, project and model names do not widen the app')
  page.evaluate('window.__thinking()');page.wait_for_timeout(150);stop=page.locator('#stop').bounding_box();assert stop and stop['x']>=0 and stop['x']+stop['width']<=w+1;page.evaluate('window.__done()');checks.append(f'{name}: streaming controls remain reachable with a long model name')
  matrix.append({'name':name,'width':w,'height':h,'touch':True,'chart_label_css_pixels':round(pixels,2)})
  context.close()
 # A thinking-effort picker fits beside the model on a phone (360px, as a 1080px screen at density 480, and 393px):
 # Send stays on the same row at its right end, and the name keeps 50px: phone system fonts are wider than this browser's.
 for width in (360,393):
  context=b.new_context(viewport={'width':width,'height':800},is_mobile=True,has_touch=True,device_scale_factor=1);page=context.new_page();page.on('pageerror',lambda e:errors.append(str(e)));page.set_content(html)
  page.locator('#composer-model').tap();page.locator('[data-quick-model="deepseek-v4-pro"]').first.tap();expect(page.locator('#quick-effort')).to_be_visible()
  row={k:page.locator(k).bounding_box() for k in ('#composer-model','#composer-model .model-label','#composer-instructions','#send','.composer-tools')}
  assert abs(row['#send']['y']-row['#composer-model']['y'])<=4 and row['#send']['x']>row['#composer-instructions']['x']+row['#composer-instructions']['width'],(width,row)
  assert row['#composer-model .model-label']['width']>=50 and row['#send']['x']+row['#send']['width']<=row['.composer-tools']['x']+row['.composer-tools']['width']+1,(width,row)
  context.close()
 checks.append('phone composer at 360 and 393px: with a thinking-effort picker, Send stays on its row at the right and the model name keeps 50px or more')
 # A model list longer than the picker scrolls; its rows keep their full height instead of overlapping.
 context=b.new_context(viewport={'width':360,'height':560},is_mobile=True,has_touch=True,device_scale_factor=1);page=context.new_page();page.on('pageerror',lambda e:errors.append(str(e)));page.set_content(html)
 page.locator('#composer-model').tap();expect(page.locator('#model-dialog')).to_be_visible()
 rows=page.evaluate("""()=>{const list=document.querySelector('#model-dialog .model-options');return {scrolls:list.scrollHeight>list.clientHeight+1,rows:[...list.querySelectorAll('.model-option')].map(r=>[Math.round(r.getBoundingClientRect().height),r.scrollHeight])}}""")
 assert rows['scrolls'] and all(h>=s-1 for h,s in rows['rows']),rows
 checks.append('phone model picker: a list longer than the dialog scrolls and every row keeps its full height')
 context.close()
 # A shrinking viewport approximates keyboard occupation; actual keyboards are not emulated.
 context=b.new_context(viewport={'width':390,'height':844},is_mobile=True,has_touch=True,device_scale_factor=1);page=context.new_page();page.on('pageerror',lambda e:errors.append(str(e)));page.set_content(html);page.evaluate('window.__seed()');page.locator('#prompt').fill('Draft before rotation');page.wait_for_timeout(160)
 page.set_viewport_size({'width':390,'height':420});page.wait_for_timeout(180);send=page.locator('#send').bounding_box();assert send['y']+send['height']<=420;checks.append('keyboard-height simulation: composer send control stays in the visible viewport')
 page.locator('[data-action=edit-draft]').tap();page.locator('#editor-content').fill('Draft retained across a shorter viewport and rotation.');page.wait_for_timeout(180);save=page.locator('#editor-save').bounding_box();assert save['y']+save['height']<=420;assert page.locator('#editor-content').bounding_box()['height']>=60;checks.append('keyboard-height simulation: fullscreen editor keeps a usable field and reachable Save')
 page.set_viewport_size({'width':844,'height':390});page.wait_for_timeout(180);expect(page.locator('#editor-content')).to_have_value('Draft retained across a shorter viewport and rotation.');save=page.locator('#editor-save').bounding_box();assert save['y']+save['height']<=390;page.locator('#editor-save').tap();expect(page.locator('#edit-dialog')).to_be_hidden();expect(page.locator('#prompt')).to_have_value('Draft retained across a shorter viewport and rotation.');checks.append('landscape rotation preserves an open editor and its unsent draft')
 # The instructions editor keeps its actions visible and on top when a keyboard leaves little of the dialog.
 page.set_viewport_size({'width':390,'height':420});page.wait_for_timeout(180);page.locator('#composer-instructions').tap();page.locator('[data-action=instructions-new]').tap()
 page.locator('#instructions-name').fill('Field notes');page.locator('#instructions-text').fill('Answer with short field notes.\n'*12)
 for size in [{'width':390,'height':420},{'width':844,'height':390}]:
  page.set_viewport_size(size);page.wait_for_timeout(180);page.locator('#instructions-text').focus()
  for control in ['#instructions-save','#instructions-use']:
   box=page.locator(control).bounding_box();assert box['y']>=0 and box['y']+box['height']<=size['height'],(size,control,box)
   assert page.evaluate("s=>{const e=document.querySelector(s),r=e.getBoundingClientRect();return document.elementFromPoint(r.left+r.width/2,r.top+r.height/2)?.closest('button')===e}",control),(size,control)
  assert page.locator('#instructions-text').bounding_box()['height']>=60
 checks.append('keyboard-height simulation: the instructions editor keeps Save and Use visible and on top in portrait and landscape')
 page.keyboard.press('Escape');page.locator('[data-action=instructions-discard]').tap();page.keyboard.press('Escape');expect(page.locator('#instructions-dialog')).to_be_hidden()
 page.set_viewport_size({'width':1280,'height':800});page.wait_for_timeout(150);expect(page.locator('.sidebar')).to_be_visible();page.set_viewport_size({'width':390,'height':844});page.wait_for_timeout(150);expect(page.locator('.sidebar')).to_be_hidden();assert page.evaluate('window.__inspect().view.sidebar') is True;checks.append('responsive drawers never overwrite the saved desktop sidebar preference')
 # Capture the actual responsive renderer, not a separate mock design.
 page.evaluate('window.__seed()');page.locator('#prompt').fill('');page.locator('#transcript').evaluate('(e)=>e.scrollTop=0');page.wait_for_timeout(250);page.screenshot(path=str(root/'docs/preview-phone.png'))
 page.locator('[data-action=edit-reply]').tap();page.locator('#inline-content').fill('The revised configuration is consistently faster in this **synthetic sample**.\n\nThe largest difference is in run 6: **94 ms → 61 ms**.\n\nUse the same scale for both series and inspect the original values before choosing a deadline.');page.wait_for_timeout(180);page.screenshot(path=str(root/'docs/editor-phone.png'));page.locator('#inline-content').press('Escape');page.locator('[data-action=inline-discard]').tap()
 page.locator('[data-action=sidebar]').tap();page.screenshot(path=str(root/'docs/navigation-phone.png'));page.keyboard.press('Escape')
 page.set_viewport_size({'width':820,'height':1180});page.locator('#transcript').evaluate('(e)=>e.scrollTop=0');page.wait_for_timeout(180);page.screenshot(path=str(root/'docs/preview-tablet.png'))
 page.locator('.reasoning summary').first.tap();page.locator('[data-action=edit-thinking]').first.tap();page.locator('#inline-reasoning').fill('My note: distinguish measured samples from an assumed deadline. Keep the comparison on a shared scale.');page.wait_for_timeout(180);page.screenshot(path=str(root/'docs/editor-tablet.png'));page.locator('#inline-reasoning').press('Escape');page.locator('[data-action=inline-discard]').tap()
 page.set_viewport_size({'width':1440,'height':1000});page.locator('#transcript').evaluate('(e)=>e.scrollTop=0');page.wait_for_timeout(180);page.screenshot(path=str(root/'docs/preview-desktop.png'))
 page.locator('[data-action=edit-reply]').tap();page.locator('#inline-content').fill('The sample supports a lower response time, not a universal performance guarantee.\n\n$$\\Delta t = 94 - 61 = 33\\;\\text{ms}$$');page.wait_for_timeout(180);page.screenshot(path=str(root/'docs/editor-desktop.png'));page.locator('#inline-content').press('Escape');page.locator('[data-action=inline-discard]').tap()
 # Android WebView 140 and later draw the page under the system bars and report them through Capacitor's
 # inset variables; older WebViews are padded natively and report 0. body's padding insets the shell, but
 # modal dialogs, the phone message editor and toasts are laid out against the whole screen, where a control
 # under the status bar cannot be tapped. The insets model a phone's status and navigation bars, a landscape
 # layout with a side navigation bar and a display cutout, and an open keyboard (no bottom inset reported).
 inside="([s,i])=>{const r=document.querySelector(s).getBoundingClientRect();return r.width>0&&r.top>=i.top-.5&&r.left>=i.left-.5&&r.bottom<=innerHeight-i.bottom+.5&&r.right<=innerWidth-i.right+.5?null:[s,Math.round(r.left),Math.round(r.top),Math.round(r.right),Math.round(r.bottom)];}"
 for name,w,h,inset in [('android-phone',360,800,{'top':40,'right':0,'bottom':48,'left':0}),('android-landscape',800,360,{'top':24,'right':48,'bottom':0,'left':32}),('android-keyboard',360,420,{'top':40,'right':0,'bottom':0,'left':0})]:
  bars=b.new_context(viewport={'width':w,'height':h},is_mobile=True,has_touch=True,device_scale_factor=1);bp=bars.new_page();bp.on('pageerror',lambda e:errors.append(str(e)));bp.set_content(html);bp.evaluate('window.__seed()')
  bp.evaluate("i=>{const r=document.documentElement;r.dataset.platform='android';for(const [k,v] of Object.entries(i))r.style.setProperty('--safe-area-inset-'+k,v+'px');}",inset);bp.wait_for_timeout(150)
  outside=[bp.evaluate(inside,['#app',inset])]
  for opener,dialog in [('account','#account-dialog'),('settings','#settings-dialog'),('view','#view-dialog'),('palette','#palette-dialog'),('model-picker','#model-dialog'),('instructions-picker','#instructions-dialog'),('project-create','#project-dialog'),('rename','#rename-dialog'),('move-project','#move-dialog'),('edit-draft','#edit-dialog'),(None,'#close-dialog')]:
   if opener:bp.evaluate("a=>{const b=document.createElement('button');b.dataset.action=a;document.body.append(b);b.click();b.remove();}",opener)
   else:bp.evaluate("s=>document.querySelector(s).showModal()",dialog)
   expect(bp.locator(dialog)).to_be_visible();bp.wait_for_timeout(100);outside.append(bp.evaluate(inside,[dialog,inset]))
   bp.evaluate("s=>document.querySelector(s).close()",dialog);expect(bp.locator(dialog)).to_be_hidden()
  bp.evaluate("()=>{const t=document.createElement('div');t.className='toast';t.id='inset-toast';t.textContent='Saved.';document.body.append(t);}");outside.append(bp.evaluate(inside,['#inset-toast',inset]))
  assert not [o for o in outside if o],(name,inset,[o for o in outside if o])
  checks.append(f'{name}: with system-bar insets {inset}, the shell, all eleven dialogs including the message editor, and a toast stay clear of the bars and cutout')
  # A phone has no window title bar: the toolbar and the navigation drawer start under the status bar.
  bp.evaluate("()=>document.querySelector('[data-action=sidebar]').click()");bp.wait_for_timeout(250)
  top=bp.evaluate("()=>({bar:getComputedStyle(document.querySelector('.titlebar')).display,main:Math.round(document.querySelector('.main').getBoundingClientRect().top),side:Math.round(document.querySelector('.sidebar').getBoundingClientRect().top)})")
  if w<=600:assert top=={'bar':'none','main':inset['top'],'side':inset['top']},(name,top);checks.append(f'{name}: no title bar; the toolbar and the navigation drawer start right under the status bar')
  else:assert top['bar']!='none',(name,top);checks.append(f'{name}: wider than a phone, the title bar with its search stays')
  bars.close()
 assert not errors;checks.append('responsive matrix produced no unhandled JavaScript errors')
 context.close();b.close()
result={'checks':len(checks),'passed':checks,'matrix':matrix,'javascript_errors':errors,'scope':'Chromium Linux touch/viewport emulation only; keyboard height simulated; no physical phones, tablets, iOS Safari, Android Chrome, native mobile shell or live provider'}
(root/'docs/ui-responsive-checks.json').write_text(json.dumps(result,indent=2));print(json.dumps(result,indent=2))
