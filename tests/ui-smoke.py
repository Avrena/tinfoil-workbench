"""Production renderer + synthetic offline bridge. NOT a native Electron test.
Requires Python and playwright. Use --chromium /path/to/chromium as necessary.
Security fixtures are injected into an in-memory copy of the preview, never into
packaged source or the distributed preview. No credentials or network required.
"""
import argparse
import base64
import json
import re
from pathlib import Path
from playwright.sync_api import sync_playwright, expect
parser=argparse.ArgumentParser()
parser.add_argument('--chromium',default=None)
parser.add_argument('--no-sandbox',action='store_true',help='Isolated root-owned test containers only; never a production flag.')
args=parser.parse_args();root=Path(__file__).resolve().parents[1];checks=[]
html=(root/'preview/index.html').read_text(encoding='utf-8')
marker='const pause = (ms) => new Promise((r) => setTimeout(r, ms));'
assert marker in html
fixture="""window.__fixture = patch => { const t=workspace.threads.find(t=>t.id===workspace.activeId); Object.assign(t.turns[0].replies[0],patch); emit(); };
window.__active = () => structuredClone(workspace.threads.find(t=>t.id===workspace.activeId));"""
html=html.replace(marker,marker+fixture,1)
with sync_playwright() as p:
 options={'headless':True}
 if args.chromium:options['executable_path']=args.chromium
 if args.no_sandbox:options['args']=['--no-sandbox']
 b=p.chromium.launch(**options);page=b.new_page(viewport={'width':1500,'height':1180});errors=[];requests=[];blocked_styles=[]
 page.on('pageerror',lambda e:errors.append(str(e)))
 def console_message(m):
  if m.type!='error':return
  # Chromium rejects the source style attribute while parsing inert HTML.
  # The preview reconstructs that style in its nonce-authorized stylesheet.
  if 'Applying inline style violates' in m.text and '1XSNb9frwnIsnyTl5XzoCaEa+GY/1nm1YHDIcXIGa3Y=' in m.text:blocked_styles.append(m.text)
  else:errors.append(m.text)
 page.on('console',console_message)
 page.on('request',lambda r:requests.append(r.url))
 page.set_content(html)
 expect(page.locator('#preview-label')).to_be_visible();expect(page.locator('#inspector')).to_be_hidden();expect(page.locator('.sidebar')).to_be_visible()
 checks.append('default layout hides advanced controls and labels offline data')
 for width in (1500,1100):
  page.set_viewport_size({'width':width,'height':900});box=page.locator('.title-search').bounding_box()
  assert abs(box['x']+box['width']/2-width/2)<=1 and abs(box['width']-min(width*.4,600))<=1,(width,box)
 page.set_viewport_size({'width':1500,'height':1180})
 status=page.locator('.statusbar').inner_text();assert not any(word in status for word in ('Ready','Encrypted','memory only')),status
 checks.append('the title search is centred on the window at 40% of its width, and the idle status bar shows only the connection')
 page.locator('#composer-model').click();expect(page.locator('#model-dialog')).to_be_visible()
 expect(page.locator('#quick-model')).to_have_value('');rows=page.locator('#model-options [data-quick-model]')
 assert rows.evaluate_all('r=>r.map(b=>b.dataset.quickModel)')==['deepseek-v4-pro','kimi-k3','demo/writer','demo/analyst']
 expect(page.locator('#model-options [aria-current=true]')).to_have_attribute('data-quick-model','demo/writer')
 expect(page.locator('[data-quick-model=kimi-k3] .maker-badge')).to_have_class(re.compile('maker-moonshot'))
 expect(page.locator('[data-quick-model=kimi-k3]')).to_have_attribute('aria-label','Kimi K3, Moonshot AI, reasoning, image input, tool calling, 256K context')
 expect(page.locator('[data-quick-model=kimi-k3] .maker-badge.maker-logo path')).not_to_have_count(0);expect(page.locator('[data-quick-model="demo/writer"] .maker-badge text')).to_have_text('DW')
 expect(page.locator('[data-quick-model=deepseek-v4-pro] .option-description')).to_contain_text('Synthetic preview entry')
 assert page.locator('[data-quick-model=deepseek-v4-pro] .option-description').evaluate('e=>getComputedStyle(e).webkitLineClamp')=='2'
 slots=rows.evaluate_all('r=>r.map(b=>[...b.querySelectorAll(".option-flag,.option-context")].map(f=>Math.round(f.getBoundingClientRect().left)))')
 assert all(len(s)==4 and s==slots[0] for s in slots),slots
 checks.append('the model picker opens on the whole list with maker logos, descriptions, capability columns and the current model marked')
 page.locator('#quick-model').fill('moonshot');assert rows.evaluate_all('r=>r.map(b=>b.dataset.quickModel)')==['kimi-k3']
 page.locator('#quick-model').fill('vendor/custom-model');expect(page.locator('.model-status')).to_contain_text('No listed model matches');expect(page.locator('.model-custom')).to_have_attribute('data-quick-model','vendor/custom-model')
 page.locator('#quick-model').fill('');page.locator('#quick-model').press('ArrowDown');expect(page.locator('[data-quick-model=deepseek-v4-pro]')).to_be_focused()
 checks.append('model search matches makers, offers any other model ID and arrow keys move into the list')
 expect(page.locator('.empty-mark .maker-mark text')).to_have_text('DW')
 page.locator('[data-quick-model=kimi-k3]').click();expect(page.locator('#model-dialog')).to_be_hidden();expect(page.locator('#composer-model .model-label')).to_have_text('Kimi K3')
 mark=page.locator('.empty-mark .maker-mark');expect(mark).to_have_class(re.compile('maker-moonshot maker-logo'));expect(mark.locator('text')).to_have_count(0);expect(mark.locator('path')).not_to_have_count(0)
 centre=lambda s:page.locator(s).evaluate('e=>{const r=e.getBoundingClientRect();return r.top+r.height/2}')
 badge,label,chevron=centre('#composer-model .maker-badge'),centre('#composer-model .model-label'),centre('#composer-model .model-chevron svg')
 assert abs(badge-label)<=1.5 and abs(chevron-label)<=1.5,(badge,label,chevron)
 assert mark.evaluate('e=>getComputedStyle(e).color')=='rgba(236, 238, 242, 0.62)'
 checks.append('choosing a model shows its maker logo, centred with its name, on the composer and alone in muted white on the welcome page')
 page.locator('#composer-model').click();page.locator('#quick-model').fill('demo/writer');page.locator('#quick-model').press('Enter');expect(page.locator('#composer-model .model-label')).to_have_text('Demo Writer')
 checks.append('model choice is available without opening the inspector')
 page.locator('#prompt').fill('Estimate a repair deadline from 142, 180 and 218 seconds.');page.locator('#send').click()
 expect(page.locator('.reply-content')).to_contain_text('synthetic preview response');expect(page.locator('#stop')).to_be_hidden()
 expect(page.locator('.reply-content math')).to_have_count(2);expect(page.locator('.reply-content > .markdown-segment table')).to_have_count(1);assert page.locator('.token').count()>0
 checks.append('streamed answer renders Markdown tables, highlighted code and native MathML')
 assert page.locator('.reasoning').evaluate('(e)=>!e.open');expect(page.locator('.usage')).to_have_count(0)
 page.locator('#transcript').evaluate('(e)=>e.scrollTop=0')
 page.screenshot(path=str(root/'docs/preview.png'),full_page=True)
 # The layout must settle at the new size first, or the full-page shot keeps the old height as a blank strip.
 page.set_viewport_size({'width':1100,'height':850})
 for _ in range(60):  # polled with evaluate: the page's CSP refuses wait_for_function's string evaluation in some browsers
  if page.evaluate('document.documentElement.scrollHeight')<=850: break
  page.wait_for_timeout(50)
 page.wait_for_timeout(200)
 page.screenshot(path=str(root/'docs/preview-compact.png'),full_page=True);page.set_viewport_size({'width':1500,'height':1180})
 page.locator('.reasoning summary').click();expect(page.locator('.reasoning-content')).to_be_visible()
 # A snapshot update must not forcibly fold the section the reader opened.
 page.locator('#prompt').fill('Draft');page.wait_for_timeout(650);assert page.locator('.reasoning').evaluate('(e)=>e.open')
 checks.append('reasoning is folded by default and user expansion survives snapshots')
 page.locator('[data-action="view"]').click();page.locator('#view-reasoning').select_option('hidden');page.locator('#view-metadata').check();page.keyboard.press('Escape')
 expect(page.locator('.reasoning')).to_have_count(0);expect(page.locator('.usage')).to_be_visible()
 checks.append('reading controls hide reasoning and explicitly reveal token statistics')
 page.locator('[data-action="source"]').click();expect(page.locator('.reply-content .raw-source')).to_be_visible();expect(page.locator('.reply-content math')).to_have_count(0)
 page.locator('[data-action="source"]').click();expect(page.locator('.reply-content math')).to_have_count(2)
 checks.append('per-message source toggle preserves the original Markdown')
 page.locator('[data-action="view"]').click();page.locator('#view-math').uncheck();page.keyboard.press('Escape');expect(page.locator('.reply-content math')).to_have_count(0)
 page.locator('[data-action="view"]').click();page.locator('#view-math').check();page.locator('#view-metadata').uncheck();page.locator('#view-reasoning').select_option('collapsed');page.keyboard.press('Escape')
 checks.append('math visibility changes presentation, not source content')
 page.keyboard.press('Control+f');page.locator('#find-input').fill('repair');expect(page.locator('#find-count')).to_contain_text('/');assert page.locator('mark.search-match').count()>0;page.keyboard.press('Escape')
 checks.append('in-conversation find highlights matches without rewriting stored answers')
 page.keyboard.press('Control+Shift+f');expect(page.locator('.sidebar')).to_be_hidden();expect(page.locator('#inspector')).to_be_hidden()
 page.keyboard.press('Control+Shift+f');expect(page.locator('.sidebar')).to_be_visible();page.keyboard.press('Control+b');expect(page.locator('.sidebar')).to_be_hidden();page.keyboard.press('Control+b')
 checks.append('focus and sidebar keyboard shortcuts restore the prior layout')
 # Let the queued visibility/layout commit settle before a genuine pointer click.
 # The rapid-transition hit-test stress case is recorded separately in VALIDATION.
 expect(page.locator('.sidebar')).to_be_visible();page.locator('.run-code').scroll_into_view_if_needed();page.wait_for_timeout(250)
 page.locator('.run-code').click();expect(page.locator('#toast')).to_contain_text('does not execute Python')
 checks.append('offline preview refuses execution rather than simulating a real run')
 page.locator('.toolbar [data-action="inspector"]').click();expect(page.locator('#inspector')).to_be_visible();expect(page.locator('#python-interpreter')).to_be_hidden()
 page.locator('#instructions').fill('Keep the answer concrete.');page.locator('[data-for=tools-mode] [data-value=ask]').click();expect(page.locator('#python-status .python-name')).to_have_text('Python 3.13.2 · on PATH');expect(page.locator('#python-status .python-path')).to_have_text('C:\\Preview\\Python313\\python.exe')
 page.locator('#apply-settings').click();expect(page.locator('#tools-badge')).to_be_visible();expect(page.locator('#pending-settings')).to_be_hidden()
 expect(page.locator('#python-choice')).to_be_visible();assert page.locator('#python-found option').count()==2;expect(page.locator('#python-find')).to_have_text('Search again');expect(page.locator('#python-get')).to_be_hidden()
 page.locator('#python-found').select_option('C:\\Preview\\Python311\\python.exe');expect(page.locator('#python-status .python-name')).to_have_text('Python 3.11.9');expect(page.locator('#pending-settings')).to_be_hidden()
 checks.append('turning on model-requested Python in Advanced finds installed Python and shows the one on PATH under it; another one found is picked there without Apply')
 page.locator('#inspector [data-action="inspector"]').click();expect(page.locator('#inspector')).to_be_hidden()
 checks.append('advanced instructions and ask-before-run controls persist only on apply')
 page.locator('#prompt').fill('A saved draft with 中文.');page.keyboard.press('Shift+Enter');assert page.locator('#prompt').input_value().endswith('\n')
 page.keyboard.press('Control+n');expect(page.locator('#prompt')).to_have_value('');page.locator('#thread-list button.thread').nth(1).click();assert '中文' in page.locator('#prompt').input_value()
 checks.append('drafts and IME-friendly multiline input survive thread changes')
 projects_toggle,threads_toggle=page.locator('[data-action=nav-fold][data-section=projects]'),page.locator('[data-action=nav-fold][data-section=threads]')
 projects_toggle.click();expect(page.locator('#nav-projects')).to_be_hidden();expect(projects_toggle).to_have_attribute('aria-expanded','false')
 threads_toggle.click();expect(page.locator('#nav-threads')).to_be_hidden();expect(page.locator('[data-action=nav-fold][data-section=threads]')).to_have_attribute('aria-expanded','false');assert page.locator('#thread-list button.thread:visible').count()==0
 page.locator('#search').fill('New');expect(page.locator('#nav-threads')).to_be_visible();page.locator('#search').fill('')
 expect(page.locator('#nav-threads')).to_be_hidden();page.locator('[data-action=nav-fold][data-section=threads]').click();projects_toggle.click();expect(page.locator('#nav-threads')).to_be_visible();expect(page.locator('#nav-projects')).to_be_visible()
 checks.append('the sidebar folds Projects and Threads to their headings; a search shows everything')
 page.keyboard.press('Control+k');expect(page.locator('#palette-dialog')).to_be_visible();page.wait_for_timeout(120);page.mouse.click(20,500);expect(page.locator('#palette-dialog')).to_be_hidden()
 page.keyboard.press('Control+k');page.locator('#palette-search').click();expect(page.locator('#palette-dialog')).to_be_visible();page.keyboard.press('Escape');expect(page.locator('#palette-dialog')).to_be_hidden()
 checks.append('a click outside the command palette closes it; a click inside does not')
 page.keyboard.press('Control+k');page.locator('#palette-search').fill('settings');page.locator('#palette-search').press('Enter');expect(page.locator('#settings-dialog')).to_be_visible()
 assert page.locator('#settings-dialog #python-status, #settings-dialog [data-action=python-pick]').count()==0
 page.locator('#api-key').fill('preview-must-not-store');page.locator('#save-key').click();expect(page.locator('#api-key')).to_have_value('');expect(page.locator('#toast')).to_contain_text('cannot accept API keys');page.keyboard.press('Escape')
 checks.append('command palette opens settings; preview rejects and clears credentials')
 # Settings → Appearance: a light preset recolours the page at once, is stored, and Escape in its popover keeps Settings open.
 page.locator('.sidebar-bottom [data-action=settings]').click();expect(page.locator('#settings-dialog')).to_be_visible()
 expect(page.locator('#theme-cards .theme-card')).to_have_count(1);page.locator('[data-for=theme-mode] [data-value=light]').click()
 page.locator('[data-theme-preset=light]').click();expect(page.locator('#theme-popover [data-preset]')).to_have_count(17);page.locator('#theme-popover [data-preset=github]').click()
 assert page.evaluate("getComputedStyle(document.querySelector('.main')).backgroundColor")=='rgb(255, 255, 255)',page.evaluate("getComputedStyle(document.querySelector('.main')).backgroundColor")
 page.wait_for_timeout(200);page.evaluate("document.getElementById('toast').classList.add('hidden');document.activeElement?.blur()");page.screenshot(path=str(root/'docs/settings-appearance.png'))  # the README's picture of Settings → Appearance
 page.locator('[data-theme-color=light][data-key=accent]').click();page.locator('#theme-popover [data-hex]').fill('#aa3366');page.wait_for_timeout(100)
 expect(page.locator('[data-theme-reset=light]')).to_have_count(0);page.keyboard.press('Escape');expect(page.locator('#settings-dialog')).to_be_visible();expect(page.locator('[data-theme-reset=light]')).to_be_visible()
 page.wait_for_function("window.tinfoil.snapshot().then(s=>s.workspace.view.theme.light.accent==='#aa3366'&&s.workspace.view.theme.mode==='light')",timeout=3000)
 page.locator('[data-theme-reset=light]').click();page.locator('[data-for=theme-mode] [data-value=system]').click();expect(page.locator('#theme-cards .theme-card')).to_have_count(2)
 page.locator('[data-for=theme-mode] [data-value=dark]').click();page.keyboard.press('Escape');expect(page.locator('#settings-dialog')).to_be_hidden()
 page.wait_for_function("window.tinfoil.snapshot().then(s=>s.workspace.view.theme.mode==='dark')",timeout=3000)
 assert page.evaluate("getComputedStyle(document.querySelector('.main')).backgroundColor")=='rgb(30, 30, 30)'
 checks.append('Settings → Appearance: a light preset recolours the page and is stored, a picked colour marks it edited, System shows both variants')
 # Settings → Chat background: each kind shows only its own options; an effect's slider shows only while its switch is on.
 page.locator('.sidebar-bottom [data-action=settings]').click();expect(page.locator('#background-texture-options')).to_be_hidden();expect(page.locator('#chat-backdrop')).to_be_hidden()
 page.locator('[data-for=background-kind] [data-value=texture]').click();expect(page.locator('#background-texture-options')).to_be_visible();expect(page.locator('#chat-backdrop')).to_have_attribute('data-kind','texture')
 page.locator('[data-for=background-texture] [data-value=dots]').click();expect(page.locator('#chat-backdrop')).to_have_attribute('data-texture','dots')
 page.locator('[data-for=background-kind] [data-value=picture]').click();expect(page.locator('#background-texture-options')).to_be_hidden();expect(page.locator('#background-picture-note')).to_be_visible()
 assert page.locator('#background-picture-options .background-slider:visible').count()==1,'only Dim, which starts on, shows its slider'
 page.locator('[data-action=background-pick]').click();expect(page.locator('#chat-backdrop')).to_have_attribute('data-kind','picture');expect(page.locator('#background-clear')).to_be_visible()
 # The README's picture of a chat background: the synthetic picture, blurred, behind the conversation.
 page.locator('#background-blur-on').check();page.keyboard.press('Escape');expect(page.locator('#settings-dialog')).to_be_hidden();page.wait_for_timeout(400)
 page.evaluate("document.getElementById('toast').classList.add('hidden');document.activeElement?.blur()");page.screenshot(path=str(root/'docs/chat-background.png'));page.locator('.sidebar-bottom [data-action=settings]').click();expect(page.locator('#settings-dialog')).to_be_visible()
 page.locator('#background-blur-on').check();expect(page.locator('#background-blur-row')).to_be_visible();page.locator('#background-blur-on').uncheck();expect(page.locator('#background-blur-row')).to_be_hidden()
 page.wait_for_function("window.tinfoil.snapshot().then(s=>!!s.background&&s.workspace.view.background.kind==='picture'&&s.workspace.view.background.texture==='dots')",timeout=3000)
 page.locator('[data-action=background-clear]').click();expect(page.locator('#chat-backdrop')).to_be_hidden();page.keyboard.press('Escape');expect(page.locator('#settings-dialog')).to_be_hidden()
 checks.append('Settings → Chat background: texture and picture options, a picked picture behind the conversation, effect sliders only while switched on')
 # All fixture content below is synthetic; test hook exists only in this in-memory page.
 page.evaluate('window.__fixture({content:"```html\\n<h1 style=\\\"color:rgb(0, 255, 0)\\\">Static preview</h1><script>parent.fixturePwned=true</script><a href=\\\"https://evil.test/x\\\">No navigation</a><img src=\\\"https://evil.test/tracker\\\">\\n```",reasoning:""})')
 page.locator('.preview-code').click();expect(page.locator('#artifact-panel')).to_be_visible();frame=page.frame_locator('#artifact-stage iframe')
 expect(frame.locator('h1')).to_have_text('Static preview');assert frame.locator('script,a[href],img').count()==0
 assert frame.locator('h1').evaluate('(e)=>getComputedStyle(e).color')=='rgb(0, 255, 0)'
 assert page.locator('#artifact-stage iframe').get_attribute('sandbox')==''
 assert page.evaluate('window.fixturePwned===undefined');page.locator('[data-panel=close]').click()
 checks.append('HTML preview preserves permitted styles in an opaque sandbox and strips scripts, navigation and images')
 evil='<img src="https://evil.test/tracker" onerror="window.fixturePwned=true"><script>window.fixturePwned=true</script>'
 page.evaluate('(text)=>window.__fixture({content:text})',evil);expect(page.locator('.reply-content')).to_contain_text('<script>');assert page.locator('.reply-content img,.reply-content script').count()==0
 checks.append('raw model HTML remains inert text in the transcript')
 tool={'id':'fixture-tool','callId':'fixture-call','name':'python','arguments':'{"code":"print(2)"}','origin':'model','status':'awaiting_approval','stdout':'','stderr':'','exitCode':None,'elapsedMs':0,'artifacts':[],'truncated':False}
 page.evaluate('(tool)=>window.__fixture({content:"",status:"awaiting_approval",tools:[tool]})',tool)
 expect(page.locator('.approval-required')).to_be_visible();expect(page.locator('[data-action="approve-tool"]')).to_be_visible();expect(page.locator('.approval-warning')).to_contain_text('not in a sandbox')
 page.locator('[data-action="view"]').click();page.locator('#view-reasoning').select_option('hidden');page.keyboard.press('Escape');expect(page.locator('.approval-required')).to_be_visible()
 checks.append('pending execution cannot be hidden by reasoning visibility preferences')
 tool.update(status='complete',stdout='2\n',exitCode=0,artifacts=[{'id':'fixture-artifact','name':'result.json','mime':'application/json','data':base64.b64encode(b'{"answer":2}').decode()}])
 page.evaluate('(tool)=>window.__fixture({content:"Result: **2**",status:"complete",tools:[tool]})',tool)
 assert page.locator('.tool-activity').evaluate('(e)=>!e.open');page.locator('.tool-activity summary').first.click();expect(page.locator('.tool-stdout')).to_have_text('2\n')
 page.locator('[data-action="artifact-view"]').first.click();expect(page.locator('#artifact-stage')).to_contain_text('"answer": 2');page.locator('[data-panel=close]').click()
 checks.append('completed tools fold into activity with stdout and generated-file preview on demand')
 page.set_viewport_size({'width':940,'height':640});assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
 expect(page.locator('#prompt')).to_be_visible();expect(page.locator('#send')).to_be_visible()
 checks.append('940 × 640 minimum window keeps composer usable without page-wide overflow')
 # A clean second page checks the retained comparison workflow.
 second=b.new_page(viewport={'width':1440,'height':1000})
 second.on('pageerror',lambda e:errors.append(str(e)))
 second.set_content(html)
 second.locator('.export-menu summary').click();second.locator('#compare-toggle').click()
 expect(second.locator('#inspector')).to_be_visible()
 second.locator('#prompt').fill('Compare two approaches.');second.locator('#send').click()
 expect(second.locator('.reply')).to_have_count(2)
 expect(second.locator('.reply-content').first).to_contain_text('synthetic preview response')
 expect(second.locator('.reply-content').last).to_contain_text('synthetic preview response')
 expect(second.locator('#stop')).to_be_hidden()
 checks.append('comparison is an explicit advanced action and retains two separate response lanes')
 second.locator('#prompt').fill('Continue.');second.locator('#send').click()
 expect(second.locator('#toast')).to_contain_text('Choose one of the earlier answers')
 second.locator('[data-action="choose"]').last.click();expect(second.locator('.chosen-label')).to_have_text('Selected')
 checks.append('comparison still requires a selected answer before continuation')
 second.locator('[data-action="branch"]').last.click()
 expect(second.locator('#thread-list button.thread')).to_have_count(2)
 expect(second.locator('#thread-title')).to_contain_text('branch')
 checks.append('branching from a comparison preserves the original conversation')
 expect(second.locator('.reply > .message-label')).to_have_count(2);expect(second.locator('.reply-signature')).to_have_count(2)
 checks.append('comparison lanes keep a model label above each answer and the same signature below it')
 second.close()
 # A clean third page checks optional system instruction selection and reply signatures.
 third=b.new_page(viewport={'width':1440,'height':1000})
 third.on('pageerror',lambda e:errors.append(str(e)))
 third.set_content(html)
 chip,name=third.locator('#composer-instructions'),third.locator('#composer-instructions-name')
 assert 'none' in chip.get_attribute('aria-label');expect(name).to_have_text('')
 third.locator('#prompt').fill('Plain question.');third.locator('#send').click();expect(third.locator('#stop')).to_be_hidden()
 expect(third.locator('.reply > .message-label')).to_have_count(0);expect(third.locator('.reply-signature')).to_have_text('demo/writer');expect(third.locator('.signature-instructions')).to_have_count(0)
 checks.append('an answer without custom instructions starts with its content and ends with only the model name')
 chip.click();expect(third.locator('#instructions-dialog')).to_be_visible();expect(third.locator('.instructions-intro')).to_contain_text('system message');expect(third.locator('.instructions-intro')).not_to_contain_text('not required')
 expect(third.locator('[data-instructions=none]')).to_have_attribute('aria-current','true')
 third.locator('[data-instructions="starter:starter-concise"]').click();expect(third.locator('#instructions-dialog')).to_be_hidden();expect(name).to_have_text('Concise')
 applied=third.evaluate('window.__active().settings');assert applied['systemPromptName']=='Concise' and applied['systemPrompt'].startswith('Be concise.')
 third.locator('#prompt').fill('A short answer, please.');third.locator('#send').click();expect(third.locator('#stop')).to_be_hidden()
 expect(third.locator('.reply-signature').last).to_contain_text('Concise');expect(third.locator('.reply-signature').first).not_to_contain_text('Concise')
 expect(third.locator('.reply > .message-label')).to_have_count(0)
 checks.append('a selected starter applies from the next message; each reply footer names the instructions it was sent with, never above the answer')
 chip.click();third.locator('[data-action=instructions-new]').click();expect(third.locator('#instructions-save')).to_be_disabled()
 third.locator('#instructions-name').fill('Translator');third.locator('#instructions-text').fill('Answer in French.');third.locator('#instructions-save').click()
 expect(third.locator('[data-instructions^="saved:"]')).to_contain_text('Translator');expect(third.locator('[data-instructions="starter:starter-concise"]')).to_have_attribute('aria-current','true')
 expect(third.locator('[data-instructions^="saved:"]')).to_be_focused()
 third.locator('[data-action=instructions-new]').click();third.locator('#instructions-name').fill('translator');third.locator('#instructions-text').fill('Duplicate');third.locator('#instructions-save').click()
 expect(third.locator('#instructions-dialog .dialog-feedback')).to_contain_text('already exist');third.keyboard.press('Escape');third.locator('[data-action=instructions-discard]').click()
 expect(third.locator('#instructions-list-view')).to_be_visible();expect(third.locator('#instructions-dialog .dialog-feedback')).to_have_count(0)
 checks.append('saving moves focus to the new entry, and an error does not follow the picker to another view')
 third.locator('[data-instructions^="saved:"]').click();expect(name).to_have_text('Translator')
 checks.append('saving creates a reusable entry without applying it; selecting it copies the text into the conversation')
 chip.click();third.locator('.instruction-edit[data-edit^="saved:"]').click();third.locator('#instructions-delete').click();third.locator('[data-action=instructions-confirm-delete]').click()
 expect(third.locator('.instruction-empty')).to_be_visible();expect(third.locator('[data-instructions=current]')).to_contain_text('Translator')
 assert third.evaluate('window.__active().settings.systemPrompt')=='Answer in French.'
 checks.append('deleting saved instructions keeps the copy the conversation already uses')
 third.locator('.instruction-edit[data-edit=current]').click();third.locator('#instructions-text').fill('Changed but not applied');third.keyboard.press('Escape')
 expect(third.locator('#instructions-discard')).to_be_visible();expect(third.locator('#instructions-dialog')).to_be_visible()
 third.locator('[data-action=instructions-discard]').click();expect(third.locator('#instructions-list-view')).to_be_visible();expect(third.locator('.instruction-edit[data-edit=current]')).to_be_focused()
 third.keyboard.press('Escape');expect(third.locator('#instructions-dialog')).to_be_hidden()
 assert third.evaluate('window.__active().settings.systemPrompt')=='Answer in French.'
 checks.append('Escape steps back from the editor, asks before discarding unsaved edits and returns focus to the control that opened it')
 third.locator('.toolbar [data-action=inspector]').click();expect(third.locator('#instructions-applied')).to_contain_text('Translator')
 third.locator('#instructions').fill('Use British spelling.');expect(third.locator('#instructions-applied')).to_contain_text('unnamed custom')
 chip.click();third.locator('[data-instructions=none]').click();expect(third.locator('#instructions-dialog .dialog-feedback')).to_contain_text('pending Advanced');third.keyboard.press('Escape')
 third.locator('#apply-settings').click();expect(name).to_have_text('Custom');assert third.evaluate('window.__active().settings.systemPromptName')==''
 checks.append('pending Advanced edits block the picker; edited Advanced text applies as unnamed custom instructions')
 chip.click();third.locator('[data-instructions=none]').click();expect(name).to_have_text('')
 assert third.evaluate('window.__active().settings')['systemPrompt']=='';expect(third.locator('.reply-signature').last).to_contain_text('Concise')
 checks.append('None turns custom instructions off for new requests without relabelling earlier replies')
 chip.click();third.locator('[data-action=instructions-new]').click();third.locator('[data-action=instructions-back]').dblclick()
 expect(third.locator('#instructions-list-view')).to_be_visible();assert third.evaluate('window.__active().settings.systemPrompt')==''
 threads=third.locator('#thread-list .thread').count()
 third.evaluate("window.__stray=0;document.addEventListener('click',e=>{if(e.detail>1&&!e.target.closest('dialog'))window.__stray++;})")
 third.locator('[data-instructions^="starter:"]').first.dblclick();expect(third.locator('#instructions-dialog')).to_be_hidden();expect(name).to_have_text('Concise')
 third.wait_for_timeout(200);assert third.evaluate('window.__stray')==0;assert third.locator('#thread-list .thread').count()==threads;assert third.evaluate('window.__active().turns.length')==2
 checks.append('double-clicks choose at most one entry and never reach the controls the closing picker uncovers')
 third.close()
 # A second Escape must not discard unsaved instructions. As in ui-editing.py, nothing queries the page
 # between the presses, because Playwright's evaluations count as user activation.
 fourth=b.new_page(viewport={'width':1280,'height':900});fourth.on('pageerror',lambda e:errors.append(str(e)));fourth.set_content(html)
 fourth.locator('#composer-instructions').click();fourth.locator('[data-action=instructions-new]').click();fourth.locator('#instructions-text').fill('Unsaved instructions')
 fourth.keyboard.press('Escape');fourth.keyboard.press('Escape');fourth.wait_for_timeout(150)
 expect(fourth.locator('#instructions-dialog')).to_be_visible();expect(fourth.locator('#instructions-discard')).to_be_visible();expect(fourth.locator('#instructions-text')).to_have_value('Unsaved instructions');fourth.close()
 checks.append('a second Escape keeps unsaved instructions behind the discard question')
 # Tags: Settings → Tags, a first answer tagged and titled by the preview's synthetic classifier, the tags dialog, the
 # sidebar's tag row, #search and grouping by tag, and each style's shape.
 tags=b.new_page(viewport={'width':1400,'height':900});tags.on('pageerror',lambda e:errors.append(str(e)));tags.set_content(html)
 tags.locator('[data-action=settings]').first.click();expect(tags.locator('#tagging-options')).to_be_hidden()
 expect(tags.locator('#tag-list [data-tag]')).to_have_count(9);tags.locator('#tagging-on').check();expect(tags.locator('#tagging-options')).to_be_visible()
 expect(tags.locator('#tagging-model')).to_have_value('')
 coding=tags.locator('[data-tag=preset-coding]');coding.locator('.tag-look').click();expect(coding.locator('.tag-styles [role=radio]')).to_have_count(5)
 coding.locator('[data-pick-style=stripe]').click();expect(coding.locator('.tag-look .tag-chip')).to_have_attribute('data-style','stripe')
 expect(coding.locator('[data-pick-style=stripe]')).to_be_focused();coding.locator('[data-pick-color=green]').click()
 expect(coding.locator('.tag-look .tag-chip')).to_have_attribute('data-color','green');coding.locator('.tag-look').click();expect(coding.locator('.tag-looks')).to_have_count(0)
 tags.locator('#tag-add').click();new=tags.locator('#tag-list [data-tag]').last;expect(new.locator('.tag-name-input')).to_be_focused();expect(new.locator('.tag-name-input')).to_have_value('New tag')
 new.locator('.tag-name-input').fill('#Travel');new.locator('.tag-name-input').press('Enter');expect(new.locator('.tag-name-input')).to_have_value('Travel')
 tags.locator('[data-tag=preset-personal] .tag-name-input').fill('travel');tags.locator('[data-tag=preset-personal] .tag-name-input').press('Enter')
 expect(tags.locator('#toast')).to_contain_text('Two tags are called');expect(tags.locator('[data-tag=preset-personal] .tag-name-input')).to_have_value('Personal')
 new.locator('[data-tag-action=remove]').click();expect(new.locator('[data-tag-action=remove-cancel]')).to_be_focused();new.locator('[data-tag-action=remove-confirm]').click()
 tags.locator('[data-tag=preset-health] [data-tag-action=remove]').click();tags.locator('[data-tag=preset-health] [data-tag-action=remove-confirm]').click()
 expect(tags.locator('#tag-list [data-tag]')).to_have_count(8);tags.locator('#tag-presets').click();expect(tags.locator('#tag-list [data-tag]')).to_have_count(9);expect(tags.locator('#tag-presets')).to_be_disabled()
 checks.append('Settings → Tags turns tagging on, picks each tag’s colour and style, adds, renames, refuses a duplicate name, removes and restores presets')
 tags.keyboard.press('Escape');tags.locator('#prompt').fill('Help with debugging this programming error in my scripts');tags.locator('#send').click()
 row=tags.locator('#thread-list .thread').first;expect(row.locator('.row-tags .tag-chip')).to_have_text(['Coding'],timeout=15000)
 expect(tags.locator('#thread-title')).to_have_text('Help with debugging this programming error');expect(tags.locator('#thread-tags .tag-chip')).to_have_text(['Coding'])
 assert tags.evaluate('window.__active().tagged.model')=='demo/writer'
 checks.append('with tagging on, the first answer is tagged and the first-message title replaced; the title bar and the sidebar show the tags')
 tags.locator('#thread-tags').click();expect(tags.locator('#tags-dialog')).to_be_visible();expect(tags.locator('#tag-note')).to_contain_text('Suggested by Demo Writer')
 expect(tags.locator('[data-tag-toggle=preset-coding]')).to_have_attribute('aria-pressed','true');tags.locator('[data-tag-toggle=preset-work]').click()
 expect(tags.locator('[data-tag-toggle=preset-work]')).to_have_attribute('aria-pressed','true');expect(tags.locator('#tag-note')).to_have_text('Chosen by you.')
 expect(tags.locator('#thread-tags .tag-chip')).to_have_text(['Coding','Work'])
 tags.locator('[data-action=tags-manage]').click();expect(tags.locator('#settings-dialog')).to_be_visible();expect(tags.locator('#tags-dialog')).to_be_hidden();tags.wait_for_timeout(400)
 gap=tags.locator('#tag-settings-title').evaluate("e=>e.getBoundingClientRect().top-e.closest('dialog').querySelector('.modal-head').getBoundingClientRect().bottom");assert 0<=gap<=40,gap
 tags.keyboard.press('Escape')
 checks.append('the tags dialog shows who chose the tags and switches each tag; the person’s choice is recorded as theirs; Manage tags… opens Settings at Tags')
 tags.locator('[data-action=new]').first.click();tags.locator('#prompt').fill('Drafting and editing a short letter');tags.locator('#send').click()
 expect(tags.locator('#thread-list .thread').first.locator('.row-tags .tag-chip')).to_have_text(['Writing'],timeout=15000)
 expect(tags.locator('#tag-filter [data-tag-filter]')).to_have_count(3);tags.locator('[data-tag-filter=preset-work]').click()
 expect(tags.locator('#thread-list .thread')).to_have_count(1);expect(tags.locator('#thread-list .thread strong')).to_have_text('Help with debugging this programming error')
 tags.locator('[data-tag-filter=preset-work]').click();expect(tags.locator('#thread-list .thread')).to_have_count(2)
 tags.locator('#search').fill('#writ');expect(tags.locator('#thread-list .thread strong')).to_have_text(['Drafting and editing a short letter'])
 tags.locator('#search').fill('coding');expect(tags.locator('#thread-list .thread')).to_have_count(1);tags.locator('#search').fill('')
 tags.locator('[data-action=thread-group]').click();expect(tags.locator('#thread-list .thread-group h3')).to_have_text(['Coding','Writing'])
 expect(tags.locator('[data-action=thread-group]')).to_have_attribute('aria-pressed','true')
 # README shot: the sidebar grouped by tag, with the tag row and the title bar's tags.
 tags.set_viewport_size({'width':1280,'height':800});tags.evaluate("document.getElementById('toast').classList.add('hidden');document.activeElement?.blur()")
 tags.wait_for_timeout(200);tags.screenshot(path=str(root/'docs/tags.png'));tags.set_viewport_size({'width':1400,'height':900})
 checks.append('the sidebar’s tag row narrows the list to conversations with every chosen tag, #name finds tags, words match tag names, and threads group under their first tag')
 shapes=tags.evaluate("""()=>[...document.querySelectorAll('#tag-list .tag-look .tag-chip')].map(c=>{const s=getComputedStyle(c);return [c.dataset.style,parseFloat(s.borderTopLeftRadius),s.borderLeftWidth,s.borderTopColor,s.backgroundColor];})""")
 assert all(radius<=4 for _,radius,*_ in shapes),shapes
 by={s:(left,top,bg) for s,_,left,top,bg in shapes}
 assert by['stripe'][0]=='3px' and by['fill'][1]=='rgba(0, 0, 0, 0)',by
 tags.locator('[data-action=settings]').first.click();work=tags.locator('[data-tag=preset-work]');work.locator('.tag-look').click()
 tags.locator('#tag-settings-title').evaluate("e=>{const d=e.closest('dialog');d.scrollTop+=e.getBoundingClientRect().top-d.querySelector('.modal-head').getBoundingClientRect().bottom-8}");tags.evaluate("document.activeElement?.blur()")
 tags.wait_for_timeout(150);tags.locator('#settings-dialog').screenshot(path=str(root/'docs/settings-tags.png'))
 looks=work.locator('.tag-styles .tag-chip').evaluate_all("cs=>cs.map(c=>{const s=getComputedStyle(c);return [c.dataset.style,s.backgroundColor,s.borderTopColor,s.borderLeftWidth,getComputedStyle(c.querySelector('.tag-dot')).display];})")
 style={s:rest for s,*rest in looks};none='rgba(0, 0, 0, 0)'
 assert style['fill'][0]!=none and style['fill'][1]==none and style['outline'][0]==none and style['outline'][1]!=none,style
 assert style['both'][0]!=none and style['both'][1]!=none and style['stripe'][2]=='3px' and style['dot'][3]!='none' and style['fill'][3]=='none',style
 dark=work.locator('[data-pick-style=fill] .tag-chip').evaluate('c=>getComputedStyle(c).backgroundColor')
 tags.locator('.segmented[data-for=theme-mode] [data-value=light]').click();tags.wait_for_timeout(150)
 assert work.locator('[data-pick-style=fill] .tag-chip').evaluate('c=>getComputedStyle(c).backgroundColor')!=dark
 tags.keyboard.press('Escape')
 checks.append('tags have small corners in five styles (filled, outline, both, stripe, dot), drawn from the theme’s tokens in light and dark')
 tags.close()
 assert not errors,errors;assert len(blocked_styles)<=1,blocked_styles;assert not [r for r in requests if r.startswith(('http:','https:'))],requests
 checks.append('no JavaScript errors or external requests; CSP remains enforced during inert parsing')
 b.close()
result={'checks':len(checks),'passed':checks,'javascript_errors':errors,'external_requests':[],'expected_inert_parse_style_blocks':len(blocked_styles),'scope':'renderer only; synthetic provider and tool fixtures; no native Electron or Windows validation'}
(root/'docs/ui-checks.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result,indent=2))
