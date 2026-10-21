"""Shared Chat/Remote surfaces against synthetic bridge data; no SSH or inference."""
import importlib.util, json, os
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

def remote_menu(page,item):
    """New task, Refresh and Manage are in the Remote toolbar's menu, as Chat keeps its secondary commands."""
    page.locator('#remote-toolbar .export-menu summary').click()
    page.locator(item).click()


root=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('remote_fixture',root/'tests/ui-remote-transcript.py')
fixture=importlib.util.module_from_spec(spec);spec.loader.exec_module(fixture)
seed=r'''
const sharedPrompt='Explain the result and show the calculation.';
const sharedContent='**The check passed.** The calculation is $x^2 + y^2 = z^2$.\n\n```python\nprint("hello")\n```';
const sharedThread=workspace.threads.find(t=>t.id===workspace.activeId);
sharedThread.title=sharedPrompt;
Object.assign(sharedThread.settings,{model:'deepseek-v4-pro',systemPrompt:'Explain clearly.',systemPromptName:'Clear answers'});
Object.assign(workspace.view,{sidebar:false,inspector:false,motion:'reduced',reasoning:'collapsed',markdown:true,math:true});
sharedThread.turns=[{id:'shared-turn',prompt:sharedPrompt,attachments:[],createdAt:1,selectedReplyId:'shared-reply',replies:[{id:'shared-reply',model:'deepseek-v4-pro',content:sharedContent,reasoning:'Synthetic returned reasoning.',systemPromptName:'Clear answers',status:'complete',finishReason:'stop',error:null,usage:null,elapsedMs:1000,tools:[],toolMessages:[]}]}];
Object.assign(transcriptJob,{prompt:sharedPrompt,content:sharedContent,rounds:1,calls:0,tools:[],transcript:[{id:'assistant-0',role:'assistant',content:sharedContent,reasoning:'Synthetic returned reasoning.'}]});
Object.assign(remoteSample.hosts[0].draft,{model:'deepseek-v4-pro',systemPrompt:'Explain clearly.',systemPromptName:'Clear answers'});
window.__sharedCalls=[];window.__sharedClip='';
const sharedRemote=remotePreview;remotePreview=async c=>{window.__sharedCalls.push(structuredClone(c));return sharedRemote(c);};
'''
html=fixture.seeded().replace('window.tinfoil = Object.freeze({',seed+'window.tinfoil = Object.freeze({',1)
assert 'await navigator.clipboard.writeText(c.text)' in html
html=html.replace('await navigator.clipboard.writeText(c.text)','window.__sharedClip=c.text')
checks=[];errors=[]
def capture(page,name):
    if os.environ.get('UI_CAPTURE_DIR'):page.screenshot(path=str(Path(os.environ['UI_CAPTURE_DIR'])/name))
def open_remote(page):
    page.locator('#execution-toggle [data-execution=remote]').click()
    page.locator('#remote-jobs-button').click()
    page.locator('#remote-job-list [data-remote-job="cccccccccccccccccccccccccccccccc"]').click()
    expect(page.locator('#remote-job-output .reply-content')).to_have_count(1)
def local(page):page.locator('#remote-execution [data-execution=local]').click()
def reading(page,remote=False):
    toolbar=page.locator('#remote-toolbar' if remote else '#main > .toolbar:not(.remote-toolbar)')
    button=toolbar.locator('[data-action=view]')
    if button.is_visible():button.click()
    else:
        toolbar.locator('.export-menu > summary').click();toolbar.locator('[data-action=mobile-view]').click()
def close_advanced(page):
    if page.locator('#inspector').is_visible():page.locator('#inspector [data-action=inspector]').click() if page.viewport_size['width']>1000 else page.keyboard.press('Escape')

