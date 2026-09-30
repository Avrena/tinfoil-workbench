"""On-device checks for the Android app. Requires one running emulator or device (adb), Python
websocket-client for --debug, and an English system locale for the picker steps.

  python tests/android-device.py --debug   --apk release/Tinfoil-Workbench-<v>-android-debug.apk [--live]
  python tests/android-device.py --release --apk release/Tinfoil-Workbench-<v>-android.apk

--debug drives the debuggable build through the WebView DevTools socket: platform surface, renderer
CSP, worker network allowlist, disabled Capacitor plugins, draft durability across a force-stop,
Back navigation, native confirmation, the system instructions picker (touch, Back, vault
persistence), code fonts and keyboard layout. --live adds a real attestation check
against Tinfoil with a deliberately invalid key (verification must pass, the key must be rejected).
--release checks the signed build with UI Automator: start-up, non-debuggable package, draft
durability through the real IME, the Android account view, the instructions picker with Back, and
system document picker round trips.
Installing replaces any existing installation of the app and its local data."""
import argparse, itertools, json, os, re, subprocess, sys, time, urllib.request
from pathlib import Path

PKG = 'org.avrena.tinfoil.workbench'
sdk = os.environ.get('ANDROID_HOME') or os.environ.get('ANDROID_SDK_ROOT')
ADB = str(Path(sdk, 'platform-tools', 'adb.exe' if os.name == 'nt' else 'adb')) if sdk else 'adb'
parser = argparse.ArgumentParser()
mode = parser.add_mutually_exclusive_group(required=True)
mode.add_argument('--debug', action='store_true'); mode.add_argument('--release', action='store_true')
parser.add_argument('--apk', required=True); parser.add_argument('--live', action='store_true')
args = parser.parse_args()
results = []

def adb(*a, check=True):
    return subprocess.run([ADB, *a], capture_output=True, text=True, encoding='utf-8', errors='replace', check=check).stdout.strip()

def record(name, ok, detail=''):
    results.append({'check': name, 'ok': bool(ok), 'detail': detail})
    print(('PASS ' if ok else 'FAIL ') + name + (f' :: {detail}' if detail else ''), flush=True)

def resumed():
    m = re.search(r'topResumedActivity=ActivityRecord\{\S+ \S+ (\S+)', adb('shell', 'dumpsys', 'activity', 'activities'))
    return m.group(1) if m else ''

def start(fresh=False):
    if fresh: adb('shell', 'am', 'force-stop', PKG)
    adb('shell', 'am', 'start', '-W', '-n', f'{PKG}/.MainActivity')
    for _ in range(40):
        pid = adb('shell', 'pidof', PKG, check=False)
        if pid: return pid
        time.sleep(0.5)
    raise RuntimeError('The app did not start.')

def nodes():
    for attempt in range(5):  # uiautomator occasionally exits 137 while a previous dump is shutting down
        if subprocess.run([ADB, 'shell', 'uiautomator', 'dump', '/sdcard/workbench-ui.xml'], capture_output=True).returncode == 0: break
        time.sleep(1.5)
    xml = adb('shell', 'cat', '/sdcard/workbench-ui.xml', check=False)
    out = []
    for m in re.finditer(r'<node [^>]*>', xml):
        n = m.group(0)
        out.append((re.search(r' text="([^"]*)"', n).group(1), re.search(r'content-desc="([^"]*)"', n).group(1),
                    re.search(r'class="([^"]*)"', n).group(1), tuple(map(int, re.search(r'bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"', n).groups()))))
    return out

def find(label, timeout=20, exact=True):
    end = time.time() + timeout
    while time.time() < end:
        for text, desc, cls, box in nodes():
            # Some devices draw dialog buttons in capitals, so labels match regardless of case.
            if any((v.casefold() == label.casefold()) if exact else (label.casefold() in v.casefold()) for v in (text, desc)): return box
        time.sleep(1)
    return None

def composer_box(timeout=20):
    end = time.time() + timeout
    while time.time() < end:
        box = next((b for t, d, c, b in nodes() if c == 'android.widget.EditText'), None)
        if box: return box
        time.sleep(1)
    raise RuntimeError('The composer is not visible.')

def keyboard_shown():
    return re.search(r'mInputShown=true|mImeWindowVis=3', adb('shell', 'dumpsys', 'input_method')) is not None

