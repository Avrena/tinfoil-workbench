"""Execution choice follows saved hosts, not bridge support or transient SSH/auth state."""
import json
import os
import re
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

def remote_menu(page,item):
    """New task, Refresh and Manage are in the Remote toolbar's menu, as Chat keeps its secondary commands."""
    page.locator('#remote-toolbar .export-menu summary').click()
    page.locator(item).click()


root = Path(__file__).resolve().parents[1]
base = (root/'preview/index.html').read_text(encoding='utf8')
marker = 'window.tinfoil = Object.freeze({'
assert marker in base
instrument = r'''
window.__availability = {calls:[], hold:false, fail:false, release:null,
  offline:value=>{remoteUnavailable=value;}, roles:value=>{workspace.view={...workspace.view,roleMessages:value};emit();}};
const availabilityPreview = remotePreview;
remotePreview = async c => {
  const test=window.__availability;test.calls.push(c.type);
  if(c.type==='load'&&test.fail)throw Error('Synthetic configuration read failure');
  const result=await availabilityPreview(c);
  if(c.type==='load'&&test.hold)await new Promise(resolve=>{test.release=resolve;});
  return result;
};
'''
host = "remoteSample.hosts=[{id:'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',name:'Sandbox',alias:'demo-sandbox',draft:remoteDefaults()}];remoteSample.selectedHost=remoteSample.hosts[0].id;"

def html(extra=''):
    return base.replace(marker,instrument+extra+marker,1)

def sidebar(page):
    if not page.locator('#remote-nav').is_visible():
        page.locator('#main > .toolbar:not(.remote-toolbar) [data-action=sidebar]').click()
    page.locator('#remote-nav').click()

def add_host(page,name):
    page.locator('#remote-host-name').fill(name)
    page.locator('#remote-host-alias').fill(name.lower())
    page.locator('#remote-host-form button').click()
    expect(page.locator('#remote-execution')).to_be_visible()

def manage(page):
    if page.locator('#remote-manage-button').is_visible():
        remote_menu(page,'#remote-manage-button')
    else:
        page.locator('#remote-toolbar .export-menu summary').click()
        page.locator('#remote-toolbar .export-menu [data-remote=manage]').click()

