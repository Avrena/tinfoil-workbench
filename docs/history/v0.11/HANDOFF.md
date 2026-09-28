# Manual acceptance checklist — 0.11.0

This checklist covers what automated checks cannot establish. **The custom system prompt is optional and not required.** No custom prompt needs to be copied from a ChatGPT response or this document.

For 0.11.0, the build steps in section 1 were already run on the build machine: bootstrap, doctor, tests, native smoke, packaging, the packaged and installed smoke, and a silent install and uninstall. So were the Android emulator checks in section 6 marked *automated*. See [VALIDATION.md](VALIDATION.md). Repeat section 1 on a clean, standard-user Windows machine. Sections 2–5 and the manual part of section 6 remain open until someone performs them with a real account on real hardware.

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

Stop at the first failing command and preserve its output. Bootstrap runs npm ci against the committed, reviewed lockfile and fetches the Electron binary, verified against the checksums shipped in the pinned electron package. A DNS/proxy failure is not resolved by deleting validation or enabling plaintext storage. Review npm’s audit output and notices; for 0.11.0 it reported no known vulnerabilities in runtime dependencies (see VALIDATION.md). Upgrades should be deliberate and retested, not an unconditional `--force` fix.

`doctor` must report all entries passing. A source-only pass says nothing about installation readiness. Native smoke must exit zero and print `DESKTOP_SMOKE_OK: encrypted storage, bridge, native PDF print and PDF.js canvas`. It temporarily changes userData so it does not test against your real workspace. A smoke pass still does not exercise real authentication or the manual close interactions below.

Python is optional for normal use. Native runner tests are skipped without a detected interpreter; note the skip count. Select a real Python executable in Settings only for approved execution tests. Python Playwright, Pillow and PyMuPDF are additional developer dependencies for the optional browser/layout suites, not Windows-client runtime requirements.

## 2. Accept first launch and account behavior

Begin with nonsensitive test content. Confirm that the empty workspace offers Set up connection, Advanced is not required, and the system-prompt field can remain blank. Choose one connection mode explicitly. Developer API credentials and a Chat subscription are separate; no automatic fallback is permitted.

For Chat mode, open the provider sign-in window, complete a supported sign-in flow, check the displayed identity and subscription/access state, then run Verify enclave & load models. Send one short message. Inspect returned text/reasoning, stop another response, refresh account details, and sign out. Relaunch must require sign-in again. Profile management must open the provider’s own interface, not produce a fake local save.

Use a synthetic existing thread to check same-account and different-account history approvals; approval alone must not send. Do not infer support for passkeys, social-provider pop-ups or every account policy from one successful password login. Those website/native-browser combinations remain explicit local checks. Failure must remain visible and must not charge a saved developer key instead.

## 3. Accept recovery and daily UX

Type an unsent multilingual draft, attach a small UTF-8 text file, and close the native window immediately, before the debounce. Reopen under the same Windows user: text and file contents must remain attached without a generated turn. Remove the attachment and repeat. Save failures must leave the normal close blocked and the draft visible. Do not simulate failure by deleting your only real workspace; use a disposable test profile or fixture.

Open the message editor and make changes. Alt+F4/window close must review unsaved edits; Keep working and Escape must preserve text and return focus. Explicit Close Workbench discards only the uncommitted editor/settings changes identified in the review while saving the composer draft. It must not silently save an edited answer or send a message. Repeat during an active response and verify retained partial output after restart. Normal closing protection is not a guarantee against power loss, Task Manager termination or OS shutdown.

Modify Advanced instructions/model effort without applying, switch threads and return. The pending values and supported effort choices must remain local and visible. Apply changes explicitly, then try Discard on another change and reopen Advanced: the actual inputs must show the applied settings. Threads with no pending values must not display the extra strip. A blank custom system prompt must remain accepted.

Check response/prompt branching, local thinking annotations, project move/rename, search, keyboard focus, Copy, in-dialog errors and clearing an unsubmitted API key by closing Settings. Deleting a project must retain its threads. Exported files are plaintext and may contain the selected text, references, tool outputs or instructions; handle them accordingly.

## 4. Accept visuals and protected tools

