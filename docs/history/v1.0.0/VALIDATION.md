# Tinfoil Workbench 1.0.0 — validation record

Recorded 30 September 2026 for the 1.0.0 release, the first stable release. It updates Electron, PDF.js, TypeScript and the CI actions, names a browser engine too old for PDF.js 6, leaves PDF.js and its Node canvas module out of the Windows package, and brings the documentation up to date with a list of known limitations. For this release the installation was also checked on a clean Windows, upgrades were checked from the first release, 0.11.0, on both platforms, and the account features were checked with a real account in the installed Windows app and in the release-signed Android app. The record lists what ran, what failed on the way, and what did not run. The previous record is in [history/v0.18.1](../v0.18.1/VALIDATION.md).

## Environment

- **Windows build machine:** Windows 11 Pro 10.0.26200 (x64). Other work was running on the machine during the checks.
- **Toolchains and emulators:** unchanged from 0.18.1. **Dependencies:** Electron 44.4.5, PDF.js 6.3.289 (now a development dependency), TypeScript 7.0.2; the rest are unchanged. A clean `npm run bootstrap` followed by `npm run doctor` passed all 28 entries. `npm audit --omit=dev` reports no known vulnerabilities in the runtime dependencies; the full audit reports one moderate advisory (`uuid` below 11, through `xcode` in `@capacitor/cli`, a development tool for iOS projects that is not packaged).
- **Clean Windows:** Windows Sandbox on the build machine (Windows 10.0.26100 inside), with networking, discarded afterwards. Its account is an administrator.
- **Phone:** Android 15, Android System WebView 153, 360 CSS pixels wide, with the release-signed 1.0.0 APK installed over 0.18.1.

## With a real account

Performed with a real Tinfoil account; a handful of short messages were sent in all.

| Where | Check | Result |
|---|---|---|
| Windows, installed 1.0.0 | Launch with the saved Chat sign-in from an earlier version | Signed in, *Enclave verified* by itself |
| | Tinfoil cloud chats: the chat key added under Account | Cloud chats and projects listed |
| | A chat whose answer Tinfoil Chat drew as a chart on the web, after *Sync now* | The chart shown in Workbench where Tinfoil Chat shows it |
| | A new conversation, a reply, *Move to Tinfoil cloud*, then *Delete* | Moved, then deleted after the question |
| | Sign out, then a fresh Chat sign-in | *Enclave verified* |
| | The same chart question asked in Workbench with GLM-5.3 Flash | **Failed.** The model wrote `render_chart{…}` into its answer as text instead of calling the tool, so nothing was drawn. The same question on the web with the same model drew the widget |
| Phone, release-signed 1.0.0 | Chat sign-in, then a message with GLM-5.3 Flash | Reply a few seconds slower than expected |
| | A message 16 minutes later, after the key had expired | Reply without another sign-in |
| | *Count from 1 to 40 in words*, then the home screen for about 10 seconds during the reply | **Failed.** Back in the app, the reply had ended with *Tinfoil could not be reached* and no text |
| | Sign out | Signed out |

- **The lost reply.** Android pauses the app's WebView in the background, and the worker's streaming connection broke. Workbench reports any connection failure without a status as *Tinfoil could not be reached. Check your connection and try again.*, which is misleading here. The README lists it as a known limitation; a message that names the interruption, or a reply that continues in the background, is left for a later release.
- **The chart written as text.** Workbench's tool guide tells the model to call a visual's tool at the point where the visual belongs in its answer. GLM-5.3 Flash appears to have read that as writing the call into the text. Kimi K3 and GLM-5.3 made the calls with the same guide in the tests recorded for 0.17.2, 0.18.0 and 0.18.1. The README lists it as a known limitation.

## A clean Windows

A script in Windows Sandbox, starting from a Windows without Node.js or any Workbench data. It drove the app through Chromium's remote debugging port.

