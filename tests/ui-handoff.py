"""Local-handoff UX regression. All hooks are injected only into a test copy.
The close transport is a mock; this does not exercise a native Windows window.
"""
import argparse,json
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
p=argparse.ArgumentParser();p.add_argument('--chromium',default=None);args=p.parse_args()
root=Path(__file__).resolve().parents[1];html=(root/'preview/index.html').read_text(encoding='utf-8');checks=[];errors=[]
marker='const pause = (ms) => new Promise((r) => setTimeout(r, ms));'
assert marker in html
html=html.replace(marker,marker+'''window.__handoffState=()=>snapshot();window.__closeReplies=[];window.__failDraft=false;''',1)
marker='snapshot: async () => snapshot(),'
assert marker in html
html=html.replace(marker,'onCloseRequested:fn=>{window.__requestClose=fn;return()=>{};},'+marker,1)
marker='    let extra;'
assert marker in html
html=html.replace(marker,marker+'''
    if(c.type==='window.close-ack')return {snapshot:snapshot()};
    if(c.type==='window.close-response'){window.__closeReplies.push(c);return {snapshot:snapshot()};}
    if(c.type==='thread.draft'&&window.__failDraft)throw new Error('Simulated encrypted save failed.');
''',1)
def check(label):checks.append(label)
def active(page):return page.evaluate('window.__handoffState().workspace.threads.find(t=>t.id===window.__handoffState().workspace.activeId)')
with sync_playwright() as pw:
 b=pw.chromium.launch(executable_path=args.chromium,headless=True,args=['--no-sandbox'])
 page=b.new_page(viewport={'width':1440,'height':1000});page.on('pageerror',lambda e:errors.append(str(e)));page.set_content(html)
 expect(page.locator('#pending-settings')).to_be_hidden();check('no pending-settings strip on an unchanged workspace')
 page.locator('#prompt').fill('Unsent draft 中文');page.locator('[data-action=attach]').click()
 expect(page.locator('#attachments')).to_contain_text('outline.md');page.wait_for_function('window.__handoffState().workspace.threads[0].draftAttachments.length===1')
 assert active(page)['draft']=='Unsent draft 中文';assert len(active(page)['turns'])==0;check('attaching a file persists unsent text and reference without sending')
 page.locator('#prompt').fill('Latest keystrokes');page.evaluate("window.__requestClose('close-1')")
 page.wait_for_function('window.__closeReplies.length===1');assert page.evaluate('window.__closeReplies[0].allow') is True
 assert active(page)['draft']=='Latest keystrokes';assert len(active(page)['draftAttachments'])==1;check('native-close request flushes newest text and references before approval')
 page.locator('[data-remove-file]').click();page.evaluate("window.__requestClose('close-2')");page.wait_for_function('window.__closeReplies.length===2');assert active(page)['draftAttachments']==[];check('attachment removal also survives a close immediately after the click')
 page.evaluate('window.__failDraft=true');page.locator('#prompt').fill('Not saved yet');page.evaluate("window.__requestClose('close-3')");page.wait_for_function('window.__closeReplies.length===3');assert page.evaluate('window.__closeReplies[2].allow') is False
 expect(page.locator('#prompt')).to_have_value('Not saved yet');page.evaluate('window.__failDraft=false');check('failed encrypted write prevents close and retains the composer text')
 # A failed draft flush must also block editor/navigation paths.
 page.evaluate('window.__failDraft=true');page.locator('[data-action=edit-draft]').click();expect(page.locator('#edit-dialog')).to_have_count(1);expect(page.locator('#edit-dialog')).to_be_hidden();expect(page.locator('#prompt')).to_have_value('Not saved yet');page.evaluate('window.__failDraft=false');check('failed draft save does not open an editor on potentially stale content')
 # Per-thread Advanced drafts are local until Apply.
 first=active(page)['id'];page.locator('.toolbar [data-action=inspector]').click();page.locator('#instructions').fill('Pending optional instructions')
 expect(page.locator('#pending-settings')).to_be_visible();assert active(page)['settings']['systemPrompt']==''
 page.locator('#inspector [data-action=inspector]').click();page.keyboard.press('Control+n');second=active(page)['id'];assert first!=second
 expect(page.locator('#pending-settings')).to_be_hidden();page.locator(f'[data-thread="{first}"]').click();expect(page.locator('#pending-settings')).to_be_visible()
 page.locator('.toolbar [data-action=inspector]').click();expect(page.locator('#instructions')).to_have_value('Pending optional instructions');check('unapplied Advanced edits survive thread navigation without changing request settings')
 page.locator('#inspector [data-action=inspector]').click();page.locator('[data-action=apply-pending]').click();expect(page.locator('#pending-settings')).to_be_hidden();assert active(page)['settings']['systemPrompt']=='Pending optional instructions';check('pending settings can be applied from the conversation without reopening Advanced')
 page.locator('.toolbar [data-action=inspector]').click();page.locator('#instructions').fill('Discard me');page.locator('#inspector [data-action=inspector]').click();page.locator('[data-action=discard-pending]').click();assert active(page)['settings']['systemPrompt']=='Pending optional instructions';expect(page.locator('#pending-settings')).to_be_hidden();check('discarding Advanced draft restores applied settings instead of sending it')
 # Model-dependent effort controls must be rebuilt before a pending selection is restored.
 page.locator('.toolbar [data-action=inspector]').click();page.locator('#model').fill('deepseek-v4-pro');page.locator('#reasoning').select_option('max');page.locator('#inspector [data-action=inspector]').click()
 page.locator(f'[data-thread="{second}"]').click();page.locator(f'[data-thread="{first}"]').click();page.locator('.toolbar [data-action=inspector]').click();expect(page.locator('#reasoning')).to_be_visible();expect(page.locator('#reasoning')).to_have_value('max');expect(page.locator('#model')).to_have_value('deepseek-v4-pro');check('pending model changes restore their supported effort options and selection after a thread switch')
 page.locator('#inspector [data-action=inspector]').click();page.locator('[data-action=discard-pending]').click()
 # Clear instructions (they remain optional) and inspect API key dismissal.
 page.locator('.toolbar [data-action=inspector]').click();expect(page.locator('#instructions')).to_have_value('Pending optional instructions');check('Discard restores the actual Advanced field even when the applied-settings render signature is unchanged');page.locator('#instructions').fill('');page.locator('#apply-settings').click();page.locator('#inspector [data-action=inspector]').click();assert active(page)['settings']['systemPrompt']=='';check('blank system instructions remain a supported ordinary-chat setting')
 page.keyboard.press('Control+,');page.locator('#api-key').fill('not-a-real-key');page.keyboard.press('Escape');page.keyboard.press('Control+,');expect(page.locator('#api-key')).to_have_value('');check('closing Settings clears an unsubmitted credential field')
 page.locator('#api-key').fill('synthetic-rejected-key');page.locator('#save-key').click();expect(page.locator('#settings-dialog .dialog-feedback')).to_contain_text('cannot accept API keys');check('dialog failures appear inside the active top-layer dialog, not just behind it')
 assert page.locator('#settings-dialog').get_attribute('aria-labelledby');page.keyboard.press('Escape');check('settings dialog exposes an accessible heading')
 # Mock native close review over the actual unsaved editor.
 page.locator('[data-action=edit-draft]').click();page.locator('#editor-content').fill('Unsaved editor buffer');page.evaluate("window.__requestClose('close-4')");expect(page.locator('#close-dialog')).to_be_visible();expect(page.locator('#close-detail')).to_contain_text('open editor has unsaved changes')
 page.screenshot(path=str(root/'docs/handoff-close-review.png'));page.locator('[data-action=keep-open]').click();expect(page.locator('#close-dialog')).to_be_hidden();expect(page.locator('#editor-content')).to_have_value('Unsaved editor buffer');assert page.evaluate('window.__closeReplies.at(-1).allow') is False;check('native close protects the open editor and Keep working preserves the buffer')
 # Escape answers the dialog on top (close review), not the editor that is later in the DOM.
 page.evaluate("window.__requestClose('close-4b')");expect(page.locator('#close-dialog')).to_be_visible();page.keyboard.press('Escape');expect(page.locator('#close-dialog')).to_be_hidden();expect(page.locator('#edit-dialog')).to_be_visible();expect(page.locator('.editor-discard')).to_be_hidden();expect(page.locator('#editor-content')).to_have_value('Unsaved editor buffer');page.wait_for_function('window.__closeReplies.length===5');assert page.evaluate('window.__closeReplies.at(-1).allow') is False;check('Escape answers the close review on top, not the editor underneath, and keeps its buffer')
 page.evaluate("window.__requestClose('close-5')");expect(page.locator('#close-dialog')).to_be_visible();page.locator('[data-action=confirm-close]').click();page.wait_for_function('window.__closeReplies.length===6');assert page.evaluate('window.__closeReplies.at(-1).allow') is True;assert active(page)['draft']!='Unsaved editor buffer';check('explicit close discards uncommitted editor changes without silently saving them as an answer')
 # Clean up only the mock window, then exercise keyboard/touch dialog behavior.
 page.locator('[data-editor=close]').first.click();page.locator('[data-editor=discard]').click()
 page.locator('.toolbar [data-action=inspector]').click();page.locator('#instructions').fill('Pending');page.locator('#inspector [data-action=inspector]').click();page.evaluate("window.__requestClose('close-6')");expect(page.locator('#close-detail')).to_contain_text('Unapplied');page.keyboard.press('Escape');expect(page.locator('#pending-settings')).to_be_visible();assert page.evaluate('window.__closeReplies.at(-1).allow') is False;check('Escape from close review means keep working and preserves unapplied settings')
 page.locator('[data-action=discard-pending]').click()
 page.locator('#prompt').fill('Show an inline visualization demo.');page.locator('#send').click();expect(page.locator('#stop')).to_be_visible();page.evaluate("window.__requestClose('close-7')");expect(page.locator('#close-detail')).to_contain_text('active response');page.locator('[data-action=keep-open]').click();expect(page.locator('#stop')).to_be_hidden(timeout=15000);check('close review identifies active work; keeping open allows it to finish')
 page.locator('#transcript').evaluate('(e)=>e.scrollTop=0');page.screenshot(path=str(root/'docs/handoff-desktop.png'))
 # Genuine pointer clicks, no forced click or layout-settle sleeps in the loop.
 for n in range(12):
  page.locator('.toolbar [data-action=view]').click();loc=page.locator('#view-metadata');before=loc.is_checked();loc.click();assert loc.is_checked()!=before;page.keyboard.press('Escape')
  page.keyboard.press('Control+Shift+f');page.keyboard.press('Control+Shift+f');page.keyboard.press('Control+b');page.keyboard.press('Control+b')
  page.locator('.toolbar [data-action=view]').click();loc=page.locator('#view-wrapCode');before=loc.is_checked();loc.click();assert loc.is_checked()!=before;page.keyboard.press('Escape')
 check('12 rapid reading/focus/sidebar cycles complete with 24 genuine checkbox clicks; no artificial settling delay')
 for width,height in [(320,740),(390,844),(820,1180),(1024,768)]:
  context=b.new_context(viewport={'width':width,'height':height},is_mobile=width<600,has_touch=True);mobile=context.new_page();mobile.on('pageerror',lambda e:errors.append(str(e)));mobile.set_content(html)
  mobile.locator('[data-action=edit-draft]').tap();mobile.locator('#editor-content').fill('Touch edit');mobile.evaluate("window.__requestClose('touch-close')");expect(mobile.locator('#close-dialog')).to_be_visible();box=mobile.locator('[data-action=keep-open]').bounding_box();assert box['x']>=0 and box['y']>=0 and box['x']+box['width']<=width+1 and box['y']+box['height']<=height+1
  assert mobile.evaluate('document.documentElement.scrollWidth<=innerWidth');mobile.locator('[data-action=keep-open]').tap();expect(mobile.locator('#editor-content')).to_have_value('Touch edit');check(f'{width}x{height} touch close review is reachable, wrap-safe and preserves edits')
  if width==390:mobile.screenshot(path=str(root/'docs/handoff-editor-phone.png'))
  context.close()
 b.close()
assert not errors,errors
result={'checks':len(checks),'passed':checks,'javascript_errors':errors,'scope':'Chromium renderer and injected close transport; no native Windows lifecycle or credentials'}
(root/'docs/ui-handoff-checks.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result,indent=2))