with sync_playwright() as p:
    browser=p.chromium.launch(headless=True)
    page=browser.new_page(viewport={'width':1440,'height':1000});page.on('pageerror',lambda e:errors.append(str(e)))
    page.set_content(html);expect(page.locator('#reply-shared-reply')).to_be_visible()
    open_remote(page)
    output=page.locator('#remote-job-output')
    expect(output.locator('math')).to_have_count(1)
    expect(output.locator('.remote-agent-label')).to_have_count(0)
    expect(output.locator('.reply-footer .signature-instructions')).to_contain_text('Clear answers')
    output.locator('[data-action=copy-reply]').click()
    assert page.evaluate('window.__sharedClip')==page.evaluate('window.__remoteChatTest.job().content')
    output.locator('[data-action=source]').click();expect(output.locator('math')).to_have_count(0)
    expect(output.locator('.reply-content')).to_contain_text('**The check passed.**')
    output.locator('[data-action=source]').click();expect(output.locator('math')).to_have_count(1)
    checks.append('shared answer footer, exact copy, source toggle and safe math rendering')
    reading(page,True);page.locator('#view-reasoning').select_option('hidden');page.locator('#view-markdown').uncheck();page.locator('#view-dialog [data-action=dismiss]').click()
    expect(output.locator('.reasoning')).to_have_count(0);expect(output.locator('strong')).to_have_count(0)
    reading(page,True);page.locator('#view-reasoning').select_option('expanded');page.locator('#view-markdown').check();page.locator('#view-dialog [data-action=dismiss]').click()
    expect(output.locator('.reasoning')).to_have_attribute('open','');expect(output.locator('math')).to_have_count(1)
    output.locator('.reasoning > summary').click();remote_menu(page,'#remote-refresh')
    expect(output.locator('.reasoning')).not_to_have_attribute('open','')
    checks.append('reading preferences apply in Remote and refresh preserves manual disclosure state')
    page.keyboard.press('Control+f');page.locator('#find-input').fill('calculation')
    expect(output.locator('mark.search-match')).to_have_count(2)
    expect(page.locator('#remote-task-form')).to_be_visible();page.keyboard.press('Escape')
    page.keyboard.press('Control+n');expect(page.locator('#remote-heading')).to_have_text('New task');expect(page.locator('#remote-prompt')).to_be_focused()
    capture(page,'remote-new-task.png')
    page.locator('#remote-model-button').click();capture(page,'remote-model-picker.png');page.keyboard.press('Escape')
    checks.append('shared Find and New shortcuts keep the selected Remote execution mode')
    page.locator('#remote-prompt').fill('Keep this remote draft')
    page.locator('#remote-task-form [data-action=edit-draft]').click()
    page.locator('#editor-content').fill('Expanded remote draft');page.locator('#editor-save').click()
    expect(page.locator('#remote-prompt')).to_have_value('Expanded remote draft')
    local(page);expect(page.locator('#prompt')).to_have_value('');open_remote(page)
    checks.append('same expanded editor saves only to the selected execution draft')
    page.locator('#remote-heading').click();page.locator('#rename-input').fill('A useful task title');page.locator('#rename-form').evaluate('(f)=>f.requestSubmit()')
    expect(page.locator('#remote-heading')).to_have_text('A useful task title')
    remote_menu(page,'#remote-refresh');expect(page.locator('#remote-heading')).to_have_text('A useful task title')
    assert page.evaluate('window.__remoteChatTest.job().prompt')=='Explain the result and show the calculation.'
    checks.append('shared title editor changes local display metadata without modifying submitted tasks')
    page.locator('#remote-advanced-button').click();expect(page.locator('#inspector #remote-config-form')).to_be_visible()
    capture(page,'remote-advanced.png')
    expect(page.locator('#config-form')).not_to_be_visible()
    page.locator('#remote-temperature').fill('0.7');page.locator('#remote-maxSeconds').fill('900');page.wait_for_timeout(550)
    assert page.evaluate('window.__remoteChatTest.local().hosts[0].draft.temperature') is None
    close_advanced(page);expect(page.locator('#remote-pending-settings')).to_be_visible()
    local(page);open_remote(page);expect(page.locator('#remote-pending-settings')).to_be_visible()
    page.locator('#remote-pending-settings [data-action=apply-pending]').click()
    page.wait_for_function('()=>window.__remoteChatTest.local().hosts[0].draft.temperature===0.7')
    expect(page.locator('#remote-pending-settings')).not_to_be_visible()
    page.locator('#remote-advanced-button').click();page.locator('#remote-temperature').fill('3')
    page.locator('#remote-apply-settings').click();expect(page.locator('#remote-temperature')).to_be_focused()
    assert page.evaluate('window.__remoteChatTest.local().hosts[0].draft.temperature')==0.7
    page.locator('#remote-discard-settings').click();expect(page.locator('#remote-temperature')).to_have_value('0.7')
    close_advanced(page)
    checks.append('shared Advanced panel requires Apply, retains pending edits across modes and discards invalid fields')
    page.locator('#remote-quick-effort').click();page.locator('#remote-effort-slider').press('End')
    page.wait_for_function('()=>window.__remoteChatTest.local().hosts[0].draft.reasoningEffort!=="default"')
    page.keyboard.press('Escape')
    local(page);page.locator('#quick-effort').click();page.locator('#effort-slider').press('End');page.keyboard.press('Escape')
    open_remote(page)
    checks.append('same capability-driven effort gauge supports keyboard selection in both modes')
    assert not page.evaluate('window.__sharedCalls.some(c=>c.type==="submit")')
    checks.append('all display, edit, rename and settings interactions made zero job submissions')
    page.close()
    for width,height,touch in [(1440,1000,False),(390,844,True),(320,740,True)]:
        context=browser.new_context(viewport={'width':width,'height':height},has_touch=touch,is_mobile=touch)
        page=context.new_page();page.on('pageerror',lambda e:errors.append(str(e)));page.set_content(html)
        expect(page.locator('#reply-shared-reply')).to_be_visible()
        if os.environ.get('UI_CAPTURE_DIR'):page.screenshot(path=str(Path(os.environ['UI_CAPTURE_DIR'])/f'chat-{width}.png'))
        open_remote(page);page.locator('#remote-scroll').evaluate('(e)=>e.scrollTop=0')
        if os.environ.get('UI_CAPTURE_DIR'):page.screenshot(path=str(Path(os.environ['UI_CAPTURE_DIR'])/f'remote-{width}.png'))
        assert page.evaluate('document.documentElement.scrollWidth<=innerWidth+1')
        assert page.locator('#remote-task-form').evaluate('(e)=>e.scrollWidth<=e.clientWidth+1')
        reading(page,True);expect(page.locator('#view-dialog')).to_be_visible();page.keyboard.press('Escape')
        page.locator('#remote-advanced-button').click();expect(page.locator('#remote-temperature')).to_be_visible()
        button=page.locator('#remote-apply-settings');button.scroll_into_view_if_needed();r=button.bounding_box();assert r['x']>=0 and r['x']+r['width']<=width+1 and r['y']+r['height']<=height+1
        context.close()
    checks.append('shared menus and Advanced actions fit 320, 390 and 1440px Chromium viewports')
    assert not errors,errors
    browser.close()
print(json.dumps({'checks':checks,'javascriptErrors':errors},indent=2))
