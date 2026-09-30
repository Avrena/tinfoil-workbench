# Manual acceptance checklist — 1.3.0

This checklist covers what automated checks cannot establish.

For 1.2.0, the build steps in section 1 were already run on the build machine: doctor, tests, native smoke, packaging, the package check, the packaged smoke, a live verification of the inference and cloud sync enclaves through the packaged app, and a silent install over an installed review build of 1.2.0, itself installed over 1.1.0, with the installed app's smoke and live verification. Bootstrap was not repeated, because the lockfile changed only in its version fields. So were the Android emulator checks in section 6 marked *automated*, and an upgrade from the published 1.1.0 APK that kept a draft. The installer configuration is unchanged apart from the version, so the checks on a clean Windows were not repeated (see the [1.0.0 record](history/v1.0.0/VALIDATION.md#a-clean-windows)). With a real account on one phone, review builds of 1.2.0 were used for versions, editing in place, the title bar, messages in other roles and the thinking effort panel; a saved sign-in survived a force-stop and the update from a review build to the release-signed APK; and a system message added in the middle of a conversation was sent as one, although the model did not follow it (see [VALIDATION.md](VALIDATION.md#with-a-real-account)). The other real-account checks were made with [1.1.0](history/v1.1.0/VALIDATION.md#with-a-real-account) and [1.0.0](history/v1.0.0/VALIDATION.md#with-a-real-account). Whether real models create visuals when they help has been checked with Kimi K3 and GLM-5.3 on one phone, once per question (see the [0.18.0](history/v0.18.0/VALIDATION.md#model-test-on-a-phone) and [0.18.1](history/v0.18.1/VALIDATION.md#model-test-on-a-phone) records); GLM-5.3 Flash once wrote a chart call as text instead, which 1.1.0 and later draw in place. For other models, ask for an explanation that a chart or diagram would serve without asking for one, a history that a timeline would serve, a few headline figures, and a short factual question that needs none. Repeat section 1 on a standard-user Windows machine. The rest of sections 2–5 and the manual part of section 6 remain open until someone performs them with a real account on real hardware.

## 1. Establish the build

Use a standard Windows 11 x64 machine. Install Node.js 22.12 or newer, reopen PowerShell, and clone the repository (or extract a release source archive) to a local writable folder. Run in the folder containing package.json:

```powershell
node --version
npm --version
npm run bootstrap
npm run doctor
npm test
npm run smoke:desktop
npm start
```

Stop at the first failing command and preserve its output. Bootstrap runs npm ci against the committed, reviewed lockfile and fetches the Electron binary, verified against the checksums shipped in the pinned electron package. A DNS/proxy failure is not resolved by deleting validation or enabling plaintext storage. Review npm’s audit output and notices; for 1.1.0, `npm audit --omit=dev` reported no known vulnerabilities in runtime dependencies, and the full audit one moderate advisory in a development tool (see VALIDATION.md). Upgrades should be deliberate and retested, not an unconditional `--force` fix.

`doctor` must report all entries passing. A source-only pass says nothing about installation readiness. Native smoke must exit zero and print `DESKTOP_SMOKE_OK: encrypted storage, bridge, attested SDK import, native PDF print and PDF.js canvas`. It temporarily changes userData so it does not test against your real workspace. A smoke pass still does not exercise real authentication or the manual close interactions below.

Python is optional for normal use. Native runner tests are skipped without a detected interpreter; note the skip count. Select a real Python executable in Advanced only for approved execution tests. Python Playwright, Pillow and PyMuPDF are additional developer dependencies for the optional browser/layout suites, not Windows-client runtime requirements.

## 2. Accept first launch and account behavior

Begin with nonsensitive test content. Confirm that the empty workspace offers Set up connection, Advanced is not required, and the system-prompt field can remain blank. Choose one connection mode explicitly. Developer API credentials and a Chat subscription are separate; no automatic fallback is permitted.

