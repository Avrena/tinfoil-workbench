"""Remote transcript and model picker UX; synthetic data, no SSH or inference."""
import json
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

def remote_menu(page,item):
    """New task, Refresh and Manage are in the Remote toolbar's menu, as Chat keeps its secondary commands."""
    page.locator('#remote-toolbar .export-menu summary').click()
    page.locator(item).click()


root = Path(__file__).resolve().parents[1]
fixture = r'''
remoteSample.hosts=[{id:'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',name:'Sandbox',alias:'demo-sandbox',draft:remoteDefaults()}];
remoteSample.selectedHost=remoteSample.hosts[0].id;
remoteWorkspaces.push({id:'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',name:'Agent playground',createdAt:1792520000,lastUsed:1792520000,quotaBytes:2147483648,activeJobs:[]});
remoteSample.hosts[0].draft.workspace=remoteWorkspaces[0].id;remoteEnrolled=true;
const transcriptJob={id:'cccccccccccccccccccccccccccccccc',workspace:remoteWorkspaces[0].id,prompt:'Write a Python greeting and verify it.\nKeep the result easy to read.',model:'deepseek-v4-pro',status:'complete',createdAt:1792520000,rounds:2,calls:1,verified:true,
 content:'I will inspect the workspace.\n\n**Done.** The check passed.',reasoning:'Private model reasoning.',
 settings:{...remoteDefaults(),systemPrompt:'Explain the result clearly.',systemPromptName:'Clear answers',temperature:0.3},
 transcript:[{id:'assistant-0',role:'assistant',content:'I will inspect the **workspace**.',reasoning:'First retained reasoning.'},
 {id:'tool-0',role:'tool',tool:0},
 {id:'assistant-1',role:'assistant',content:'**Done.** The check passed.\n\n```python\nprint("hello")\n```\n\n<img src=x onerror=bad()>',reasoning:'Final retained reasoning.'}],
 tools:[{id:'call-1',name:'run_command',arguments:'{"command":"python3 greeting.py"}',status:'complete',result:{stdout:'hello\n',exitCode:0}}]};
remoteJobs.push(transcriptJob,{...structuredClone(transcriptJob),id:'dddddddddddddddddddddddddddddddd',prompt:'Another task'});
window.__remoteChatTest={job:()=>transcriptJob,local:()=>structuredClone(remoteSample),chatModel:()=>workspace.threads.find(t=>t.id===workspace.activeId).settings.model,
 append:()=>{transcriptJob.transcript[2].content+='\n\nNew tail';},partial:()=>{transcriptJob.status='running';transcriptJob.transcript[2].partial=true;},
 stop:()=>{transcriptJob.status='stopped';transcriptJob.reason='operator';},legacy:()=>{delete transcriptJob.transcript;}};
'''

def seeded():
    html=(root/'preview/index.html').read_text(encoding='utf8')
    marker='window.tinfoil = Object.freeze({'
    assert marker in html
    return html.replace(marker,fixture+marker,1)