| Check | Result |
|---|---|
| `Setup.exe /S /currentuser` | Exit 0; the executable and the uninstall entry report 1.0.0; Start menu shortcut present |
| Installed app `--smoke-test` | `DESKTOP_SMOKE_OK` |
| `check-packaged-provider.mjs` run by the installed executable | `PACKAGED_PROVIDER_OK` with both enclaves |
| First launch | The encrypted workspace opened (`os-encrypted`) |
| An invented API key, a relaunch, then a message to Llama 3.3 70B | The enclave was verified at launch with the saved key (any key passes the check and the model list); the message ended with *API authentication was rejected. Check your Tinfoil API key and API access.* |
| Silent uninstall | Program folder, uninstall entry and shortcut removed; the workspace in `%APPDATA%\Tinfoil Workbench` kept, as the README now says |
| Portable executable `--smoke-test` | Exit 0, but its launcher does not pass on the app's output, so the smoke result could not be read |
| The published 0.11.0 installer, a draft typed in it through the debugging port, then `Setup.exe` of 1.0.0 over it | The draft written by 0.11.0 opened in 1.0.0 and after another restart |

A failed reply also shows *No answer text was returned.* above the error, which repeats it less clearly.

## Upgrades from 0.11.0 on Android

On the Android 16 emulator, the published 0.11.0 APK (its SHA-256 matches the release) was installed and given an invented API key (*Enclave verified* after *Save & verify*), the model `llama3-3-70b` and a draft typed through the on-screen keyboard; 0.11.0 kept the draft across a force-stop. `adb install -r` then installed the release-signed 1.0.0 APK (versionCode 1000000). The draft opened, the model was kept (shown by its catalog name, Llama 3.3 70B), and the enclave was verified at launch with the key that 0.11.0 had sealed with the Keystore; all three held after another force-stop. A message then ended with *API authentication was rejected. Check your Tinfoil API key and API access.*

## What changed and how it was checked

