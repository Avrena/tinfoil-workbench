"""Composer execution choice and job settings; synthetic bridge, no provider/SSH."""
from pathlib import Path
import importlib.util
import json
from playwright.sync_api import sync_playwright, expect

def remote_menu(page,item):
    """New task, Refresh and Manage are in the Remote toolbar's menu, as Chat keeps its secondary commands."""
    page.locator('#remote-toolbar .export-menu summary').click()
    page.locator(item).click()


root=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('transcript_fixture',root/'tests/ui-remote-transcript.py')
fixture=importlib.util.module_from_spec(spec);spec.loader.exec_module(fixture)
extra=r'''
workspace.instructionPresets.push({id:'saved-example',name:'Saved example',text:'Use concrete examples.',createdAt:1,updatedAt:1});
const localThread=workspace.threads.find(t=>t.id===workspace.activeId);
localThread.draft='Local draft stays on this PC';localThread.settings.systemPrompt='LOCAL PRIVATE INSTRUCTIONS';localThread.settings.systemPromptName='Local preset';
localThread.draftAttachments=[{name:'local-notes.txt',content:'LOCAL ATTACHMENT CONTENT'}];
window.__remoteSettingsTest={local:()=>structuredClone(localThread),remote:()=>structuredClone(remoteSample.hosts[0].draft),
  preset:()=>{workspace.instructionPresets[0].text='Library edited later';},
  offline:v=>{remoteUnavailable=v;},holdLocal:v=>{busy=v?localThread.id:null;emit();},busy:()=>busy,failSave:false};
const settingsPreview=remotePreview;
remotePreview=async c=>{if(c.type==='draft.set'&&window.__remoteSettingsTest.failSave)throw Error('Synthetic draft save failed');return settingsPreview(c);};
'''

def seeded():
    return fixture.seeded().replace('window.tinfoil = Object.freeze({',extra+'window.tinfoil = Object.freeze({',1)

