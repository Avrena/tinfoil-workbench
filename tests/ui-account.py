"""Production account renderer with synthetic state. Never signs into a real account."""
import argparse,json
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
p=argparse.ArgumentParser();p.add_argument('--chromium',default='/usr/bin/chromium');args=p.parse_args()
root=Path(__file__).resolve().parents[1];html=(root/'preview/index.html').read_text();checks=[];errors=[];requests=[]
marker='const pause = ms => new Promise(r => setTimeout(r, ms));'
fixture='''
window.__accountPatch=patch=>{previewAccount={...previewAccount,...patch};emit();};
window.__accountState=()=>snapshot();
window.__accountBusy=value=>{busy=value?workspace.activeId:null;emit();};
window.__accountPulse=()=>emit();
'''
assert marker in html;html=html.replace(marker,marker+fixture,1)
def check(label):checks.append(label)
def open_account(page,touch=False):
    menu=page.locator('.export-menu > summary');(menu.tap if touch else menu.click)()
    b=page.locator('.export-popover [data-action=account]');(b.tap if touch else b.click)()
    expect(page.locator('#account-dialog')).to_be_visible()
def sample(page):page.locator('[data-action=account-sample]').click()
with sync_playwright() as pw:
    browser=pw.chromium.launch(executable_path=args.chromium,headless=True,args=['--no-sandbox'])
    page=browser.new_page(viewport={'width':1440,'height':1000});page.on('pageerror',lambda e:errors.append(str(e)));page.on('request',lambda r:requests.append(r.url));page.set_content(html);page.wait_for_selector('#prompt')
    page.locator('#account-footer').click();expect(page.locator('#account-title')).to_have_text('Account & connection');expect(page.locator('.account-state')).to_have_text('Not signed in');check('sidebar Account entry opens the signed-out account view')
    expect(page.locator('.account-optional')).to_contain_text('optional—not required');assert page.locator('#account-dialog input[type=password]').count()==0;check('account view states optional custom instructions and does not collect a password or pasted session token')
    expect(page.locator('[data-action=account-mode-api]')).to_have_attribute('aria-pressed','true');assert page.locator('[data-key=account-usage]').count()==0;check('legacy API mode remains selected and no signed-out usage or profile is invented')
    page.screenshot(path=str(root/'docs/account-signed-out.png'))
    page.locator('[data-action=account-login]').click();expect(page.locator('#toast')).to_contain_text('Offline preview cannot sign in');expect(page.locator('.account-state')).to_have_text('Not signed in');check('preview sign-in refuses credentials and cannot claim success')
    page.keyboard.press('Escape');expect(page.locator('#account-dialog')).not_to_be_visible();expect(page.locator('#account-footer')).to_be_focused();check('Escape closes account and restores focus to its opener')
    open_account(page);check('conversation menu also opens Account without requiring a visible sidebar')
    sample(page);expect(page.locator('.account-identity h3')).to_have_text('Sample Account');expect(page.locator('.account-identity')).to_contain_text('sample@example.invalid');expect(page.locator('.account-message')).to_contain_text('not your account');check('the explicit sample action shows labelled synthetic identity, not the current user')
    expect(page.locator('[data-action=account-mode-chat]')).to_have_attribute('aria-pressed','true');expect(page.locator('.account-verified')).to_have_text('Verified email');assert page.locator('#account-dialog img').count()==0;check('account mode is explicit and initials need no remote avatar request')
    usage=page.locator('[data-key=account-usage]');assert usage.get_attribute('open') is None;check('subscription and usage details start closed for progressive disclosure')
    page.locator('#toast').evaluate("e=>e.classList.add('hidden')");page.screenshot(path=str(root/'docs/account-profile.png'))
    usage.locator('> summary').click();expect(usage).to_contain_text('Token issued by Tinfoil');expect(usage).to_contain_text('76,000 remaining / 100,000');expect(usage).to_contain_text('14,000 remaining / 20,000');expect(usage).to_contain_text('Not reported');check('expanded usage shows supplied token budgets and does not invent an expiry or request quota')
    page.evaluate('window.__accountPulse()');assert usage.get_attribute('open') is not None;check('an unchanged snapshot retains the expanded usage view')
    page.screenshot(path=str(root/'docs/account-usage.png'))
    for action in ['account-refresh','account-manage','account-signout']:
        page.locator(f'[data-action={action}]').click();expect(page.locator('#toast')).to_contain_text('Offline preview cannot sign in');expect(page.locator('.account-state')).to_have_text('Signed in')
    check('preview refresh, profile management and sign-out refuse real-account operations')
    page.evaluate("window.__accountPatch({entitlement:'subscription-required',usage:null,message:'Tinfoil reports that a Chat subscription is required.'})");expect(usage).to_contain_text('Subscription required');expect(page.locator('[data-action=account-mode-chat]')).to_have_attribute('aria-pressed','true');assert page.locator('[data-action=account-connect]').count()==0;check('missing subscription removes connection action without changing to developer billing')
    page.evaluate("window.__accountPatch({entitlement:'rate-limited',message:'Tinfoil reports a usage limit.'})");expect(usage).to_contain_text('Usage limit reached');check('usage limits have a distinct account state')
    page.evaluate("window.__accountPatch({status:'expired',entitlement:'unknown',message:'Your Tinfoil session expired.'})");expect(page.locator('[data-action=account-login]')).to_have_text('Reconnect Tinfoil Chat');expect(page.locator('.account-state')).to_have_text('Session needs attention');check('expired sessions ask for reconnection rather than a new API key')
    page.evaluate("window.__accountPatch({profile:null,status:'signing-in',message:null})");expect(page.locator('[data-action=account-cancel]')).to_be_visible();expect(page.locator('[data-action=account-mode-api]')).to_be_disabled();check('pending sign-in has a cancel action and cannot change modes')
    page.locator('[data-action=account-cancel]').click();expect(page.locator('#toast')).to_contain_text('Offline preview');check('preview cancellation never claims to have touched a real provider session')
    page.evaluate("window.__accountPatch({status:'signed-out'})");sample(page);page.evaluate("window.__accountBusy(true)");expect(page.locator('[data-action=account-mode-api]')).to_be_disabled();expect(page.locator('[data-action=account-manage]')).to_be_disabled();expect(page.locator('[data-action=account-signout]')).to_be_enabled();check('active response prevents connection changes while sign-out remains reachable')
    page.evaluate('window.__accountBusy(false)');page.locator('[data-action=account-mode-api]').click();expect(page.locator('[data-action=account-mode-api]')).to_have_attribute('aria-pressed','true');expect(page.locator('.account-state')).to_have_text('Signed in');check('selecting API mode neither signs out nor changes identity')
    page.locator('[data-action=account-api]').click();expect(page.locator('#settings-dialog')).to_be_visible();expect(page.locator('#save-key')).to_have_text('Save & verify');check('developer access stays in its existing Settings form')
    page.locator('#settings-dialog [data-action=account]').click();page.locator('[data-action=account-mode-chat]').click();page.keyboard.press('Escape');page.keyboard.press('Control+,');expect(page.locator('#save-key')).to_have_text('Save key only');page.locator('#save-key').click();expect(page.locator('#key-feedback')).to_contain_text('No new API key entered');assert page.evaluate('window.__accountState().connectionMode')=='chat-account';check('saving an empty key in account mode performs no verification or implicit billing switch')
    page.keyboard.press('Escape');page.locator('[data-action=inspector]').first.click();expect(page.locator('label[for=instructions]')).to_contain_text('Optional');expect(page.locator('#system-optional')).to_contain_text('Not required');page.locator('#instructions').fill('');page.locator('#apply-settings').click();assert page.evaluate('window.__accountState().workspace.threads[0].settings.systemPrompt')=='';check('blank custom system instructions save successfully with no required-field constraint')
    open_account(page);page.evaluate("window.__accountPatch({profile:{...window.__accountState().account.profile,name:'<img src=x onerror=alert(1)>',email:'<script>attack</script>',id:'user_sample'}})");expect(page.locator('.account-identity h3')).to_have_text('<img src=x onerror=alert(1)>');assert page.locator('#account-body img,#account-body script').count()==0;check('provider profile text is escaped rather than interpreted as HTML')
    page.close()
    for width,height in [(320,740),(390,844),(600,850),(820,1180),(1024,768),(1280,800)]:
        context=browser.new_context(viewport={'width':width,'height':height},has_touch=True,is_mobile=True,device_scale_factor=1);page=context.new_page();page.on('pageerror',lambda e:errors.append(str(e)));page.on('request',lambda r:requests.append(r.url));page.set_content(html);page.wait_for_selector('#prompt');open_account(page,True)
        dialog=page.locator('#account-dialog');box=dialog.bounding_box();assert box['x']>=-1 and box['x']+box['width']<=width+1;assert page.evaluate('document.documentElement.scrollWidth<=innerWidth+1');check(f'{width}px: account fits the viewport without horizontal page overflow')
        if width<=600:assert abs(box['width']-width)<=1 and box['y']==0
        check(f'{width}px: fullscreen phone layout or centered tablet dialog uses available space')
        page.locator('[data-action=account-sample]').tap();usage=page.locator('[data-key=account-usage]');usage.locator('> summary').tap();body=page.locator('#account-body');body.evaluate('e=>e.scrollTop=e.scrollHeight');close=page.locator('#account-dialog .modal-head [data-action=dismiss]');expect(close).to_be_visible();assert close.bounding_box()['y']+close.bounding_box()['height']<=height;check(f'{width}px: profile content scrolls without hiding the close control')
        optional=page.locator('.account-optional');optional.scroll_into_view_if_needed();expect(optional).to_be_in_viewport();check(f'{width}px: optional-system-prompt reminder remains reachable at the end of the panel')
        page.evaluate("window.__accountPatch({profile:{...window.__accountState().account.profile,name:'A very long profile name for checking wrapping on a small display',email:'averylongmailboxaddress012345678901234567890123456789@example.invalid'}})");assert page.evaluate('document.documentElement.scrollWidth<=innerWidth+1');assert body.evaluate('e=>e.scrollWidth<=e.clientWidth+1');check(f'{width}px: long account names and emails wrap within the dialog')
        close.tap();expect(dialog).not_to_be_visible();assert page.locator('.titlebar').bounding_box()['y']>=-1;check(f'{width}px: tapping close does not scroll the app titlebar out of view')
        open_account(page,True);page.evaluate("window.__accountPatch({profile:{...window.__accountState().account.profile,name:'Sample Account',email:'sample@example.invalid'}})");body.evaluate('e=>e.scrollTop=0');page.locator('#toast').evaluate("e=>e.classList.add('hidden')")
        # Rotation keeps the visible panel and the existing disclosure state.
        page.set_viewport_size({'width':height,'height':width});expect(dialog).to_be_visible();assert page.evaluate('document.documentElement.scrollWidth<=innerWidth+1');check(f'{width}px: rotation preserves the account dialog without horizontal overflow')
        page.set_viewport_size({'width':width,'height':height});body.evaluate('e=>e.scrollTop=0');page.wait_for_timeout(100)
        if width in [390,820]:
            usage=page.locator('[data-key=account-usage]')
            if usage.get_attribute('open') is not None:usage.locator('> summary').tap()
            body.evaluate('e=>e.scrollTop=0');page.screenshot(path=str(root/'docs'/('account-phone.png' if width==390 else 'account-tablet.png')))
        context.close()
    assert not errors,errors;assert not [url for url in requests if url.startswith(('http:','https:'))],requests;check('account rendering checks produced no JavaScript errors or network requests')
    browser.close()
report={'checks':len(checks),'passed':checks,'javascript_errors':errors,'scope':'Production renderer on Linux Chromium; synthetic account snapshots and emulated touch; no live sign-in, native Electron, billing changes or account edits.'}
(root/'docs/ui-account-checks.json').write_text(json.dumps(report,indent=2));print(json.dumps(report,indent=2))
