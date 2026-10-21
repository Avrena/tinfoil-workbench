"""Remote lifecycle UX in the main composer; synthetic controller, no SSH/inference."""
import json, re
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

def remote_menu(page,item):
    """New task, Refresh and Manage are in the Remote toolbar's menu, as Chat keeps its secondary commands."""
    page.locator('#remote-toolbar .export-menu summary').click()
    page.locator(item).click()


root=Path(__file__).resolve().parents[1]
html=(root/'preview/index.html').read_text(encoding='utf8')
marker='window.tinfoil = Object.freeze({'
assert marker in html
html=html.replace(marker,"window.__remoteTest={state:()=>structuredClone(remoteSample),jobs:()=>structuredClone(remoteJobs),offline:value=>{remoteUnavailable=value},output:text=>{remoteJobs[0].content=text;delete remoteJobs[0].transcript}};"+marker,1)
# Keep the synthetic job running until Stop is exercised, regardless of build spacing.
html, held=re.subn(r'\},\s*1800\);','}, 180000);',html,count=1)
assert held==1
checks=[]
with sync_playwright() as p:
    browser=p.chromium.launch(headless=True)
    page=browser.new_page(viewport={'width':1440,'height':1000})
    errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
    page.set_content(html)
    expect(page.locator('#execution-toggle')).to_be_hidden()
    page.locator('#remote-nav').click()
    # With no saved host, setup takes the room and Back to Chat stays; the task box appears once a host is added.
    expect(page.locator('#remote-host-name')).to_be_visible();expect(page.locator('#remote-task-form')).to_be_hidden();expect(page.locator('#remote-back-chat')).to_be_visible()
    page.locator('#remote-host-name').fill('Test sandbox');page.locator('#remote-host-alias').fill('test-sandbox')
    page.locator('#remote-host-form button').click()
    expect(page.locator('#remote-task-form')).to_be_visible()
    expect(page.locator('#remote-auth-state')).to_contain_text('Connect a dedicated')
    page.locator('#remote-enroll').click()
    page.locator('#remote-create summary').click();page.locator('#remote-workspace-name').fill('Demo workspace')
    page.locator('#remote-create-form button').click()
    expect(page.locator('#remote-workspace')).not_to_have_value('')
    selected=page.locator('#remote-workspace').input_value()
    expect(page.locator('#remote-manage-dialog')).not_to_be_visible()
    checks.append('composer setup adds a host, connects Chat and selects the created workspace')

    page.locator('#remote-prompt').fill('Preserve this task with an unfinished limit')
    page.locator('#remote-advanced-button').click();page.locator('#remote-maxSeconds').fill('')
    page.locator('#inspector [data-action=inspector]').click()
    page.locator('#remote-execution [data-execution=local]').click()
    page.locator('#execution-toggle [data-execution=remote]').click()
    expect(page.locator('#remote-prompt')).to_have_value('Preserve this task with an unfinished limit')
    expect(page.locator('#remote-workspace')).to_have_value(selected)
    page.locator('#remote-advanced-button').click()
    expect(page.locator('#remote-maxSeconds')).to_have_value('')
    page.locator('#remote-maxSeconds').fill('4000');page.locator('#inspector [data-action=inspector]').click()
    page.locator('#remote-start').click()
    expect(page.locator('#remote-advanced-panel')).to_be_visible()
    expect(page.locator('#remote-maxSeconds')).to_be_focused()
    page.locator('#remote-discard-settings').click();page.locator('#inspector [data-action=inspector]').click()
    checks.append('unfinished limits remain pending; invalid limits block review without losing the task')

    page.locator('#remote-prompt').fill('A test task <script>bad()</script>')
    page.locator('#remote-prompt').press('Enter')
    assert len(page.evaluate('window.__remoteTest.jobs()'))==0
    page.locator('#remote-prompt').press('Control+Enter')
    expect(page.locator('#remote-prompt')).to_have_value('')
    expect(page.locator('#remote-job-detail')).to_be_visible()
    expect(page.locator('#remote-stop')).to_be_visible()
    remote_menu(page,'#remote-new')
    expect(page.locator('#remote-stop')).to_be_visible()
    expect(page.locator('#remote-running')).to_be_visible()
    page.wait_for_timeout(200)  # Let the start's refresh settle before testing the independent Stop response.
    page.locator('#remote-stop').click()
    expect(page.locator('#remote-stop')).not_to_be_visible()
    page.locator('#remote-jobs-button').click()
    expect(page.locator('#remote-job-list .remote-job-row')).to_have_count(1)
    page.locator('#remote-job-list .remote-job-row').first.click()
    expect(page.locator('#remote-job-title')).to_contain_text('Stopped')
    expect(page.locator('#remote-job-output .remote-tool')).to_contain_text('Not finished')
    checks.append('Enter is a newline; Ctrl+Enter starts review; Stop stays available while writing the next task')

    page.locator('#remote-prompt').fill('Next task draft');page.wait_for_timeout(600)
    page.locator('#remote-job-output details').first.click()
    remote_menu(page,'#remote-refresh')
    expect(page.locator('#remote-prompt')).to_have_value('Next task draft')
    assert page.locator('#remote-job-output details').first.evaluate('(e)=>e.open')
    page.locator('#remote-execution [data-execution=local]').click()
    page.locator('#execution-toggle [data-execution=remote]').click()
    expect(page.locator('#remote-prompt')).to_have_value('Next task draft')
    checks.append('draft and open transcript details survive refresh and execution-mode switching')

    page.evaluate('window.__remoteTest.offline(true)');remote_menu(page,'#remote-refresh')
    expect(page.locator('#remote-connection')).to_contain_text('last known state')
    expect(page.locator('#remote-start')).to_be_disabled()
    page.evaluate('window.__remoteTest.offline(false)');remote_menu(page,'#remote-refresh')
    expect(page.locator('#remote-start')).to_be_enabled()
    remote_menu(page,'#remote-manage-button')
    page.locator('#remote-workspace-actions summary').click();page.locator('[data-remote=archive]').click()
    page.keyboard.press('Escape')
    remote_menu(page,'#remote-refresh');expect(page.locator('#remote-feedback')).to_contain_text('Synthetic archive saved')
    checks.append('stale state blocks new starts and archive feedback survives refresh')

    page.evaluate("window.__remoteTest.output('<img src=x onerror=bad()>')");remote_menu(page,'#remote-refresh')
    expect(page.locator('.remote-message[data-fallback] .reply-content')).to_contain_text('<img src=x')
    assert page.locator('.remote-message[data-fallback] img').count()==0
    page.locator('.remote-message[data-fallback] .reply-content').evaluate("e=>{const range=document.createRange();range.selectNodeContents(e);const s=window.getSelection();s.removeAllRanges();s.addRange(range)}")
    page.evaluate("window.__remoteTest.output('New tail');document.querySelector('#remote-refresh').click()")
    page.wait_for_timeout(100)
    assert '<img' in page.evaluate('window.getSelection().toString()')
    page.evaluate('window.getSelection().removeAllRanges()')
    checks.append('untrusted fallback output stays inert and selected text survives refresh')

    page.evaluate("window.__remoteTest.output('Long output for a reading-position check.\\n'.repeat(200))")
    remote_menu(page,'#remote-refresh')
    expect(page.locator('.remote-message[data-fallback] .reply-content')).to_contain_text('Long output for a reading-position check.')
    page.locator('#remote-scroll').evaluate('(e)=>e.scrollTop=e.scrollHeight')
    reading_position=page.locator('#remote-scroll').evaluate('(e)=>e.scrollTop')
    assert reading_position>100
    page.locator('#remote-execution [data-execution=local]').click()
    page.locator('#execution-toggle [data-execution=remote]').click()
    assert abs(page.locator('#remote-scroll').evaluate('(e)=>e.scrollTop')-reading_position)<=1
    checks.append('long remote transcript retains reading position across Local/Remote switching')
    for width in [1440,1000,780,600,360,320]:
        page.set_viewport_size({'width':width,'height':950});page.wait_for_timeout(100)
        assert page.evaluate('document.documentElement.scrollWidth<=innerWidth'),width
        assert page.locator('#remote-scroll').evaluate('(e)=>e.scrollWidth<=e.clientWidth+1'),width
        assert page.locator('#remote-task-form').evaluate('(e)=>e.scrollWidth<=e.clientWidth+1'),width
    checks.append('transcript and composer fit 320–1440px without page overflow')
    assert not errors,errors
    browser.close()
print(json.dumps({'checks':checks,'javascriptErrors':errors},indent=2))