if __name__=='__main__':
    checks=[]
    with sync_playwright() as p:
        browser=p.chromium.launch(headless=True)
        page=browser.new_page(viewport={'width':1440,'height':1000})
        errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
        page.set_content(seeded())
        expect(page.locator('#prompt')).to_have_value('Local draft stays on this PC')
        toggle=page.locator('#execution-toggle')
        expect(toggle).to_be_visible();expect(toggle.locator('[data-execution=local]')).to_have_attribute('aria-checked','true')
        toggle.locator('[data-execution=remote]').click()
        expect(page.locator('#remote-task-form')).to_be_visible()
        expect(page.locator('#remote-nav')).to_have_attribute('aria-current','page')
        expect(page.locator('#thread-list [aria-current=page],#thread-list .selected')).to_have_count(0)
        expect(page.locator('#remote-prompt')).to_have_value('')
        expect(page.locator('#remote-instructions')).to_have_attribute('aria-label','System instructions for remote tasks: none. Choose instructions')
        assert page.evaluate("document.querySelector('#remote-composer').closest('.composer-region')!==null")
        assert page.locator('#remote-panel').count()==0
        page.locator('#remote-prompt').fill('Remote draft is independent')
        page.locator('#remote-execution [data-execution=local]').click()
        expect(page.locator('#prompt')).to_have_value('Local draft stays on this PC')
        expect(page.locator('#thread-list [aria-current=page]')).to_have_count(1)
        assert page.locator('#remote-nav').get_attribute('aria-current') is None
        assert page.evaluate('window.__remoteSettingsTest.local().settings.systemPrompt')=='LOCAL PRIVATE INSTRUCTIONS'
        assert page.evaluate('window.__remoteSettingsTest.local().draftAttachments[0].content')=='LOCAL ATTACHMENT CONTENT'
        toggle.locator('[data-execution=remote]').click()
        expect(page.locator('#remote-prompt')).to_have_value('Remote draft is independent')
        assert 'LOCAL ATTACHMENT CONTENT' not in page.evaluate('JSON.stringify(window.__remoteSettingsTest.remote())')
        checks.append('Local/Remote lives in the composer and preserves isolated drafts and instructions')

        page.locator('#remote-execution [data-execution=local]').click()
        page.evaluate('window.__remoteSettingsTest.holdLocal(true)')
        expect(page.locator('#stop')).to_be_visible()
        toggle.locator('[data-execution=remote]').click()
        assert page.evaluate('window.__remoteSettingsTest.busy()') is not None
        page.locator('#remote-execution [data-execution=local]').click()
        expect(page.locator('#stop')).to_be_visible()
        page.evaluate('window.__remoteSettingsTest.holdLocal(false)')
        toggle.locator('[data-execution=remote]').click()
        checks.append('execution switching does not stop or send an active local generation')

        page.locator('#remote-instructions').click()
        row=page.locator('[data-remote-instructions="saved:saved-example"]');row.focus()
        page.evaluate("document.querySelector('#remote-refresh').click()")
        page.wait_for_timeout(100);expect(row).to_be_focused()
        page.locator('[data-remote-instructions="saved:saved-example"]').click()
        expect(page.locator('#remote-instructions-name')).to_have_text('Saved example')
        page.wait_for_timeout(600)
        assert page.evaluate('window.__remoteSettingsTest.remote().systemPrompt')=='Use concrete examples.'
        page.evaluate('window.__remoteSettingsTest.preset()')
        assert page.evaluate('window.__remoteSettingsTest.remote().systemPrompt')=='Use concrete examples.'
        page.locator('#remote-instructions').click();page.locator('#remote-instructions-write').click()
        page.locator('#remote-systemPrompt').fill('Exact custom\ninstructions')
        page.keyboard.press('Escape')
        expect(page.locator('#remote-instructions-dialog')).not_to_be_visible()
        page.wait_for_timeout(600)
        draft=page.evaluate('window.__remoteSettingsTest.remote()')
        assert draft['systemPrompt']=='Exact custom\ninstructions' and draft['systemPromptName']==''
        assert page.evaluate('window.__remoteSettingsTest.local().settings.systemPrompt')=='LOCAL PRIVATE INSTRUCTIONS'
        checks.append('saved instructions copy explicitly; editor persists exact text and clears the display name')

        page.locator('#remote-advanced-button').click()
        page.locator('#remote-temperature').fill('0.4')
        expect(page.locator('#remote-advanced-button')).to_have_class(__import__('re').compile(r'\bis-set\b'))
        expect(page.locator('#remote-advanced-button')).to_have_attribute('aria-label',__import__('re').compile('temperature 0.4'))
        page.locator('#remote-maxTokens').fill('2048')
        page.locator('#remote-maxSeconds').fill('900')
        assert page.evaluate('window.__remoteSettingsTest.remote().temperature') is None
        page.locator('#remote-apply-settings').click();page.locator('#inspector [data-action=inspector]').click();page.wait_for_timeout(600)
        draft=page.evaluate('window.__remoteSettingsTest.remote()')
        assert draft['temperature']==0.4 and draft['maxTokens']==2048 and draft['maxSeconds']==900
        page.locator('#remote-model-button').click();page.locator('#remote-model-search').fill('DeepSeek V4 Pro')
        page.locator('[data-remote-model="deepseek-v4-pro"]').click()
        page.locator('#remote-advanced-button').click();page.locator('#remote-effort').select_option('high')
        page.locator('#remote-apply-settings').click();page.locator('#inspector [data-action=inspector]').click();page.wait_for_timeout(600)
        assert page.evaluate('window.__remoteSettingsTest.remote().reasoningEffort')=='high'
        page.locator('#remote-model-button').click();page.locator('#remote-model-search').fill('unknown-model')
        page.locator('[data-remote-model="unknown-model"]').click()
        page.wait_for_timeout(600)
        draft=page.evaluate('window.__remoteSettingsTest.remote()')
        assert draft['reasoningEffort']=='default' and draft['thinkingMode']=='default' and draft['temperature']==0.4
        page.locator('#remote-advanced-button').click()
        expect(page.locator('#remote-effort')).not_to_be_visible()
        page.locator('#remote-temperature').fill('3')
        expect(page.locator('#remote-advanced-button')).to_have_attribute('aria-label',__import__('re').compile('a value needs fixing'))
        page.locator('#inspector [data-action=inspector]').click()
        page.locator('#remote-start').click()
        expect(page.locator('#remote-advanced-panel')).to_be_visible()
        expect(page.locator('#remote-temperature')).to_be_focused()
        assert page.evaluate('window.__remoteSettingsTest.remote().temperature')==0.4
        page.locator('#remote-temperature').fill('0.4');page.locator('#inspector [data-action=inspector]').click()
        checks.append('advanced settings apply explicitly; model changes reset reasoning; invalid values block review without losing valid draft')

        page.locator('#remote-jobs-button').click()
        page.locator('#remote-job-list [data-remote-job="cccccccccccccccccccccccccccccccc"]').click()
        page.locator('#remote-job-more > summary').click()
        expect(page.locator('#remote-job-meta')).to_contain_text('Clear answers')
        page.locator('#remote-job-system > summary').click()
        expect(page.locator('#remote-job-system')).to_contain_text('Explain the result clearly.')
        remote_menu(page,'#remote-new')
        expect(page.locator('#remote-prompt')).to_have_value('Remote draft is independent')
        checks.append('retained jobs show captured settings without overwriting the next draft')

        page.evaluate('window.__remoteSettingsTest.failSave=true')
        page.locator('#remote-prompt').fill('Unsaved edit must block navigation')
        page.locator('#remote-execution [data-execution=local]').click()
        expect(page.locator('#remote-task-form')).to_be_visible()
        expect(page.locator('#remote-prompt')).to_have_value('Unsaved edit must block navigation')
        expect(page.locator('#remote-nav')).to_have_attribute('aria-current','page')
        expect(page.locator('#thread-list [aria-current=page],#thread-list .selected')).to_have_count(0)
        page.evaluate('window.__remoteSettingsTest.failSave=false')
        page.locator('#remote-execution [data-execution=local]').click()
        expect(page.locator('#composer-form')).to_be_visible()
        expect(page.locator('#thread-list [aria-current=page]')).to_have_count(1)
        toggle.locator('[data-execution=remote]').click()
        expect(page.locator('#remote-prompt')).to_have_value('Unsaved edit must block navigation')
        checks.append('failed remote draft flush blocks execution-mode switching and retry preserves text')

        for width in [320,390,800,1440]:
            page.set_viewport_size({'width':width,'height':844 if width<800 else 1000})
            assert page.evaluate('document.documentElement.scrollWidth<=innerWidth'),width
            assert page.locator('#remote-task-form').evaluate('(e)=>e.scrollWidth<=e.clientWidth+1'),width
            for name in ['advanced','instructions','jobs','manage']:
                trigger=page.locator('#remote-'+name+('-button' if name!='instructions' else ''))
                if name=='manage' and not trigger.is_visible():
                    page.locator('#remote-toolbar .export-menu > summary').click();page.locator('#remote-toolbar .export-menu [data-remote=manage]').click()
                else:trigger.click()
                dialog=page.locator('#inspector' if name=='advanced' else '#remote-'+name+'-dialog')
                assert dialog.evaluate('(e)=>e.scrollWidth<=e.clientWidth+1'),(width,name)
                box=dialog.bounding_box();assert box['x']>=0 and box['x']+box['width']<=width+1,(width,name)
                if name=='advanced':page.locator('#inspector [data-action=inspector]').click()
                else:page.keyboard.press('Escape')
        checks.append('composer and settings/jobs/manage dialogs fit 320–1440px Chromium viewports')
        page.set_viewport_size({'width':390,'height':420})
        page.locator('#remote-instructions').click();page.locator('#remote-instructions-write').click()
        done=page.locator('#remote-instructions-done');done.scroll_into_view_if_needed()
        box=done.bounding_box();assert box['y']>=0 and box['y']+box['height']<=420
        page.keyboard.press('Escape');page.locator('#remote-advanced-button').click()
        done=page.locator('#remote-apply-settings');done.scroll_into_view_if_needed()
        box=done.bounding_box();assert box['y']>=0 and box['y']+box['height']<=420
        page.keyboard.press('Escape')
        checks.append('instructions and Advanced actions remain reachable at simulated keyboard height')
        assert not errors,errors
        browser.close()
    print(json.dumps({'checks':checks,'javascriptErrors':errors},indent=2))
