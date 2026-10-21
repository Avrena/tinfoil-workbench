"""Remote UX polish: Chat's toolbar layout and menu, setup without a host, quiet composer text, host labels, one
signature per job turn and the Remote Advanced actions. Synthetic preview; no SSH or inference."""
import importlib.util, json
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

root = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('ui_remote_transcript', Path(__file__).with_name('ui-remote-transcript.py'))
transcript = importlib.util.module_from_spec(spec); spec.loader.exec_module(transcript)
marker = 'window.tinfoil = Object.freeze({'

def plain():
    return (root / 'preview/index.html').read_text(encoding='utf8')

def with_fixture(js):
    html = plain(); assert marker in html
    return html.replace(marker, js + marker, 1)

def toolbar_tools(page, selector):
    """The toolbar's visible controls after the heading, by kind, with their distance from the window's right edge."""
    return page.evaluate("""selector => [...document.querySelector(selector).children]
      .filter(e => e.matches('button.icon-button,.export-menu') && e.dataset.action !== 'sidebar' && e.getClientRects().length)
      .map(e => { const r = (e.matches('.export-menu') ? e.querySelector('summary') : e).getBoundingClientRect();
        return { kind: e.matches('.export-menu') ? 'menu' : e.dataset.action || e.dataset.remote, right: Math.round(innerWidth - r.right) }; })""", selector)

def open_sidebar_remote(page):
    if not page.locator('#remote-nav').is_visible(): page.locator('#main>.toolbar:not(.remote-toolbar) [data-action=sidebar]').click()
    page.locator('#remote-nav').click()