Create one inline chart/table and one self-contained HTML artifact with a supported model. The output should share the response’s neutral background. Open Data/Source, toggle a series or filter a table, and continue streaming; retained controls must not reset. Expand into the artifact panel. HTML interaction must require the reader’s explicit enable action and have no desktop bridge or automatic external resource loading.

Open a local PDF, navigate a multi-page file, change zoom and inspect extracted text. Export a model-created artifact as PDF, then open the result in an independent local viewer. This is separate from the shared Chromium print-layout test. Password-protected and unusual font/codec PDFs are not guaranteed.

For optional Python, select an interpreter and request a harmless `print(1 + 1)` example. Decline once and verify no execution. Approve only the shown exact code, check stdout, then cancel a controlled sleep. Python has local account permissions, not a security sandbox. No runtime package install should occur implicitly.

For opt-in delegation, inspect the explicit task and approve one short child request, then test a decline/cancel. The UI must separate child and parent usage and not imply parallel execution. Hosted MCP/search requests require live entitlement testing; passive event rendering is not proof of an authenticated hosted execution session.

## 5. Display and packaging gate

On Windows test normal and maximized windows, snap layouts and 100/125/150/200% scaling. Check a long thread title, long email, dialog focus return, high contrast/reduced motion, IME and rapid Reading/focus/sidebar toggles. A prior intermittent rapid checkbox hit-test issue did not recur in this revision’s 12-cycle run; continue this stress check rather than treating it as conclusively fixed.

The renderer has Chromium touch/viewport coverage, not certified mobile OS support. Test actual phone/tablet browsers and real virtual keyboards if deploying a browser version; the Android app has its own checks in section 6. Do not assume mobile account sign-in or Safari behavior from Linux Chromium emulation.

After the checks above:

```powershell
npm run dist:win
```

The command gates packaging behind doctor, tests and native smoke and never publishes. Expected outputs are `release/Tinfoil-Workbench-0.11.0-x64-Setup.exe` and `release/Tinfoil-Workbench-0.11.0-x64-Portable.exe`. Validate the generated filenames and test both on a clean standard-user Windows installation. Code signing is not configured; do not describe artifacts as signed or instructions to disable OS protection. ARM64 requires its own real machine/runner validation.

Optional PowerShell orchestration: `./scripts/Local-Build.ps1 -Bootstrap -Package`. This script’s native execution remains untested here; the npm commands above are the reference sequence.

Record Windows build, architecture, display scale, Node/npm and installed Electron versions, test failures/skips, live sign-in method, SDK/attestation result and final artifact hashes. A completed checklist is the remaining acceptance evidence. No remote push or release upload is part of these commands.

## 6. Android acceptance

*Automated on Android 16 and Android 14 emulators (`tests/android-device.py`):* start-up and Keystore-backed storage, page CSP and worker network allowlist, disabled Capacitor plugins, live enclave verification with an invalid key, draft durability across backgrounding and force-stop, Back order, native confirmation, keyboard layout, the account view, and system-picker export, attach and import.

*Manual, on a physical phone with a real developer API key:*

- Install the signed APK over any earlier build and confirm existing conversations open. Confirm that an APK signed with a different key is refused as an update.
- Save a key, run Verify enclave & load models, send a short message, stop a response, and continue a conversation with a visual artifact. Expand it into the workspace, open Data/Source, and save the original file.
- Background the app during a streamed response. Return, and after a force-stop confirm the partial text is kept and marked interrupted.
- Rotate the phone, use a tablet or foldable if available, and check TalkBack labels and focus order, large font sizes and dark/light system themes.
- Open a local PDF, attach several text files including a non-UTF-8 one (it must be refused), export Markdown/JSON, and import the JSON on another install.
- Open a link from a response. The native confirmation must name the host, and the page itself must never navigate away.
- On a device with an outdated Android System WebView, confirm the app shows *Update Android System WebView* instead of loading.

Record the device model, Android version, WebView version, the key's billing mode, any failures, and the APK SHA-256.

## What is deliberately not in the release

No credentials, signing keys, node_modules or font binaries. No Remember me, cloud sync, arbitrary MCP client configuration, automatic hosted-code provisioning, Windows code signing, or Android Chat sign-in, Python or HTML-to-PDF. The experimental account integration and the native protected actions still need acceptance on real hardware with a real account.