if __name__=='__main__':
    checks=[]
    with sync_playwright() as p:
        browser=p.chromium.launch(headless=True)
        page=browser.new_page(viewport={'width':1440,'height':1000})
        errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
        page.set_content(seeded());page.locator('#remote-nav').click()
        expect(page.locator('#remote-workspace')).to_have_value('bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb')
        before_chat=page.evaluate('window.__remoteChatTest.chatModel()')
        button=page.locator('#remote-model-button')
        expect(button.locator('.maker-deepseek')).to_be_visible()
        expect(button.locator('.model-chevron')).to_be_visible()
        button.click();expect(page.locator('#remote-model-dialog')).to_be_visible()
        search=page.locator('#remote-model-search')
        search.fill('DeepSeek V4 Pro')
        page.locator('[data-remote-model="deepseek-v4-pro"]').click()
        expect(button).to_contain_text('DeepSeek V4 Pro')
        page.wait_for_timeout(600)
        assert page.evaluate('window.__remoteChatTest.local().hosts[0].draft.model')=='deepseek-v4-pro'
        assert page.evaluate('window.__remoteChatTest.chatModel()')==before_chat
        checks.append('searchable maker-logo picker saves only the remote model')
        button.click();search.fill('custom/vendor-model')
        page.locator('[data-remote-model="custom/vendor-model"]').click()
        expect(page.locator('#remote-model')).to_have_value('custom/vendor-model')
        button.click();search.press('Escape');expect(page.locator('#remote-model-dialog')).not_to_be_visible()
        expect(button).to_be_focused()
        button.click();search.fill('');search.press('ArrowDown');page.keyboard.press('Enter')
        expect(page.locator('#remote-model')).to_have_value('default')
        checks.append('exact IDs, keyboard choice, Escape and focus return work')
        page.locator('#remote-jobs-button').click()
        page.locator('#remote-job-list [data-remote-job="cccccccccccccccccccccccccccccccc"]').click()
        output=page.locator('#remote-job-output')
        expect(output.locator('.user-prompt')).to_contain_text('Write a Python greeting')
        messages=output.locator('.remote-message .reply-content')
        expect(messages).to_have_count(2)
        expect(messages.first.locator('strong')).to_have_text('workspace')
        expect(messages.last.locator('strong')).to_have_text('Done.')
        expect(messages.last.locator('pre code')).to_contain_text('print("hello")')
        expect(messages.last).to_contain_text('<img src=x onerror=bad()>')
        assert output.locator('img,[data-action=run-code],[data-action=artifact]').count()==0
        assert messages.first.evaluate('(e)=>!!(e.compareDocumentPosition(document.querySelector("#remote-job-output .remote-tool"))&Node.DOCUMENT_POSITION_FOLLOWING)')
        assert output.locator('.remote-tool').evaluate('(e)=>!!(e.compareDocumentPosition(document.querySelectorAll("#remote-job-output .remote-message .reply-content")[1])&Node.DOCUMENT_POSITION_FOLLOWING)')
        checks.append('task, Markdown replies and inline tool calls follow actual order; raw HTML stays inert')
        tool=output.locator('.remote-tool')
        expect(tool).not_to_have_attribute('open','')
        tool.locator('summary').click();expect(tool).to_contain_text('hello')
        messages.first.evaluate('(e)=>window.__remoteFirst=e')
        remote_menu(page,'#remote-refresh')
        assert messages.first.evaluate('(e)=>e===window.__remoteFirst')
        assert tool.evaluate('(e)=>e.open')
        page.evaluate('window.__remoteChatTest.append()');remote_menu(page,'#remote-refresh')
        expect(messages.last).to_contain_text('New tail')
        assert messages.first.evaluate('(e)=>e===window.__remoteFirst')
        checks.append('polling preserves existing message nodes and open tool details')
        messages.first.evaluate('(e)=>{const r=document.createRange();r.selectNodeContents(e);const s=window.getSelection();s.removeAllRanges();s.addRange(r)}')
        selected=page.evaluate('window.getSelection().toString()')
        page.evaluate('window.__remoteChatTest.append();document.querySelector("#remote-refresh").click()')
        page.wait_for_timeout(100)
        assert page.evaluate('window.getSelection().toString()')==selected
        page.evaluate('window.getSelection().removeAllRanges()')
        checks.append('a refresh does not disturb selected transcript text')
        page.evaluate('window.__remoteChatTest.partial()');remote_menu(page,'#remote-refresh')
        expect(output).to_contain_text('In progress')
        page.evaluate('window.__remoteChatTest.stop()');remote_menu(page,'#remote-refresh')
        expect(output).to_contain_text('Partial response')
        expect(output).not_to_contain_text('In progress')
        checks.append('stopped partial output remains visible without a running indicator')
        page.locator('#remote-jobs-button').click();page.locator('#remote-job-list [data-remote-job="dddddddddddddddddddddddddddddddd"]').click()
        expect(output.locator('.user-prompt')).to_contain_text('Another task')
        expect(output.locator('.remote-tool')).not_to_have_attribute('open','')
        page.locator('#remote-jobs-button').click();page.locator('#remote-job-list [data-remote-job="cccccccccccccccccccccccccccccccc"]').click()
        page.evaluate('window.__remoteChatTest.legacy()');remote_menu(page,'#remote-refresh')
        expect(output).to_contain_text('Tool activity')
        expect(output).to_contain_text('doesn’t report')
        checks.append('job changes reset disclosure identity; older hosts disclose unavailable tool order')
        for width in [320,390,800,1440]:
            page.set_viewport_size({'width':width,'height':844 if width<800 else 1000})
            assert page.locator('#remote-scroll').evaluate('(e)=>e.scrollWidth<=e.clientWidth+1'),width
            for name in ['jobs','manage']:
                trigger=page.locator('#remote-'+name+'-button')
                if name=='manage' and not trigger.is_visible():
                    page.locator('#remote-toolbar .export-menu > summary').click();page.locator('#remote-toolbar .export-menu [data-remote=manage]').click()
                else:trigger.click()
                dialog=page.locator('#remote-'+name+'-dialog')
                assert dialog.evaluate('(e)=>e.scrollWidth<=e.clientWidth+1'),(width,name)
                page.keyboard.press('Escape')
            button.click()
            dialog=page.locator('#remote-model-dialog')
            assert dialog.evaluate('(e)=>e.scrollWidth<=e.clientWidth+1'),width
            box=dialog.bounding_box();assert box['x']>=0 and box['x']+box['width']<=width+1
            search.press('Escape')
        checks.append('transcript, composer dialogs and model picker fit 320–1440px Chromium viewports')
        assert not errors,errors
        browser.close()
    print(json.dumps({'checks':checks,'javascriptErrors':errors},indent=2))
