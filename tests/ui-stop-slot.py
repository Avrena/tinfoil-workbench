"""Stop takes Send's place in Chat, and Start's place in Remote, while a reply or job runs, at desktop and phone
widths. Focus in that place moves with it, and the second click of a double-click on Send does not stop the reply it
just sent. Synthetic preview; no SSH or inference."""
import json, re
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

root = Path(__file__).resolve().parents[1]
html = (root / 'preview/index.html').read_text(encoding='utf8')
# The synthetic remote job keeps running until it is stopped.
html, held = re.subn(r'\},\s*1800\);', '}, 180000);', html, count=1); assert held == 1

def box(page, selector):
    b = page.locator(selector).bounding_box(); return {k: round(v) for k, v in b.items()}

def new_chat(page):
    """A stopped reply must be retried before its conversation continues, so each step starts a new conversation."""
    page.keyboard.press('Control+n'); expect(page.locator('#transcript article')).to_have_count(0)

def remote_menu(page, item):
    page.locator('#remote-toolbar .export-menu summary').click(); page.locator(item).click()

checks, errors = [], []
with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)

    # Chat: Stop in Send's place, by pointer and keyboard, at desktop and phone widths.
    for width in [1440, 390]:
        page = browser.new_page(viewport={'width': width, 'height': 900}); page.on('pageerror', lambda e: errors.append(str(e)))
        page.set_content(html)
        send, stop, prompt = page.locator('#send'), page.locator('#stop'), page.locator('#prompt')
        expect(send).to_be_visible(); expect(stop).to_be_hidden(); slot = box(page, '#send')
        prompt.fill('Show an inline visualization demo.'); send.click()
        expect(stop).to_be_visible(); expect(send).to_be_hidden()
        assert box(page, '#stop') == slot, (width, box(page, '#stop'), slot)
        expect(stop).to_be_focused(); expect(stop).to_have_accessible_name('Stop')
        stop.click(); expect(send).to_be_visible(); expect(stop).to_be_hidden(); expect(send).to_be_focused()
        new_chat(page)

        prompt.fill('A question sent from the keyboard'); prompt.press('Enter')
        expect(stop).to_be_visible(); expect(send).to_be_hidden(); expect(prompt).to_be_focused()
        stop.focus(); page.keyboard.press('Enter'); expect(send).to_be_visible(); expect(send).to_be_focused()
        new_chat(page)

        # The second press of a double-click lands on Stop, which ignores it; a separate click stops the reply.
        prompt.fill('Show an inline visualization demo, double-clicked.')
        x, y = slot['x'] + slot['width'] / 2, slot['y'] + slot['height'] / 2
        page.mouse.click(x, y); expect(stop).to_be_visible()
        page.mouse.down(click_count=2); page.mouse.up(click_count=2); page.wait_for_timeout(300)
        expect(stop).to_be_visible(); expect(send).to_be_hidden()
        stop.click(); expect(send).to_be_visible(); new_chat(page)
        if width == 1440:
            # A reply running in another conversation leaves Send in place, disabled, with no Stop.
            prompt.fill('Show an inline visualization demo in the first conversation.'); send.click(); expect(stop).to_be_visible()
            new_chat(page)
            expect(send).to_be_visible(); expect(send).to_be_disabled(); expect(stop).to_be_hidden()
            expect(send).to_be_enabled(timeout=20000)
        page.close()
    checks.append('Chat: Stop takes Send’s place at 1440/390px by pointer and keyboard, focus moves with it, and Send returns focused')
    checks.append('Chat: the second click of a double-click on Send does not stop the reply; another conversation’s reply leaves Send disabled in place')

    # Remote: Stop takes Start's place while the host's job runs, from any view, and Start returns once it stops.
    page = browser.new_page(viewport={'width': 1440, 'height': 900}); page.on('pageerror', lambda e: errors.append(str(e)))
    page.set_content(html); page.locator('#remote-nav').click()
    page.locator('#remote-host-name').fill('Sandbox'); page.locator('#remote-host-alias').fill('test-sandbox'); page.locator('#remote-host-form button').click()
    page.locator('#remote-enroll').click()
    page.locator('#remote-create summary').click(); page.locator('#remote-workspace-name').fill('Demo workspace'); page.locator('#remote-create-form button').click()
    expect(page.locator('#remote-workspace')).not_to_have_value('')
    start, stop, prompt = page.locator('#remote-start'), page.locator('#remote-stop'), page.locator('#remote-prompt')
    prompt.fill('A remote task'); expect(stop).to_be_hidden(); slots = {}
    for width in [390, 1440]:
        page.set_viewport_size({'width': width, 'height': 900}); page.wait_for_timeout(150); slots[width] = box(page, '#remote-start')
    start.click()
    expect(stop).to_be_visible(); expect(start).to_be_hidden(); expect(stop).to_have_accessible_name('Stop job')
    focus_after_start = page.evaluate('document.activeElement?.id || document.activeElement?.tagName')
    assert focus_after_start in ('remote-stop', 'remote-prompt'), focus_after_start
    for width in [1440, 390]:
        page.set_viewport_size({'width': width, 'height': 900}); page.wait_for_timeout(150)
        b, s = box(page, '#remote-stop'), slots[width]
        assert b['y'] == s['y'] and b['height'] == s['height'] and b['x'] + b['width'] == s['x'] + s['width'], (width, b, s)
        if width == 390: assert b == s, (b, s); assert page.locator('.remote-stop-label').bounding_box()['width'] <= 1
        else: expect(page.locator('.remote-stop-label')).to_be_visible()
    page.set_viewport_size({'width': 1440, 'height': 900})
    remote_menu(page, '#remote-new'); prompt.fill('A next task while the job runs')
    expect(stop).to_be_visible(); expect(start).to_be_hidden()
    expect(page.locator('#remote-start-note')).to_contain_text('One job at a time')
    stop.click()
    expect(stop).to_be_hidden(); expect(start).to_be_visible(); expect(start).to_be_focused()
    expect(prompt).to_have_value('A next task while the job runs')
    page.close()
    checks.append(f'Remote: Stop job takes Start’s place at 1440/390px, also from New task; focus after Start is on {focus_after_start}; Start returns focused once stopped')
    browser.close()
print(json.dumps({'checks': checks, 'javascriptErrors': errors}, indent=2))
assert not errors, errors
