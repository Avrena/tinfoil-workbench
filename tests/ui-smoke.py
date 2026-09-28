"""Production renderer + synthetic offline bridge. NOT a native Electron test.
Requires Python and playwright. Use --chromium /path/to/chromium as necessary.
Security fixtures are injected into an in-memory copy of the preview, never into
packaged source or the distributed preview. No credentials or network required.
"""
import argparse
import base64
import json
from pathlib import Path
from playwright.sync_api import sync_playwright, expect
parser=argparse.ArgumentParser()
parser.add_argument('--chromium',default=None)
parser.add_argument('--no-sandbox',action='store_true',help='Isolated root-owned test containers only; never a production flag.')
args=parser.parse_args();root=Path(__file__).resolve().parents[1];checks=[]
html=(root/'preview/index.html').read_text(encoding='utf-8')
marker='const pause = ms => new Promise(r => setTimeout(r, ms));'
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
 page.locator('#composer-model').click();expect(page.locator('#model-dialog')).to_be_visible();page.keyboard.press('Escape')
 checks.append('model choice is available without opening the inspector')
 page.locator('#prompt').fill('Estimate a repair deadline from 142, 180 and 218 seconds.');page.locator('#send').click()
 expect(page.locator('.reply-content')).to_contain_text('synthetic preview response');expect(page.locator('#stop')).to_be_hidden()
 expect(page.locator('.reply-content math')).to_have_count(2);expect(page.locator('.reply-content > .markdown-segment table')).to_have_count(1);assert page.locator('.token').count()>0
 checks.append('streamed answer renders Markdown tables, highlighted code and native MathML')
 assert page.locator('.reasoning').evaluate('(e)=>!e.open');expect(page.locator('.usage')).to_have_count(0)
 page.locator('#transcript').evaluate('(e)=>e.scrollTop=0')
 page.screenshot(path=str(root/'docs/preview.png'),full_page=True)
 page.set_viewport_size({'width':1100,'height':850});page.screenshot(path=str(root/'docs/preview-compact.png'),full_page=True);page.set_viewport_size({'width':1500,'height':1180})
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
 page.locator('.toolbar [data-action="inspector"]').click();expect(page.locator('#inspector')).to_be_visible()
 page.locator('#instructions').fill('Keep the answer concrete.');page.locator('#tools-mode').select_option('ask');page.locator('#apply-settings').click();expect(page.locator('#tools-badge')).to_be_visible()
 page.locator('#inspector [data-action="inspector"]').click();expect(page.locator('#inspector')).to_be_hidden()
 checks.append('advanced instructions and ask-before-run controls persist only on apply')
 page.locator('#prompt').fill('A saved draft with 中文.');page.keyboard.press('Shift+Enter');assert page.locator('#prompt').input_value().endswith('\n')
 page.keyboard.press('Control+n');expect(page.locator('#prompt')).to_have_value('');page.locator('#thread-list button').nth(1).click();assert '中文' in page.locator('#prompt').input_value()
 checks.append('drafts and IME-friendly multiline input survive thread changes')
 page.keyboard.press('Control+k');page.locator('#palette-search').fill('settings');page.locator('#palette-search').press('Enter');expect(page.locator('#settings-dialog')).to_be_visible()
 page.locator('#api-key').fill('preview-must-not-store');page.locator('#save-key').click();expect(page.locator('#api-key')).to_have_value('');expect(page.locator('#toast')).to_contain_text('cannot accept API keys');page.keyboard.press('Escape')
 checks.append('command palette opens settings; preview rejects and clears credentials')
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
 expect(second.locator('#toast')).to_contain_text('Select a completed reply')
 second.locator('[data-action="choose"]').last.click();expect(second.locator('.chosen-label')).to_have_text('Selected')
 checks.append('comparison still requires a selected answer before continuation')
 second.locator('[data-action="branch"]').last.click()
 expect(second.locator('#thread-list button')).to_have_count(2)
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
 chip.click();expect(third.locator('#instructions-dialog')).to_be_visible();expect(third.locator('.instructions-intro')).to_contain_text('not required')
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
 third.locator('[data-instructions^="saved:"]').click();expect(name).to_have_text('Translator')
 checks.append('saving creates a reusable entry without applying it; selecting it copies the text into the conversation')
 chip.click();third.locator('.instruction-edit[data-edit^="saved:"]').click();third.locator('#instructions-delete').click();third.locator('[data-action=instructions-confirm-delete]').click()
 expect(third.locator('.instruction-empty')).to_be_visible();expect(third.locator('[data-instructions=current]')).to_contain_text('Translator')
 assert third.evaluate('window.__active().settings.systemPrompt')=='Answer in French.'
 checks.append('deleting saved instructions keeps the copy the conversation already uses')
 third.locator('.instruction-edit[data-edit=current]').click();third.locator('#instructions-text').fill('Changed but not applied');third.keyboard.press('Escape')
 expect(third.locator('#instructions-discard')).to_be_visible();expect(third.locator('#instructions-dialog')).to_be_visible()
 third.locator('[data-action=instructions-discard]').click();expect(third.locator('#instructions-dialog')).to_be_hidden()
 assert third.evaluate('window.__active().settings.systemPrompt')=='Answer in French.'
 checks.append('closing with unsaved instruction edits asks first and discarding changes nothing')
 third.locator('.toolbar [data-action=inspector]').click();expect(third.locator('#instructions-applied')).to_contain_text('Translator')
 third.locator('#instructions').fill('Use British spelling.');expect(third.locator('#instructions-applied')).to_contain_text('unnamed custom')
 chip.click();third.locator('[data-instructions=none]').click();expect(third.locator('#instructions-dialog .dialog-feedback')).to_contain_text('pending Advanced');third.keyboard.press('Escape')
 third.locator('#apply-settings').click();expect(name).to_have_text('Custom');assert third.evaluate('window.__active().settings.systemPromptName')==''
 checks.append('pending Advanced edits block the picker; edited Advanced text applies as unnamed custom instructions')
 chip.click();third.locator('[data-instructions=none]').click();expect(name).to_have_text('')
 assert third.evaluate('window.__active().settings')['systemPrompt']=='';expect(third.locator('.reply-signature').last).to_contain_text('Concise')
 checks.append('None turns custom instructions off for new requests without relabelling earlier replies')
 third.close()
 assert not errors,errors;assert len(blocked_styles)<=1,blocked_styles;assert not [r for r in requests if r.startswith(('http:','https:'))],requests
 checks.append('no JavaScript errors or external requests; CSP remains enforced during inert parsing')
 b.close()
result={'checks':len(checks),'passed':checks,'javascript_errors':errors,'external_requests':[],'expected_inert_parse_style_blocks':len(blocked_styles),'scope':'renderer only; synthetic provider and tool fixtures; no native Electron or Windows validation'}
(root/'docs/ui-checks.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result,indent=2))
