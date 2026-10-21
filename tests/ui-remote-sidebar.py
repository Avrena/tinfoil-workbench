"""Configured remote tasks share the Cloud / Remote / Local sidebar switch. Synthetic data only; no SSH/inference."""
import json, os, re
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

root=Path(__file__).resolve().parents[1]
base=(root/'preview/index.html').read_text(encoding='utf8')
marker='window.tinfoil = Object.freeze({'
assert marker in base
fixture=r'''
const sidebarHost='aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', sidebarWorkspace='bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
remoteSample.hosts=[{id:sidebarHost,name:'Sandbox',alias:'demo-sandbox',draft:{...remoteDefaults(),workspace:sidebarWorkspace}}];
remoteSample.selectedHost=sidebarHost;remoteEnrolled=true;
remoteWorkspaces.push({id:sidebarWorkspace,name:'Demo workspace',createdAt:Date.now()/1000,lastUsed:Date.now()/1000,quotaBytes:2147483648,activeJobs:[]});
remoteJobs.push({id:'cccccccccccccccccccccccccccccccc',workspace:sidebarWorkspace,prompt:'Review the workspace',model:'deepseek-v4-1-flash',status:'complete',createdAt:Date.now()/1000,content:'Review complete.',tools:[]});
remoteJobs.push({id:'dddddddddddddddddddddddddddddddd',workspace:'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',prompt:'A task in an older workspace',model:'deepseek-v4-1-flash',status:'stopped',createdAt:Date.now()/1000,content:'Partial output retained.',tools:[]});
previewCloud={...previewCloud,state:'ready'};
window.__sidebar={calls:[],offline:value=>{remoteUnavailable=value},cloud:value=>{previewCloud={...previewCloud,state:value?'ready':'off'};emit()},
  rename:()=>{remoteSample.hosts[0].jobTitles={'cccccccccccccccccccccccccccccccc':'<img src=x> Reviewed safely'}},
  clear:()=>{remoteJobs.length=0;}};
const sidebarPreview=remotePreview;
remotePreview=async c=>{window.__sidebar.calls.push(c.type);return sidebarPreview(c)};
'''
def html(extra=''):
    return base.replace(marker,fixture+extra+marker,1)

def open_sidebar(page):
    if not page.locator('#nav-threads').is_visible():
        page.locator('.toolbar:visible [data-action=sidebar]').click()

def tab(page,name):
    open_sidebar(page);page.locator(f'.thread-tabs [data-tab={name}]').click()

def remote_menu(page,selector):
    page.locator('#remote-toolbar .export-menu summary').click();page.locator(selector).click()