For Chat mode, sign in on Tinfoil’s sign-in page in the separate window and note the method used. Check the displayed identity and subscription/access state, then check that the enclave is verified and the models load without pressing Verify & refresh models. If verification or the model list fails, the message must name the cause (a timeout, the verification step that failed, an ended session, or a network error code); record it. Open *Choose model*: it must list Tinfoil's chat models with their makers' logos and descriptions, and the welcome page must show the chosen model's maker logo. Send one short message. Leave the app open until the key’s expiry shown under Session & local workspace has passed (about 15 minutes), then send again: the reply must arrive without another sign-in. Inspect returned text/reasoning, stop another response and refresh account details. Quit and relaunch: with *Stay signed in on this PC* on, the account must be restored without the sign-in window and a message must send; then sign out, and a relaunch must require sign-in again. With the option off, a relaunch must require sign-in. Profile management must open the provider’s own interface, not produce a fake local save. For Tinfoil cloud chats (Windows), add the chat key under Tinfoil cloud chats: your cloud chats and projects must appear, open with their messages, and a test chat continued, renamed and deleted in Workbench must show those changes in Tinfoil Chat; a chat edited in Tinfoil Chat meanwhile must come back as the cloud version plus a “Workbench copy”. A Tinfoil Chat answer with a chart, timeline or stat cards must show them in Workbench where Tinfoil Chat shows them, and other widgets must be listed as not displayed. `tests/cloud-live.mjs` automates most of this with a test chat. On Android the same steps apply: sign in with email and password on Tinfoil’s page, on its own screen (Google and Apple are refused there with the reason shown), and after a relaunch the stored sign-in must be gone.

Use a synthetic existing thread to check same-account and different-account history approvals; approval alone must not send. Chat sign-in has been checked on Windows and Android. Additional sign-in methods remain explicit local checks. Do not infer one method from another. If the sign-in page stops, the Account view names any host the window refused; record it. Failure must remain visible and must not charge a saved developer key instead.

## 3. Accept recovery and daily UX

Type an unsent multilingual draft, attach a small UTF-8 text file, and close the native window immediately, before the debounce. Reopen under the same Windows user: text and file contents must remain attached without a generated turn. Remove the attachment and repeat. Save failures must leave the normal close blocked and the draft visible. Do not simulate failure by deleting your only real workspace; use a disposable test profile or fixture.

Drag a PNG from Explorer over the window: it must dim and say what a drop does, with the message box outlined; drop it, and the chip shows a thumbnail. Paste a picture copied in Explorer, a screenshot (Win+Shift+S) and a folder copied in Explorer; attach a PDF and a Word file (refused with a hint). Send a picture to a model that reads pictures and to one that does not (refused), and check the thumbnail in the sent message. With the workspace agent on, attach a project folder and ask for a file in it: the read needs no approval; a change there must ask.

Open the message editor and make changes. Alt+F4/window close must review unsaved edits; Keep working and Escape must preserve text and return focus. Explicit Close Workbench discards only the uncommitted editor/settings changes identified in the review while saving the composer draft. It must not silently save an edited answer or send a message. Repeat during an active response and verify retained partial output after restart. Normal closing protection is not a guarantee against power loss, Task Manager termination or OS shutdown.

Modify Advanced instructions/model effort without applying, switch threads and return. The pending values and supported effort choices must remain local and visible. Apply changes explicitly, then try Discard on another change and reopen Advanced: the actual inputs must show the applied settings. Threads with no pending values must not display the extra strip. A blank custom system prompt must remain accepted.

Open the instructions control beside the model; a new conversation must show None. Choose a starter, send a short message and check that the answer's footer names it. Switch back to None and check that the earlier answer keeps its label. Save an entry, edit it and delete it; a conversation that already uses it must keep its copy. In the instructions editor and in the message editor, type some text and press Escape twice: the discard question must stay and the text must remain. With close review open over an unsaved editor, Escape must answer close review and leave the editor open.