checks = []
with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    errors = []

    # Toolbar: Remote uses Chat's layout, with Jobs where Chat has Artifacts.
    page = browser.new_page(viewport={'width': 1440, 'height': 1000}); page.on('pageerror', lambda e: errors.append(str(e)))
    page.set_content(transcript.seeded())
    expect(page.locator('#execution-toggle')).to_be_visible()
    chat = toolbar_tools(page, '#main>.toolbar:not(.remote-toolbar)')
    page.locator('#execution-toggle [data-execution=remote]').click(); expect(page.locator('#remote-task-form')).to_be_visible()
    remote = toolbar_tools(page, '#remote-toolbar')
    assert [t['kind'] for t in chat] == ['find', 'view', 'menu', 'artifacts', 'inspector'], chat
    assert [t['kind'] for t in remote] == ['find', 'view', 'menu', 'jobs', 'inspector'], remote
    assert [t['right'] for t in chat] == [t['right'] for t in remote], (chat, remote)
    checks.append('Remote toolbar has Chat’s five controls in the same places, with Jobs where Chat has Artifacts')

    # The menu holds New task, Refresh and Manage at every width; choosing one keeps focus on the menu's button.
    menu = page.locator('#remote-toolbar .export-menu')
    for width in [1440, 390, 320]:
        page.set_viewport_size({'width': width, 'height': 900}); page.wait_for_timeout(100)
        menu.locator('summary').click()
        for item in ['#remote-new', '#remote-refresh', '#remote-manage-button']: expect(page.locator(item)).to_be_visible()
        page.locator('#remote-refresh').click()
        expect(menu).not_to_have_attribute('open', ''); expect(menu.locator('summary')).to_be_focused()
    page.set_viewport_size({'width': 1440, 'height': 1000})
    menu.locator('summary').focus(); page.keyboard.press('Enter'); expect(menu).to_have_attribute('open', '')
    page.locator('#remote-refresh').focus(); page.keyboard.press('Enter')
    expect(menu).not_to_have_attribute('open', ''); expect(menu.locator('summary')).to_be_focused()
    expect(page.locator('#remote-refresh')).to_contain_text('updated')
    menu.locator('summary').click(); page.locator('#remote-manage-button').click()
    expect(page.locator('#remote-manage-dialog')).to_be_visible(); page.keyboard.press('Escape')
    checks.append('menu commands are visible at 1440/390/320px, work by pointer and keyboard, and return focus to the menu')

    # Quiet composer: a short hint, the safety note once in the welcome, and no permanent saved-draft line.
    expect(page.locator('#remote-start-note')).to_have_text('Ctrl+Enter to review and start · Enter for a new line')
    expect(page.locator('#remote-welcome-text')).to_contain_text('without asking')
    page.locator('#remote-prompt').fill('A quiet draft'); page.wait_for_timeout(800)
    expect(page.locator('#remote-draft-state')).to_have_text('')
    checks.append('composer hint is one short line, the safety note shows once in the welcome, and a saved draft is quiet')

    # One signature for the agent's turn, under its latest answer; Copy and Source on every answer, in every state.
    page.locator('#remote-jobs-button').click()
    page.locator('#remote-job-list [data-remote-job="cccccccccccccccccccccccccccccccc"]').click()
    output = page.locator('#remote-job-output')
    def one_signature(state):
        expect(output.locator('.reply-signature')).to_have_count(1)
        expect(output.locator('.remote-message').last.locator('.reply-signature')).to_contain_text('Clear answers')
        answers = output.locator('.remote-message .reply-content').count()
        assert output.locator('[data-action=copy-reply]').count() == answers and output.locator('[data-action=source]').count() == answers, state
    one_signature('complete')
    for state in ['partial', 'stop', 'legacy']:
        page.evaluate(f'window.__remoteChatTest.{state}()'); page.evaluate("document.getElementById('remote-refresh').click()"); page.wait_for_timeout(200)
        one_signature(state)
    checks.append('one signature per job turn, on its latest answer, while running, stopped and for legacy output; Copy and Source on every answer')

    # Remote Advanced: says whose settings it holds; Discard and Reset appear only when they would do something.
    page.locator('#remote-advanced-button').click()
    expect(page.locator('#inspector-title')).to_have_text('Advanced · Remote')
    discard, reset, temperature = page.locator('#remote-discard-settings'), page.locator('#remote-advanced-reset'), page.locator('#remote-temperature')
    expect(discard).to_be_hidden(); expect(reset).to_be_hidden()
    temperature.fill('0.5'); expect(discard).to_be_visible(); expect(reset).to_be_visible()
    discard.click(); expect(temperature).to_have_value(''); expect(discard).to_be_hidden(); expect(reset).to_be_hidden()
    expect(temperature).to_be_focused()
    temperature.fill('0.5'); reset.click(); expect(temperature).to_have_value(''); expect(reset).to_be_hidden(); expect(discard).to_be_hidden()
    expect(temperature).to_be_focused()
    # The composer's pending bar hides once it has acted; focus pressed there returns to the task box.
    temperature.fill('0.5'); bar = page.locator('#remote-pending-settings'); expect(bar).to_be_visible()
    bar.locator('[data-action=discard-pending]').click(); expect(bar).to_be_hidden(); expect(page.locator('#remote-prompt')).to_be_focused()
    page.locator('#inspector [data-action=inspector]').click()
    page.locator('#remote-execution [data-execution=local]').click()
    page.locator('#main>.toolbar:not(.remote-toolbar) [data-action=inspector]').click()
    expect(page.locator('#inspector-title')).to_have_text('Advanced')
    checks.append('Advanced is titled for Remote; Discard and Reset show only when they would act, and focus stays on a visible control after them and after the pending bar')
    page.close()

    # No saved host: setup takes the room, the task box waits, Back to Chat stays.
    for width in [1440, 390]:
        page = browser.new_page(viewport={'width': width, 'height': 900}); page.on('pageerror', lambda e: errors.append(str(e)))
        page.set_content(plain()); open_sidebar_remote(page)
        expect(page.locator('#remote-host-name')).to_be_visible()
        expect(page.locator('#remote-task-form')).to_be_hidden(); expect(page.locator('#remote-composer .remote-composer-meta')).to_be_hidden()
        expect(page.locator('#remote-back-chat')).to_be_visible()
        expect(page.locator('#remote-setup-title')).to_have_text('Add a host'); expect(page.locator('#remote-host-settings > summary')).to_be_hidden()
        form = page.locator('#remote-setup').bounding_box(); edge = page.locator('#remote-edge').bounding_box()
        assert form['y'] + form['height'] <= edge['y'] + 1, (width, form, edge)
        page.locator('#remote-host-name').fill('Sandbox'); page.locator('#remote-host-alias').fill('test-sandbox'); page.locator('#remote-host-form button').click()
        expect(page.locator('#remote-task-form')).to_be_visible(); expect(page.locator('#remote-back-chat')).to_be_hidden()
        page.close()
    checks.append('with no saved host the setup card is not covered at 1440/390px; the task box returns once a host is added')

    # Reopening Remote with a configuration already known to be empty keeps the task box hidden while it is read again.
    hold = r'''window.__hold={on:false,release:null};const heldPreview=remotePreview;remotePreview=async c=>{const result=await heldPreview(c);if(c.type==='load'&&window.__hold.on)await new Promise(resolve=>{window.__hold.release=resolve;});return result;};'''
    page = browser.new_page(viewport={'width': 1440, 'height': 900}); page.on('pageerror', lambda e: errors.append(str(e)))
    page.set_content(with_fixture(hold)); open_sidebar_remote(page)
    expect(page.locator('#remote-host-name')).to_be_visible(); expect(page.locator('#remote-task-form')).to_be_hidden()
    page.locator('#remote-back-chat').click(); page.evaluate('window.__hold.on=true')
    page.locator('#remote-nav').click(); page.wait_for_function('window.__hold.release!==null')
    expect(page.locator('#remote-task-form')).to_be_hidden(); expect(page.locator('#remote-back-chat')).to_be_visible()
    page.evaluate('window.__hold.on=false;window.__hold.release()')
    expect(page.locator('#remote-host-name')).to_be_visible(); expect(page.locator('#remote-task-form')).to_be_hidden()
    page.close()
    checks.append('reopening Remote with no saved host keeps the task box hidden while the configuration is read again')

    # Host labels: names only, with the alias where two hosts share a name; the selected host's alias is in its tooltip.
    hosts = r'''remoteSample.hosts=[{id:'a'.repeat(32),name:'Lab',alias:'lab-east',draft:remoteDefaults()},{id:'e'.repeat(32),name:'Lab',alias:'lab-west',draft:remoteDefaults()},{id:'f'.repeat(32),name:'Solo',alias:'solo-box',draft:remoteDefaults()}];remoteSample.selectedHost='a'.repeat(32);'''
    page = browser.new_page(viewport={'width': 1440, 'height': 900}); page.on('pageerror', lambda e: errors.append(str(e)))
    page.set_content(with_fixture(hosts)); page.locator('#execution-toggle [data-execution=remote]').click()
    expect(page.locator('#remote-host option')).to_have_text(['Lab · lab-east', 'Lab · lab-west', 'Solo'])
    expect(page.locator('#remote-host')).to_have_attribute('title', 'Lab · SSH alias lab-east')
    page.locator('#remote-host').select_option('f' * 32)
    expect(page.locator('#remote-host')).to_have_attribute('title', 'Solo · SSH alias solo-box')
    box = page.locator('#remote-host').bounding_box(); assert box['width'] < 160, box
    page.close()
    checks.append('host picker shows names, adds the alias only for shared names, and keeps the alias in its tooltip')
    browser.close()
print(json.dumps({'checks': checks, 'javascriptErrors': errors}, indent=2))
assert not errors, errors