checks=[]
with sync_playwright() as p:
    browser=p.chromium.launch(headless=True)
    errors=[]
    for width in [1440,390,320]:
        page=browser.new_page(viewport={'width':width,'height':1000})
        page.on('pageerror',lambda error:errors.append(str(error)))
        page.set_content(html())
        page.wait_for_function('window.__availability.calls.length===1')
        assert page.evaluate('window.__availability.calls')==['load']
        expect(page.locator('#execution-toggle')).to_be_hidden()
        expect(page.locator('#role-tab-row')).to_be_hidden()
        page.locator('#prompt').fill('Keep my local draft')
        sidebar(page)
        expect(page.locator('#remote-host-name')).to_be_visible()
        expect(page.locator('#remote-execution')).to_be_hidden()
        page.locator('#remote-back-chat').click()
        expect(page.locator('#prompt')).to_be_focused()
        expect(page.locator('#prompt')).to_have_value('Keep my local draft')
        sidebar(page)
        add_host(page,'First')
        expect(page.locator('#remote-back-chat')).to_be_hidden()
        # No Chat enrollment or workspace is needed to keep the configured host reachable.
        expect(page.locator('#remote-auth-state')).to_contain_text('Connect a dedicated')
        page.locator('#remote-execution [data-execution=local]').click()
        expect(page.locator('#execution-toggle')).to_be_visible()
        page.locator('#execution-toggle [data-execution=remote]').click()
        manage(page)
        page.locator('#remote-host-settings summary').click()
        add_host(page,'Second')
        expect(page.locator('#remote-host option')).to_have_count(2)
        page.locator('#remote-forget').click()
        expect(page.locator('#remote-host option')).to_have_count(1)
        expect(page.locator('#remote-execution')).to_be_visible()
        page.locator('#remote-forget').click()
        expect(page.locator('#remote-execution')).to_be_hidden()
        page.keyboard.press('Escape')
        expect(page.locator('#remote-host-name')).to_be_visible()
        page.locator('#remote-back-chat').click()
        expect(page.locator('#execution-toggle')).to_be_hidden()
        expect(page.locator('#role-tab-row')).to_be_hidden()
        expect(page.locator('#prompt')).to_have_value('Keep my local draft')
        page.evaluate('window.__availability.roles(true)')
        expect(page.locator('#role-tab')).to_be_visible()
        expect(page.locator('#execution-toggle')).to_be_hidden()
        assert page.locator('#role-tab').evaluate('e=>getComputedStyle(e).marginLeft')=='0px'
        assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
        assert 'submit' not in page.evaluate('window.__availability.calls')
        page.evaluate('window.__availability.roles(false)')
        if os.environ.get('UI_CAPTURE_DIR'):
            page.screenshot(path=str(Path(os.environ['UI_CAPTURE_DIR'])/f'chat-unconfigured-{width}.png'))
        page.close()
    checks.append('first use, setup return, add and forget hosts, local draft and role tabs at 320/390/1440px')

    page=browser.new_page(viewport={'width':1440,'height':1000})
    page.on('pageerror',lambda error:errors.append(str(error)))
    page.set_content(html(host+'window.__availability.hold=true;'))
    page.wait_for_function('window.__availability.release!==null')
    expect(page.locator('#execution-toggle')).to_be_hidden()
    sidebar(page)
    expect(page.locator('#remote-task-form')).to_be_visible()
    assert page.evaluate('window.__availability.calls')==['load']
    page.evaluate('window.__availability.hold=false;window.__availability.release()')
    expect(page.locator('#remote-execution')).to_be_visible()
    page.evaluate('window.__availability.offline(true)')
    remote_menu(page,'#remote-refresh')
    expect(page.locator('#remote-connection')).to_be_visible()
    expect(page.locator('#remote-execution')).to_be_visible()
    page.locator('#remote-execution [data-execution=local]').click()
    expect(page.locator('#execution-toggle')).to_be_visible()
    checks.append('startup and opening share a pending local read; an offline configured host retains its switch')

    page.set_content(html(host))
    expect(page.locator('#execution-toggle')).to_be_visible()
    assert page.evaluate('window.__availability.calls')==['load']
    checks.append('saved host reveals switch on startup without SSH, enrollment or job commands')

    page.set_content(html(host+'window.__availability.fail=true;'))
    page.wait_for_function('window.__availability.calls.length===1')
    expect(page.locator('#execution-toggle')).to_be_hidden()
    sidebar(page)
    expect(page.locator('#remote-feedback')).to_contain_text('Synthetic configuration read failure')
    page.locator('#remote-back-chat').click()
    page.evaluate('window.__availability.fail=false')
    sidebar(page)
    expect(page.locator('#remote-execution')).to_be_visible()
    checks.append('failed configuration read keeps switch hidden and setup can retry')

    no_bridge,count=re.subn(r'remote:\s*remotePreview,','remote:undefined,',html(host),count=1)
    assert count==1
    android,count=re.subn(r'sequence:\s*\+\+sequence,',"platform:'android',sequence:++sequence,",html(host),count=1)
    assert count==1
    for unsupported in [no_bridge,android]:
        page.set_content(unsupported)
        expect(page.locator('#composer-model')).to_contain_text('Demo')
        expect(page.locator('#execution-toggle')).to_be_hidden()
        assert page.evaluate('window.__availability.calls')==[]
    checks.append('unsupported bridge and Android never load remote configuration or show the switch')
    assert not errors,errors
    browser.close()
print(json.dumps({'checks':checks,'javascriptErrors':errors},indent=2))