def back(wait=0.8):
    adb('shell', 'input', 'keyevent', 'KEYCODE_BACK'); time.sleep(wait)

def tap(label, timeout=20, exact=True):
    box = find(label, timeout, exact)
    if box: adb('shell', 'input', 'tap', str((box[0] + box[2]) // 2), str((box[1] + box[3]) // 2)); time.sleep(1.2)
    return bool(box)

class Target:
    """Minimal CDP client. Android WebView does not support Playwright's CDP browser contexts."""
    def __init__(self, url=None, session=None, shared=None):
        import websocket
        self.ws = shared.ws if shared else websocket.create_connection(url, suppress_origin=True, timeout=180)
        self.ids = shared.ids if shared else itertools.count(1)
        self.events = shared.events if shared else []
        self.session = session
    def call(self, method, **params):
        mid = next(self.ids); msg = {'id': mid, 'method': method, 'params': params}
        if self.session: msg['sessionId'] = self.session
        self.ws.send(json.dumps(msg))
        while True:
            reply = json.loads(self.ws.recv())
            if reply.get('id') == mid:
                if 'error' in reply: raise RuntimeError(reply['error'])
                return reply['result']
            if 'method' in reply: self.events.append(reply)
    def eval(self, fn, *a):
        r = self.call('Runtime.evaluate', expression=f'({fn})(...{json.dumps(list(a))})', awaitPromise=True, returnByValue=True)
        if 'exceptionDetails' in r:
            d = r['exceptionDetails']; raise RuntimeError((d.get('exception') or {}).get('description') or d.get('text'))
        return r['result'].get('value')
    def worker(self):
        # Worker targets are only reliable through a flattened auto-attach session on the page socket.
        self.call('Target.setAutoAttach', autoAttach=True, waitForDebuggerOnStart=False, flatten=True)
        for _ in range(40):
            for e in self.events:
                if e['method'] == 'Target.attachedToTarget' and e['params']['targetInfo']['type'] == 'worker':
                    w = Target(session=e['params']['sessionId'], shared=self)
                    if w.eval('() => location.pathname') == '/mobile/host-worker.js': return w
            self.call('Runtime.evaluate', expression='1'); time.sleep(0.25)
        raise RuntimeError('Host worker not found.')

def devtools(pid):
    adb('forward', '--remove-all', check=False)
    adb('forward', 'tcp:9333', f'localabstract:webview_devtools_remote_{pid}')
    for _ in range(80):
        try:
            pages = [t for t in json.load(urllib.request.urlopen('http://127.0.0.1:9333/json/list', timeout=5)) if t['type'] == 'page' and t['url'].startswith('https://localhost/')]
        except Exception:
            pages = []
        if pages:
            try:
                page = Target(pages[0]['webSocketDebuggerUrl'])
                for _ in range(80):
                    if page.eval("() => document.documentElement.dataset.platform === 'android' && !!document.querySelector('#prompt')"):
                        return page, page.worker()
                    time.sleep(0.25)
            except Exception:
                pass  # The page target can be replaced while the WebView finishes loading; reconnect.
        time.sleep(0.5)
    raise RuntimeError('The Workbench page did not load.')

def snap(page): return page.eval('() => window.tinfoil.snapshot()')
def command(page, c): return page.eval('(c) => window.tinfoil.command(c)', c)
def active_settings(s): return next(t for t in s['workspace']['threads'] if t['id'] == s['workspace']['activeId'])['settings']

def tap_css(page, selector, wait=1.0):
    # Tap an element at its on-screen position (CSS box x device pixel ratio + WebView offset).
    x, y, dpr = page.eval("(s) => { const r = document.querySelector(s).getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2, devicePixelRatio]; }", selector)
    view = json.loads(next(t for t in json.load(urllib.request.urlopen('http://127.0.0.1:9333/json/list', timeout=5)) if t['type'] == 'page')['description'])
    adb('shell', 'input', 'tap', str(int(x * dpr + view.get('screenX', 0))), str(int(y * dpr + view.get('screenY', 0)))); time.sleep(wait)

def platform_fonts(page, selectors):
    # Families Blink actually used for each element's text, as DevTools reports them.
    page.call('DOM.enable'); page.call('CSS.enable')
    root = page.call('DOM.getDocument', depth=-1)['root']['nodeId']
    node = lambda sel: page.call('DOM.querySelector', nodeId=root, selector=sel)['nodeId']
    out = {k: sorted({f['familyName'] for f in page.call('CSS.getPlatformFontsForNode', nodeId=node(v))['fonts']}) for k, v in selectors.items()}
    page.call('CSS.disable'); page.call('DOM.disable')
    return out

adb('uninstall', PKG, check=False)
record('APK installs', 'Success' in adb('install', args.apk))

if args.debug:
    page, worker = devtools(start())
    s = snap(page)
    record('snapshot comes from the Android host', s.get('platform') == 'android' and s['storage'] == 'os-encrypted')
    record('snapshot carries no credentials', 'apiKey' not in s['workspace'] and 'cacheSecret' not in s['workspace'])
    bridge = page.eval("() => ({ keys: Object.keys(window.tinfoil).sort(), frozen: Object.isFrozen(window.tinfoil), writable: Object.getOwnPropertyDescriptor(window, 'tinfoil').writable })")
    record('window.tinfoil is the fixed, frozen bridge', bridge['keys'] == ['command', 'onAppEvent', 'snapshot', 'subscribe'] and bridge['frozen'] and not bridge['writable'])
    record('desktop-only controls are hidden', page.eval("() => ['.window-controls', '.python-interpreter', '.settings-account-link'].every(s => getComputedStyle(document.querySelector(s)).display === 'none')"))
    probe = "async (url) => { try { const r = await fetch(url); return 'status ' + r.status; } catch (e) { return 'blocked'; } }"
    record('renderer page cannot reach the network (CSP)', page.eval(probe, 'https://atc.tinfoil.sh/routers?platform=snp') == 'blocked')
    record('worker reaches Tinfoil', worker.eval(probe, 'https://atc.tinfoil.sh/routers?platform=snp') == 'status 200')
    for url in ['https://example.com/', 'http://atc.tinfoil.sh/routers', 'https://tinfoil.sh.example.com/', 'https://localhost:8443/']:
        record(f'worker cannot reach {url}', worker.eval(probe, url) != 'status 200')
    plugins = page.eval("""async () => { const out = {};
      for (const [p, m, a] of [['CapacitorHttp', 'request', { url: 'https://example.com', method: 'GET' }], ['CapacitorCookies', 'getCookies', {}], ['WebView', 'setServerBasePath', { path: '/data/local/tmp' }]]) {
        try { await Promise.race([window.Capacitor.nativePromise(p, m, a), new Promise((_, no) => setTimeout(() => no(new Error('no response')), 5000))]); out[p] = 'resolved'; }
        catch (e) { out[p] = e.message || String(e); } }
      return out; }""")
    record("Capacitor's native HTTP, cookie and server-path plugins are disabled", all(v == 'This capability is disabled in Tinfoil Workbench.' for v in plugins.values()), json.dumps(plugins))
    # Tinfoil Chat sign-in (docs/ANDROID-ACCOUNT.md): with a WebView that supports profiles and message ports, Tinfoil's
    # page opens on a separate screen with no bridge; otherwise the account commands are refused with the Android message.
    s = snap(page)
    if s.get('chatAvailable'):
        profiles = lambda: sorted(set(re.findall(r'app_webview/([^/\s]+)', adb('shell', 'run-as ' + PKG + ' find app_webview -maxdepth 2 -type d', check=False))))
        command(page, {'type': 'account.login'})
        record("Chat sign-in opens Tinfoil's page on a separate screen, in a profile of its own",
               find('Sign in to Tinfoil Chat', 20) is not None and find('Continue with Google', 30, exact=False) is not None and len(profiles()) > 1 and snap(page)['account']['status'] == 'signing-in', json.dumps(profiles()))
        tap('Continue with Google', 10, exact=False); time.sleep(3)
        record('Google sign-in is refused there, with the reason shown and reported',
               find('Google and Apple sign-in are not available in the Android app. Sign in with your email and password.', 10) is not None and 'accounts.google.com' in (snap(page)['account'].get('message') or ''))
        tap('Cancel', 10); time.sleep(1.5)
        s = snap(page)
        record('Cancel closes the page and ends the sign-in', find('Sign in to Tinfoil Chat', 3) is None and s['account']['status'] == 'error' and s['account']['message'] == 'Sign-in was cancelled.', s['account']['message'])
        command(page, {'type': 'account.cancel'})
        record('the main page holds no account port or credential', page.eval("() => !Object.getOwnPropertyNames(window).some(n => /account|clerk/i.test(n)) && !/eyJ[A-Za-z0-9_-]{10,}\\./.test(document.documentElement.outerHTML)"))
        adb('shell', 'am', 'force-stop', PKG)
        page, worker = devtools(start())
        record('the sign-in profile is deleted at the next launch', profiles() == ['Default'] and snap(page)['account']['status'] == 'signed-out', json.dumps(profiles()))
        # Staying signed in, on by default: offered in Account, and turned off and on through the native store (turning it
        # off deletes a saved sign-in there). Nothing is saved before a sign-in completes.
        command(page, {'type': 'account.remember', 'enabled': False}); off = snap(page).get('rememberAccount')
        command(page, {'type': 'account.remember', 'enabled': True}); on = snap(page).get('rememberAccount')
        page.eval("() => { const b = document.createElement('button'); b.dataset.action = 'account'; document.body.append(b); b.click(); b.remove(); }"); time.sleep(1)
        switch = page.eval("() => { const b = document.querySelector('#account-dialog [data-action=account-remember]'); return b ? [b.textContent, b.getAttribute('aria-checked')] : null; }")
        page.eval("() => document.querySelector('#account-dialog').close()")
        files = adb('shell', 'run-as ' + PKG + ' ls no_backup', check=False)
        record('staying signed in is offered on the phone and turns off and on through the native store, with nothing saved before a sign-in',
               off is False and on is True and switch == ['Stay signed in on this phone', 'true'] and 'account-session.bin' not in files, json.dumps([off, on, switch, files]))
        command(page, {'type': 'connection.mode', 'mode': 'api-key'})  # sign-in selected Chat mode; the checks below use a key
    else:
        refusals = page.eval("""async () => { const out = [];
      for (const c of [{ type: 'account.login' }, { type: 'account.refresh' }, { type: 'account.signout' }, { type: 'connection.mode', mode: 'chat-account' }]) {
        try { await window.tinfoil.command(c); out.push('accepted'); } catch (e) { out.push(e.message); } }
      return out; }""")
        s = snap(page)
        record('without WebView support, Chat sign-in and Chat mode are refused with the Android message, and the API-key connection stays',
               all(r == 'Tinfoil Chat sign-in needs a newer Android System WebView on this device. Use a developer API key.' for r in refusals) and s.get('connectionMode') == 'api-key' and s['account']['status'] == 'signed-out', json.dumps(refusals))
    if args.live:
        command(page, {'type': 'credentials.set', 'key': 'invalid-test-key-no-account'})
        command(page, {'type': 'connect'})
        s = snap(page)
        record('enclave attestation verifies in the Android worker', s['verification']['state'] == 'verified', json.dumps(s['verification']['steps']))
        record("Tinfoil's public model catalog loads in the Android worker and names the models' makers",
               s.get('modelCatalog') == 'ready' and any((c.get('display') or {}).get('maker') for c in s.get('capabilities') or []), f"{s.get('modelCatalog')}, {len(s.get('capabilities') or [])} entries")
        if not tap('Choose model', exact=False): page.eval("() => document.querySelector('#composer-model').click()")
        time.sleep(1)
        first = page.eval("() => { const b = document.querySelector('#model-options [data-quick-model]'); return b && [b.dataset.quickModel, b.getAttribute('aria-label')]; }")
        record('the model picker opens on a list with maker badges, without raising the keyboard',
               bool(first) and not keyboard_shown() and page.eval("() => document.querySelectorAll('#model-options .maker-badge').length") > 1, json.dumps(first))
        if first and not tap(first[1]): page.eval("(id) => document.querySelector(`[data-quick-model=\"${id}\"]`).click()", first[0])
        time.sleep(1)
        chosen = page.eval("() => [document.querySelector('#model-dialog').open, document.querySelector('#composer-model .model-label')?.textContent, document.querySelector('.empty-mark .maker-mark')?.getAttribute('class') ?? 'no welcome page']")
        record("tapping a model chooses it and shows its maker on the composer and the welcome page",
               bool(first) and chosen[0] is False and first[1].startswith(chosen[1] + ', ') and re.search(r'\bmaker-(?!mark\b)[a-z]', chosen[2]) is not None, json.dumps(chosen))
        thread = s['workspace']['activeId']
        settings = next(t for t in s['workspace']['threads'] if t['id'] == thread)['settings']
        model = next((m for m in s['models'] if not re.search('embed|whisper|tts', m)), s['models'][0])
        command(page, {'type': 'thread.settings', 'id': thread, 'settings': {**settings, 'model': model}})
        command(page, {'type': 'send', 'id': thread, 'text': 'Connectivity check with an invalid key.', 'attachments': []})
        for _ in range(240):
            s = snap(page)
            if not s['busyThreadId']: break
            time.sleep(0.5)
        reply = next(t for t in s['workspace']['threads'] if t['id'] == thread)['turns'][-1]['replies'][0]
        record('the invalid key is rejected by the attested endpoint, with no fallback', reply['status'] == 'error' and 'authentication' in (reply.get('error') or '').lower(), reply.get('error'))
        command(page, {'type': 'credentials.clear'})
    draft = 'Unsent Android draft 中文 ✓'
    page.eval("(t) => { const p = document.querySelector('#prompt'); p.value = t; p.dispatchEvent(new Event('input', { bubbles: true })); }", draft)
    adb('shell', 'input', 'keyevent', 'KEYCODE_HOME'); time.sleep(2.5)
    adb('shell', 'am', 'force-stop', PKG)
    page, worker = devtools(start())
    record('a draft typed just before backgrounding survives a force-stop', page.eval("() => document.querySelector('#prompt').value") == draft)
    page.eval("() => document.querySelector('[data-action=settings]').click()"); time.sleep(0.8)
    adb('shell', 'input', 'keyevent', 'KEYCODE_BACK'); time.sleep(0.8)
    record('Back closes an open dialog first', not page.eval("() => document.querySelector('#settings-dialog').open") and PKG in resumed())
    page.eval("() => document.querySelector('[data-action=sidebar]').click()"); time.sleep(0.8)
    adb('shell', 'input', 'keyevent', 'KEYCODE_BACK'); time.sleep(0.8)
    record('Back closes the navigation drawer next', page.eval("() => document.querySelector('#shell').classList.contains('no-sidebar')") and PKG in resumed())
    pid = adb('shell', 'pidof', PKG)
    adb('shell', 'input', 'keyevent', 'KEYCODE_BACK'); time.sleep(1.2)
    record('Back at the root backgrounds the app without finishing it', PKG not in resumed() and adb('shell', 'pidof', PKG, check=False) == pid)
    adb('shell', 'am', 'start', '-W', '-n', f'{PKG}/.MainActivity'); time.sleep(1)
    record('returning from the background resumes the same process, page and draft',
           PKG in resumed() and adb('shell', 'pidof', PKG, check=False) == pid and page.eval("() => document.querySelector('#prompt').value") == draft and snap(page).get('platform') == 'android')
    if args.live:
        record('after resuming, the host worker still reaches Tinfoil', worker.eval(probe, 'https://atc.tinfoil.sh/routers?platform=snp') == 'status 200')
    command(page, {'type': 'thread.new'})
    target = snap(page)['workspace']['activeId']
    page.eval("(id) => { window.__result = null; window.tinfoil.command({ type: 'thread.delete', id }).then(() => window.__result = 'done'); }", target)
    record('deleting shows a native Android dialog the page cannot answer', find('Delete conversation', 10) is not None and page.eval('() => window.__result') is None)
    tap('Cancel'); time.sleep(0.8)
    record('Cancel keeps the conversation', any(t['id'] == target for t in snap(page)['workspace']['threads']))
    page.eval("(id) => { window.tinfoil.command({ type: 'thread.delete', id }); }", target)
    tap('Delete conversation'); time.sleep(0.8)
    record('confirming removes the conversation', not any(t['id'] == target for t in snap(page)['workspace']['threads']))
    # Optional system instructions: real taps, the real Back key and the Keystore-encrypted vault.
    is_open = lambda: page.eval("() => document.querySelector('#instructions-dialog').open")
    chip = page.eval("() => { const c = document.querySelector('#composer-instructions'), r = c.getBoundingClientRect(); return { width: Math.round(r.width), height: Math.round(r.height), name: getComputedStyle(c.querySelector('span')).display }; }")
    tap_css(page, '#composer-instructions')
    record('the icon-only instructions control opens the picker from a touch', chip['height'] >= 44 and chip['name'] == 'none' and is_open(), json.dumps(chip))
    tap_css(page, '[data-instructions="starter:starter-concise"]')
    settings = active_settings(snap(page)); dot = page.eval("() => getComputedStyle(document.querySelector('#composer-instructions'), '::after').content")
    record('a tapped starter applies through the Android host, marked by a dot as well as colour', settings['systemPromptName'] == 'Concise' and settings['systemPrompt'].startswith('Be concise.') and not is_open() and dot not in ('none', 'normal'), dot)
    tap_css(page, '#composer-instructions'); tap_css(page, '[data-action=instructions-new]')
    page.eval("() => { for (const [s, v] of [['#instructions-name', 'Field notes'], ['#instructions-text', 'Answer with short field notes.']]) { const el = document.querySelector(s); el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); } }")
    editor_state = "() => ({ open: document.querySelector('#instructions-dialog').open, discard: !document.querySelector('#instructions-discard').hidden, text: document.querySelector('#instructions-text').value })"
    if keyboard_shown(): back()  # The first Back only hides the keyboard, as it does for a user.
    back(); asked = page.eval(editor_state)
    back(); st = page.eval(editor_state)
    record('Back in the instructions editor asks before discarding unsaved text, also when pressed again', asked['discard'] and st['open'] and st['discard'] and st['text'] == 'Answer with short field notes.' and PKG in resumed(), json.dumps(st))
    tap_css(page, '[data-action=instructions-keep]'); typing = keyboard_shown()
    tap_css(page, '#instructions-save')
    s = snap(page)
    record('with the keyboard open, Save stays reachable and stores the entry without changing the conversation', typing and [p['name'] for p in s['workspace']['instructionPresets']] == ['Field notes'] and active_settings(s)['systemPromptName'] == 'Concise' and page.eval("() => !document.querySelector('#instructions-list-view').hidden"), f'keyboard shown: {typing}')
    tap_css(page, '[data-action=instructions-new]')
    if keyboard_shown(): back()
    back(); listed = page.eval("() => document.querySelector('#instructions-dialog').open && !document.querySelector('#instructions-list-view').hidden")
    back()
    record('Back steps from an unchanged editor to the list, then closes the picker', listed and not is_open() and PKG in resumed())
    page.eval('''() => { const r = document.createElement('div'); r.className = 'reply-content'; r.id = 'font-probe';
      r.innerHTML = '<p>Inline <code id="probe-inline">inline_code()</code></p><div class="code-block"><pre><code id="probe-block">const x = 1;</code></pre></div><p id="probe-old">Previous code stack</p>';
      r.querySelector('#probe-old').style.fontFamily = 'Consolas,"Cascadia Code","Courier New",monospace'; document.body.append(r); void r.offsetHeight; }''')
    time.sleep(0.5); fonts = platform_fonts(page, {'inline': '#probe-inline', 'block': '#probe-block', 'previous_stack': '#probe-old'})
    page.eval("() => document.querySelector('#font-probe').remove()")
    record('inline and block code share one sans monospace face, not the Courier New typewriter alias', fonts['inline'] and fonts['inline'] == fonts['block'] and not any('Cutive' in f for f in fonts['inline']), json.dumps(fonts))
    adb('shell', 'am', 'force-stop', PKG)
    page, worker = devtools(start())
    s = snap(page); label = page.eval("() => document.querySelector('#composer-instructions').getAttribute('aria-label')")
    record('saved instructions and the conversation choice survive a force-stop in the encrypted vault', [p['name'] for p in s['workspace']['instructionPresets']] == ['Field notes'] and active_settings(s)['systemPromptName'] == 'Concise' and 'Concise' in label, label)
    tap_css(page, '#prompt', wait=2)
    g = page.eval("() => ({ bottom: document.querySelector('.composer').getBoundingClientRect().bottom, viewport: visualViewport.height, focused: document.activeElement?.id })")
    shown = re.search(r'mInputShown=true|mImeWindowVis=3', adb('shell', 'dumpsys', 'input_method')) is not None
    record('the composer stays above the on-screen keyboard', shown and g['focused'] == 'prompt' and g['bottom'] <= g['viewport'] + 1, json.dumps(g))
    adb('shell', 'input', 'keyevent', 'KEYCODE_BACK'); time.sleep(1)
    record('Back dismisses the keyboard before anything else', PKG in resumed())
else:
    start()
    record('the release build opens the encrypted workspace', find('What are we working on?', 40, exact=False) is not None)
    onboarding = find('Connect an account or API key to start.', 5, exact=False) is not None
    record('onboarding offers a connection', onboarding or find('Add a Tinfoil API key to start.', 3, exact=False) is not None)
    run_as = subprocess.run([ADB, 'shell', 'run-as', PKG, 'ls'], capture_output=True, text=True)
    record('the release package is not debuggable', 'DEBUGGABLE' not in adb('shell', 'dumpsys', 'package', PKG) and 'not debuggable' in run_as.stderr + run_as.stdout)
    box = composer_box()
    adb('shell', 'input', 'tap', str((box[0] + box[2]) // 2), str((box[1] + box[3]) // 2)); time.sleep(1.5)
    adb('shell', 'input', 'text', 'Release%sdraft%scheck'); time.sleep(0.5)
    adb('shell', 'input', 'keyevent', 'KEYCODE_HOME'); time.sleep(2.5)
    adb('shell', 'am', 'force-stop', PKG); start()
    record('a draft typed through the IME survives a force-stop', find('Release draft check', 30, exact=False) is not None)
    tap('Set up connection')
    record('the account view offers Tinfoil Chat sign-in, or says why it is unavailable',
           find('Sign in to Tinfoil Chat', 10) is not None if onboarding else find('Tinfoil Chat sign-in needs a newer Android System WebView', 10, exact=False) is not None)
    # Android 14 can drop the first Back after the force-stop restart; press again only while the account view is open.
    for _ in range(2):
        adb('shell', 'input', 'keyevent', 'KEYCODE_BACK'); time.sleep(1)
        if find('Sign in to Tinfoil Chat', 2) is None and find('Tinfoil Chat sign-in needs a newer Android System WebView', 1, exact=False) is None: break
    none_row = 'Provider defaults. No instructions of yours are sent.'
    tap('System instructions', exact=False)
    record('the instructions picker opens from the composer control', find(none_row, 10, exact=False) is not None)
    tap('Concise', exact=False)
    record('choosing a starter names it on the composer control', find('System instructions: Concise', 10, exact=False) is not None)
    tap('System instructions', exact=False); tap('New instructions')
    if keyboard_shown(): back(1)  # The first Back only hides the keyboard.
    back(1); listed = find(none_row, 10, exact=False) is not None
    back(1)
    record('Back steps from the instructions editor to the list, then closes the picker', listed and find(none_row, 3, exact=False) is None and PKG in resumed())
    adb('shell', 'rm', '-f', '/sdcard/Download/conversation.md', '/sdcard/Download/conversation.json', '/sdcard/Download/notes.md', check=False)
    tap('Conversation menu'); tap('Export Markdown')
    record('export asks for native confirmation', find('Export an unencrypted copy?', 10) is not None)
    tap('Export plaintext'); tap('SAVE', 15) or tap('Save', 5); time.sleep(2)
    record('export writes the file chosen in the system picker', 'Exported from Tinfoil Workbench' in adb('shell', 'cat', '/sdcard/Download/conversation.md', check=False))
    note = Path(os.environ.get('TEMP', '/tmp'), 'workbench-notes.md'); note.write_text('# Field notes\n\nUTF-8: 中文 ✓\n', encoding='utf-8')
    adb('push', str(note), '/sdcard/Download/notes.md')
    tap('Attach text or code files')
    if find('notes.md', 5) is None: tap('Show roots'); tap('Downloads', exact=False)
    record('a text file picked in the system picker becomes an attachment', tap('notes.md', 15) and find('notes.md', 10) is not None)
    tap('Conversation menu'); tap('Export JSON'); tap('Export plaintext'); tap('SAVE', 15) or tap('Save', 5); time.sleep(2)
    tap('Conversation menu'); tap('Import conversation')
    if find('conversation.json', 5) is None: tap('Show roots'); tap('Downloads', exact=False)
    tap('conversation.json', 15); time.sleep(2)
    tap('Toggle conversation sidebar')
    record('an exported JSON conversation imports back', find('imported', 10, exact=False) is not None)
    adb('shell', 'input', 'keyevent', 'KEYCODE_BACK')

passed = sum(r['ok'] for r in results)
print(json.dumps({'mode': 'debug' if args.debug else 'release', 'live': args.live, 'passed': passed, 'total': len(results),
                  'device': adb('shell', 'getprop', 'ro.build.version.release'), 'webview': re.search(r'Current WebView package \(name, version\): \(([^)]*)\)', adb('shell', 'dumpsys', 'webviewupdate')).group(1)}, ensure_ascii=False))
sys.exit(0 if passed == len(results) else 1)