checks=[];errors=[]
with sync_playwright() as p:
    browser=p.chromium.launch(headless=True)
    for width in [1440,390,320]:
        page=browser.new_page(viewport={'width':width,'height':1000})
        page.set_default_timeout(10000)
        page.on('pageerror',lambda e:errors.append(str(e)))
        page.set_content(html())
        expect(page.locator('[data-tab=remote]')).to_have_count(1)
        assert page.locator('.thread-tabs button').evaluate_all('(es)=>es.map(e=>e.dataset.tab)')==['cloud','remote','local']
        assert page.evaluate('window.__sidebar.calls')==['load']
        page.locator('#prompt').fill('Local draft stays here')
        tab(page,'remote');expect(page.locator('#remote-prompt')).to_be_visible()
        page.locator('#remote-prompt').fill('Remote draft stays here')
        open_sidebar(page)
        expect(page.locator('[data-tab=remote]')).to_have_attribute('aria-pressed','true')
        rows=page.locator('#nav-threads [data-action=remote-job]');expect(rows).to_have_count(2)
        expect(page.locator('#nav-threads')).to_contain_text('Demo workspace')
        expect(page.locator('#nav-threads')).to_contain_text('Workspace eeeeeeee')
        assert page.locator('#nav-threads [data-thread]').count()==0
        assert page.locator('.thread-tabs').evaluate('(e)=>e.scrollWidth<=e.clientWidth')
        for button in page.locator('.thread-tabs button').all():
            assert button.evaluate('(e)=>e.scrollWidth<=e.clientWidth')
        if width==1440:
            screenshots=Path(os.environ.get('TINFOIL_UI_OUTPUT',str(root.parent/'remote-sidebar/screens')))
            screenshots.mkdir(parents=True,exist_ok=True)
            page.locator('.sidebar').screenshot(path=str(screenshots/'remote-sidebar.png'))
        rows.first.click();expect(page.locator('#remote-heading')).to_contain_text('Review the workspace')
        expect(page.locator('#remote-job-output')).to_contain_text('Review complete.')
        open_sidebar(page)
        expect(rows.first).to_have_attribute('aria-current','page')
        page.locator('#search').fill('older');expect(rows).to_have_count(1)
        page.locator('#search').fill('not found');expect(page.locator('#nav-threads')).to_contain_text('No matching remote tasks')
        page.locator('#search').fill('')
        page.locator('[data-action=nav-fold][data-section=threads]').click();expect(page.locator('#nav-threads')).to_be_hidden()
        expect(page.locator('#shell')).to_have_class(re.compile(r'\bremote-mode\b'))
        page.locator('[data-action=nav-fold][data-section=threads]').click()
        page.evaluate('window.__sidebar.rename()')
        page.locator('[data-action=remote-refresh]').click()
        expect(rows.first).to_contain_text('<img src=x> Reviewed safely')
        assert page.locator('#nav-threads img').count()==0
        expect(rows.first).to_have_attribute('aria-current','page')
        page.evaluate('window.__sidebar.offline(true)');page.locator('[data-action=remote-refresh]').click()
        expect(page.locator('.remote-thread-host')).to_contain_text('Last known');expect(rows).to_have_count(2)
        page.evaluate('window.__sidebar.offline(false)')
        tab(page,'local');expect(page.locator('#prompt')).to_have_value('Local draft stays here')
        open_sidebar(page);expect(page.locator('[data-tab=local]')).to_have_attribute('aria-pressed','true')
        assert page.locator('#nav-threads [data-action=remote-job]').count()==0
        tab(page,'cloud');expect(page.locator('[data-tab=cloud]')).to_have_attribute('aria-pressed','true')
        tab(page,'remote');expect(page.locator('#remote-prompt')).to_have_value('Remote draft stays here')
        page.keyboard.press('Control+n');open_sidebar(page)
        expect(page.locator('[data-tab=remote]')).to_have_attribute('aria-pressed','true')
        assert page.locator('#nav-threads [data-action=remote-job][aria-current=page]').count()==0
        page.evaluate('window.__sidebar.clear()');page.locator('[data-action=remote-refresh]').click()
        expect(page.locator('#nav-threads')).to_contain_text('No remote tasks yet')
        if width<600:page.keyboard.press('Escape')
        remote_menu(page,'#remote-manage-button');page.locator('#remote-forget').click();page.keyboard.press('Escape')
        assert page.locator('[data-tab=remote]').count()==0
        assert page.locator('.thread-tabs button').evaluate_all('(es)=>es.map(e=>e.dataset.tab)')==['cloud','local']
        assert not set(page.evaluate('window.__sidebar.calls')) & {'submit','job.stop','job.delete','workspace.delete','workspace.create'}
        page.close()
    checks.append('1440/390/320px: Cloud / Remote / Local fits the sidebar; remote rows group by workspace and open the selected transcript')
    checks.append('Search, folding, rename, refresh, empty and offline states keep Remote selected; titles are escaped and selection follows New task')
    checks.append('Cloud/Local return to Chat with independent drafts intact; forgetting the last host removes Remote without starting or stopping a job')

    for extra,expected in [
        ("previewCloud={...previewCloud,state:'off'};",['remote','local']),
        ("remoteSample.hosts=[];remoteSample.selectedHost=null;",['cloud','local']),
        ("remoteSample.hosts=[];remoteSample.selectedHost=null;previewCloud={...previewCloud,state:'off'};",[]),
        ('android',['cloud','local']),
    ]:
        page=browser.new_page();page.on('pageerror',lambda e:errors.append(str(e)))
        content=html('' if extra=='android' else extra)
        if extra=='android':
            content, patched=re.subn(r'sequence: \+\+sequence,', 'sequence: ++sequence, platform: "android",',content,count=1)
            assert patched==1
        page.set_content(content);page.wait_for_timeout(100)
        actual=page.locator('.thread-tabs button').evaluate_all('(es)=>es.map(e=>e.dataset.tab)')
        assert actual==expected,(extra,actual,expected)
        assert not set(page.evaluate('window.__sidebar.calls')) - {'load'}
        if 'android' in extra:assert page.evaluate('window.__sidebar.calls')==[]
        page.close()
    checks.append('Only configured sources appear: Remote/Local without cloud, Cloud/Local without hosts, no switch for Local alone, and no Remote on Android')
    browser.close()
print(json.dumps({'checks':checks,'javascriptErrors':errors},indent=2))
assert not errors,errors