Check versions: edit a message in the composer and send it, Retry an answer, edit an answer and its thinking in place, and step through the ‹ › arrows on the message and the reply; Branch still makes a new conversation. Check local thinking annotations, project move/rename, search, keyboard focus, Copy, in-dialog errors and clearing an unsubmitted API key by closing Settings. Deleting a project must retain its threads. Exported files are plaintext and may contain the selected text, references, tool outputs or instructions; handle them accordingly.

## 4. Accept visuals and protected tools

Create one inline chart/table and one self-contained HTML artifact with a supported model. The output should share the response’s neutral background. Open Data/Source, toggle a series or filter a table, and continue streaming; retained controls must not reset. Expand into the artifact panel. HTML interaction must require the reader’s explicit enable action and have no desktop bridge or automatic external resource loading.

Open a local PDF, navigate a multi-page file, change zoom and inspect extracted text. Export a model-created artifact as PDF, then open the result in an independent local viewer. This is separate from the shared Chromium print-layout test. Password-protected and unusual font/codec PDFs are not guaranteed.

For optional Python, set Model-requested Python to Ask in Advanced: the interpreter must appear under it with its version, found without choosing anything, the one on PATH first, with the other installed interpreters listed; picking one there must not ask to Apply; a Microsoft Store shortcut or an uninstalled Python must not be listed. Pick another from the list, then request a harmless `print(1 + 1)` example. Decline once and verify no execution. Approve only the shown exact code, check stdout, then cancel a controlled sleep. Python has local account permissions, not a security sandbox. No runtime package install should occur implicitly.

For opt-in delegation, inspect the explicit task and approve one short child request, then test a decline/cancel. The UI must separate child and parent usage and not imply parallel execution. Hosted MCP/search requests require live entitlement testing; passive event rendering is not proof of an authenticated hosted execution session.

For the workspace agent (Windows), turn it on in Advanced for a new conversation. Send without choosing anything: Workbench must say where to choose. Choose where new folders are made (your home folder and a drive root must be refused), send again and check that a new, empty folder named after the date and the message appears there and that later messages keep it. For a project, choose a folder with a small project in it in Advanced; the message box has no folder button. Ask what the project does: the model must list and read files without asking. Ask it to fix something small: each change must show its diff in the conversation and in the approval window, and each command its exact text, shell and folder there, with any path outside the folder marked; Decline must have the focus, Esc must decline, and closing the window must decline. Decline one command and one change and check that nothing ran or changed, then approve one of each. Edit a file yourself while a change to it waits for approval; approving must then write nothing. Stop a long command (`Start-Sleep -Seconds 60`) and check that it ends. Set Approvals to Auto-run ("Also run commands without asking"): a Workbench confirmation window (not a Windows message box) must appear first, the message box's top edge must show "Agent · auto-run" and "Python · auto" in amber, `npm.cmd test` must run without asking and be marked "approved automatically", and `Remove-Item` or a command naming a path outside the folder must still ask and say why; with model-requested Python on, a Python run must not ask and must be marked "approved automatically"; set it back to asking from the page and check that the next command and the next Python run ask. Try Git Bash if Git for Windows is installed. A Tinfoil cloud chat must not offer the agent.

## 5. Display and packaging gate

On Windows test normal and maximized windows, snap layouts and 100/125/150/200% scaling. Check a long thread title, long email, dialog focus return, high contrast/reduced motion, IME and rapid Reading/focus/sidebar toggles. A prior intermittent rapid checkbox hit-test issue did not recur in this revision’s 12-cycle run; continue this stress check rather than treating it as conclusively fixed.

The renderer has Chromium touch/viewport coverage, not certified mobile OS support. Test actual phone/tablet browsers and real virtual keyboards if deploying a browser version; the Android app has its own checks in section 6. Do not assume mobile account sign-in or Safari behavior from Linux Chromium emulation.

After the checks above:

```powershell
npm run dist:win
```

The command gates packaging behind doctor, tests and native smoke and never publishes. Expected outputs are `release/Tinfoil-Workbench-1.3.0-x64-Setup.exe` and `release/Tinfoil-Workbench-1.3.0-x64-Portable.exe`. Validate the generated filenames and test both on a clean standard-user Windows installation. Code signing is not configured; do not describe artifacts as signed or instructions to disable OS protection. ARM64 requires its own real machine/runner validation.