- **Dependencies (#27).** Electron 44.4.5 backports fixes from Chromium, V8, ANGLE, Dawn and PDFium. TypeScript 7 emits the same 43 JavaScript files as 5.8.3 for this source, byte for byte, and still fails the build on a type error; the browser preview is converted with esbuild, since TypeScript 7 no longer has a JavaScript API, and the suites follow esbuild's output. The Actions majors ran in CI on both pull requests.
- **PDF.js 6.** The packaged smoke test, on the build machine and in Windows Sandbox, renders a PDF with the bundled PDF.js 6 in Electron 44.4.5. `pdfEngineSupported()` checks CSS `round()`, from Chromium 125; `tests/ui-artifacts.py` reports it as unsupported and expects the engine message, and fails with the check removed. No old WebView opened a PDF.
- **Package.** `app.asar` holds 28 modules instead of 31, without `pdfjs-dist` and `@napi-rs/canvas`; the x64 installer is 124.3 MB instead of 140.2 MB.

## Windows

| Check | Result |
|---|---|
| `npm test` (strict build + Node tests) | **457 passed**, 0 failed, 0 skipped |
| `npm run dist:win` | Passed its doctor (28/28), test and native smoke gates, built the x64 NSIS installer and portable executable (unsigned), then `PACKAGE_CHECK_OK` (28 packaged modules) |
| Packaged app `release\win-unpacked\Tinfoil Workbench.exe --smoke-test` | `DESKTOP_SMOKE_OK`, including the attested SDK import |
| Packaged app, live enclaves (`check-packaged-provider.mjs`) | `PACKAGED_PROVIDER_OK`: Electron 44.4.5, the inference enclave's five verification steps and 17 models, then the sync enclave's five verification steps |
| Silent upgrade over an installed 0.18.1 (`Setup.exe /S /currentuser`) | Exit 0. The installed executable and its uninstall entry report 1.0.0, and its `app.asar` is byte-identical to the build's. The installed app's `--smoke-test` printed `DESKTOP_SMOKE_OK`, and `check-packaged-provider.mjs` run by the installed executable printed `PACKAGED_PROVIDER_OK` with both enclaves. The existing app data (56 files) was unchanged by SHA-256. The same installation was then used for the checks with a real account |

The twelve production-renderer browser suites passed **468 checks** with no JavaScript errors and no requests leaving the page: ui-smoke 36, ui-artifacts 22, ui-inline 20, ui-seamless 17, ui-editing 21, ui-responsive 95, ui-spacing 112, ui-activity 32, ui-account 68, ui-handoff 25, ui-cloud 7, ui-charts 13. One more than 0.18.1: the PDF engine notice.

## Android

`tests/android-device.py` ran against the final APKs. Because other work was running on the machine, the emulators ran one at a time, each after a 150-second settle, the Android 14 one first.

| Device image | Android System WebView | `--debug --live` | `--release` |
|---|---|---|---|
| Android 16 (API 36), Pixel 7 profile | 133.0.6943.137 | **40/40** | **13/13** |
| Android 14 (API 34), Pixel 6 profile | 113.0.5672.136 | **36/36** | **13/13** on a rerun; 6/13 in the gate run |

- **The failed release run.** In the gate run the Android 14 release run passed its first six checks, then failed *the instructions picker opens from the composer control* and the six checks after it. The check before it closes the account view with one Back press, and Android 14 can drop the first Back after the app's force-stop restart; with the account view still open, the picker control cannot be reached. The same APK passed all 13 checks on a freshly booted, settled Android 14 emulator.
- **Upgrade in place (Android 16).** The published, signed 0.18.1 APK was installed, a starter chosen and a draft typed through the on-screen keyboard. `adb install -r` then installed the signed 1.0.0 APK, which reported versionName 1.0.0. The draft and the starter choice written by 0.18.1 opened, and both persisted across a force-stop.

## Not executed

- **A standard-user Windows account:** the Sandbox account is an administrator. The installer is per-user and needs no administrator rights, but a standard account was not used.
- **The portable executable's smoke result:** it exited 0, but its output could not be read.
- **Cloud chat conflicts with a real concurrent edit**, and edits of a real cloud chat other than the test conversation.
- **Other sign-in methods:** Apple, email-code, passkey, GitHub and Microsoft.
- **PDF preview on an Android WebView older than 125**, and other phones, tablets and foldables.
- **Display scaling, high contrast and input methods on Windows, and TalkBack on Android.**
- **Models other than Kimi K3, GLM-5.3 and GLM-5.3 Flash with the visual tools, and repeated samples.**
- Everything listed as not executed for [0.18.1](../v0.18.1/VALIDATION.md#not-executed) and not checked above remains open.

## Release artifacts

The release files were built from commit `969bea8`. The tag commit adds only this record, the archived 0.18.1 record and handoff checklist, documentation updates and refreshed screenshots and check records, none of which is packaged.

| File | Bytes | SHA-256 |
|---|---:|---|
| `Tinfoil-Workbench-1.0.0-x64-Setup.exe` | 124,310,446 | `deb062ccce041df05ad33760aed35748ecf262e50c39f37ad8259b7338251f6a` |
| `Tinfoil-Workbench-1.0.0-x64-Portable.exe` | 124,085,615 | `84df9ec10964a0e879e587eec636563e8ebc7476396f3c237cea6cd5ac46bfc3` |
| `Tinfoil-Workbench-1.0.0-android.apk` | 4,438,338 | `63573d4eeb5182660fa4ea491355898bacf927d5208d16894fbe93d0a06bbb00` |

The Windows files are not code-signed. The APK is signed with APK Signature Scheme v2, with the same release key as 0.18.1 (certificate SHA-256 `6395ead797a520c632156abcd9ee2731869c64ed0ee510ad5b52e887185494cb`), has versionName 1.0.0 and versionCode 1000000, targets SDK 36 with minimum SDK 24, and requests the same two permissions.

GitHub Actions ran all three workflows on commit `969bea8` in the pull request runs 36642459253 (Windows client), 36642459408 (Android client) and 36642459458 (renderer UI suites). The renderer UI suites passed. The Windows and Android workflows passed every build and test step and then failed to upload their build outputs, because the account's Actions artifact storage quota was used up by earlier runs.