Optional PowerShell orchestration: `./scripts/Local-Build.ps1 -Bootstrap -Package`. This script’s native execution remains untested here; the npm commands above are the reference sequence.

Record Windows build, architecture, display scale, Node/npm and installed Electron versions, test failures/skips, live sign-in method, SDK/attestation result and final artifact hashes. A completed checklist is the remaining acceptance evidence. No remote push or release upload is part of these commands.

## 6. Android acceptance

*Automated on Android 16 and Android 14 emulators (`tests/android-device.py`):* start-up and Keystore-backed storage, page CSP and worker network allowlist, disabled Capacitor plugins, Chat sign-in on Tinfoil’s page (Google refused, Cancel, no credential in the Workbench page, the sign-in profile deleted at the next launch) or its refusal where the WebView lacks the needed features, live enclave verification with an invalid key, the public model catalog and the model picker (opened by touch without the keyboard, maker badges, the welcome mark after choosing), draft durability across backgrounding and force-stop, resuming from the background in the same process, Back order, native confirmation, keyboard layout, the account view, the system instructions picker (touch, Back, saving with the on-screen keyboard open, persistence across a force-stop), the fonts used for code, system-picker export, attach and import, and the *Stay signed in on this phone* switch with nothing saved before a sign-in. Installing the published 1.1.0 APK and then the 1.2.0 APK over it, keeping a draft, was checked on the Android 16 emulator.

*Manual, on a physical phone with a real developer API key:*

- Install the signed APK over any earlier build and confirm existing conversations open. Confirm that an APK signed with a different key is refused as an update.
- Save a key and check that the enclave is verified and the models load; relaunch and check that this happens again by itself. Send a short message, stop a response, and continue a conversation with a visual artifact. Expand it into the workspace, open Data/Source, and save the original file.
- Background the app during a streamed response. Return, and after a force-stop confirm the partial text is kept and marked interrupted.
- Rotate the phone, use a tablet or foldable if available, and check TalkBack labels and focus order, large font sizes and dark/light system themes.
- Open a local PDF, attach several text files including a non-UTF-8 one (it must be refused), export Markdown/JSON, and import the JSON on another install.
- Open a link from a response. The native confirmation must name the host, and the page itself must never navigate away.
- Choose, save and edit system instructions while typing on the on-screen keyboard and with TalkBack. The composer control's spoken name must say which instructions are set, and Save must stay reachable while typing.
- On a device with an outdated Android System WebView, confirm the app shows *Update Android System WebView* instead of loading.
- With the release-signed APK, sign in to Tinfoil Chat with email and password and your second factor. Check that the enclave is verified and the models load by themselves, send a message, send again after the key’s expiry (about 15 minutes), background and resume the app. With *Stay signed in on this phone* on (the default), a force-stop and relaunch, and an update installed over the app, must open signed in without Tinfoil's page; turn it off and a relaunch must ask you to sign in again. Sign out; the next relaunch must ask again. Google or Apple must be refused with the reason shown.
- On a phone with Android System WebView 140 or later, open Account & connection, the message editor, System instructions and Settings in portrait and landscape. Their headers and close buttons must sit below the status bar and clear of any display cutout, their close buttons must respond to a tap, and their bottom actions must stay above the navigation bar.

Record the device model, Android version, WebView version, the key's billing mode, any failures, and the APK SHA-256.

## What is deliberately not in the release

No credentials, signing keys, node_modules or font binaries. No cloud sync on Android, arbitrary MCP client configuration, automatic hosted-code provisioning, Windows code signing, or Android Google or Apple sign-in, Python or HTML-to-PDF. Chat sign-in has been exercised on Windows from source and in the installed app, and on Android, on one phone, with a debug build and with release-signed builds up to 1.0.0; the other sign-in methods and the native protected actions still need acceptance on real hardware with a real account.
