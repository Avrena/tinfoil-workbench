# Tinfoil Workbench 1.3.0 — validation record

Recorded 1 October 2026 for the 1.3.0 release. On Windows a conversation can let the model work in a folder (the workspace agent): it reads there without asking and runs commands and changes files after approval in a window of Workbench's own, at a level each conversation chooses. Files can be dropped or pasted, including pictures, PDFs and folders; Tinfoil cloud chats carry pictures both ways; Settings gains themes and a chat background; Python is found by itself. The record lists what ran, what failed on the way, and what did not run. The previous record is in [history/v1.2.0](../v1.2.0/VALIDATION.md).

## Environment

- **Windows build machine:** Windows 11 Pro 10.0.26200 (x64). Other work was running on the machine during the checks.
- **Toolchains, emulators and dependencies:** unchanged from 1.2.0. The lockfile differs only in its two version fields, so `npm run bootstrap` was not repeated, and the Android Gradle files are unchanged. `npm run doctor` passed all 32 entries as part of `npm run dist:win` (four more required files than 1.2.0: the approval window, its preload and page, and the Python finder). `npm audit --omit=dev` reports no known vulnerabilities in the runtime dependencies; the full audit reports the same moderate advisory as for 1.2.0 (`uuid` below 11.1.1, through `xcode` in `@capacitor/cli`, a development tool for iOS projects that is not packaged).

## With a real account

Performed with a real Tinfoil account on review builds of 1.3.0 and on the release build installed on Windows, and with the manual live checks of the workspace agent run from source with a temporary profile. Review builds are builds of this branch made before its last commits; each row names what the review found and what changed.

| Where | Check | Result |
|---|---|---|
| Windows, review builds | Asking the agent to read a file outside its folder | `read_file` refused it; the model then asked to run a command, which waited for approval and read the file once approved. Commands are not confined, as designed; the approval now lists the paths outside the folder that a command names (59b61a7) |
| | The tool calls of an agent reply | A row per batch stacked up above the answer; one row that rolls from call to call was built (5c2d930). Text of two calls drawn over each other during a roll was then reported and fixed (1978197) |
| | A real agent task that seemed stuck while the model thought | Thinking now shows how long it has run (c4e7701) |
| | A conversation's folder that had not been chosen for it | A reproduction made a new folder under the root as designed, and the cause was not established. It found a folder made for a send that could not start, fixed in f6057ae |
| | Approving in Workbench's own window instead of a Windows message box | Accepted; the other questions were then moved to the same window (766a711) |
| | Python found without pointing to it | The installed app showed the interpreter on PATH with its version, in Settings and then under Model-requested Python in Advanced |
| | A model reading the folder's name as something the user wrote | The environment now says where the folder came from (99ba8fe); see the greeting check below |
| | Drop and paste, themes, the chat background | Installed for review; no changes were asked before the release |
| Live agent check (`tests/agent-live.mjs`), at 59b61a7 and c4239c1 | Two tasks per model in a small Node project: explain it without changing anything, and make a failing test pass | Kimi K3, GLM-5.3 and DeepSeek V4.1 Flash passed both tasks with native calls only. DeepSeek V4.1 Flash first failed with "Unsupported streamed tool call." because it asked for more than four reads at once, fixed in c4239c1. About 91,000 input tokens in all. Details in [WORKSPACE-AGENT.md](../../WORKSPACE-AGENT.md) |
| Live agent check, greeting, at 2c85693 | A greeting in a folder Workbench made and named after it | Kimi K3 and DeepSeek V4.1 Flash answered with a greeting: no tool calls and no mention of the folder; 3,914 input and 108 output tokens |
| Windows, the installed release build | A cloud chat holding a picture sent in Tinfoil Chat | The picture was fetched from Tinfoil's attachment storage in Workbench |
| | A photo attached in Workbench to a cloud chat | Uploaded, and shown in that chat in Tinfoil Chat on the web |
| Phone, release-signed 1.3.0 installed over the release-signed 1.2.0 holding a saved sign-in | Opening the app after the update | Signed in, without Tinfoil's page |

## What changed and how it was checked

- **Workspace agent.** `src/core/agent.ts` (tools, argument and path checks, guide, environment, diffs, outside paths, command risk words) and `desktop/agent-tools.mjs` (paths resolved through links and junctions, unchanged-file writes, PowerShell and Git Bash runners, process-tree termination, new folders). `tests/agent.test.mjs` covers the tools, confinement (including links and junctions), refused folders, writes after the file changed, both shells, output limits, timeouts and Stop, approval levels and the words that still ask, the folder origin line, attached folders, the service's limits, and its refusal to move a conversation that used the agent into a cloud project. The desktop smoke test runs one PowerShell command through the runner. `tests/ui-activity.py` covers the agent's cards, the plan, the rolling row, approvals in view and the thinking timer.
- **Approval and confirmation windows.** `tests/agent.test.mjs` covers the requests the main process builds for them, and `tests/ui-activity.py` the approval page with a stand-in for its bridge; the desktop smoke test opens a real approval window from the source tree, the packaged app and the installed app: the command is shown, an outside path is marked, Decline has the focus and closing declines.
- **Streaming.** `tests/ui-activity.py` checks that a burst appears in steps, whole words at a time, and catches up within 0.7 s, and that reduced motion shows it at once; `tests/render-cost.py` passed with the template and Markdown counters at their baseline.
- **Python.** `tests/python-find.test.mjs` covers registrations, PATH, install folders, versions from the version resource or the DLL, Store aliases, removed registrations and the order; one test runs only outside Windows and was skipped.
- **Files.** `tests/attachments.test.mjs` covers kinds, validation of picture and folder references, image parts and the note for models that cannot read pictures, pruning, folders the main process refuses, attached-folder reads by the agent and the Android picker. The drop overlay, paste and the attachment chips have no committed browser check: they were checked with scratch scripts in the production renderer, and in the real app from source with a temporary profile by pasting a picture file and a folder copied in Explorer and a screenshot.
- **Pictures in Tinfoil cloud chats.** `tests/cloud.test.mjs` covers pictures read by their thumbnails (bad IDs and thumbnails left out, the stated type not trusted), their keys kept out of the turns, writing a new turn's pictures as Tinfoil Chat keeps them and never a folder, and picture types and sizes from their bytes. `tests/cloud-sync.test.mjs` runs the sync engine against an in-memory enclave with attachment storage: a web chat's pictures fetched once and a missing one forgotten, a new turn's pictures stored once before the chat is written and not fetched or stored again after a change elsewhere, a conversation moved to the cloud with its pictures, one with folders refused, and the client's wire format. `tests/attachments.test.mjs` checks that a cloud chat's pictures are fetched before it is continued and that their keys never reach snapshots.
- **Themes and background.** `tests/themes.test.mjs` covers the presets, token computation, contrast and text on the accent; `tests/ui-smoke.py` checks Appearance, a light theme and the background settings.
- **Package.** `app.asar` holds the same 28 modules as 1.2.0; the electron-builder configuration is unchanged apart from the version.

## Windows

| Check | Result |
|---|---|
| `npm test` (strict build + Node tests) | **561 passed**, 0 failed, 1 skipped (a check that runs only outside Windows) |
| `npm run dist:win` | Passed its doctor (32/32), test and native smoke gates, built the x64 NSIS installer and portable executable (unsigned), then `PACKAGE_CHECK_OK` (28 packaged modules) |
| Packaged app `release\win-unpacked\Tinfoil Workbench.exe --smoke-test` | `DESKTOP_SMOKE_OK`, including the attested SDK import, the workspace agent runner and the approval window |
| Packaged app, live enclaves (`check-packaged-provider.mjs`) | `PACKAGED_PROVIDER_OK`: Electron 44.4.5, the inference enclave's five verification steps and 17 models, then the sync enclave's five verification steps |
| Silent install (`Setup.exe /S /currentuser`) over an installed review build of 1.3.0, itself installed over 1.2.0 | Exit 0. The installed executable and its uninstall entry report 1.3.0, and its `app.asar` is byte-identical to the build's. The installed app's `--smoke-test` printed `DESKTOP_SMOKE_OK`, and `check-packaged-provider.mjs` run by the installed executable printed `PACKAGED_PROVIDER_OK` with both enclaves. The files at the top of the app data folder were unchanged by SHA-256 across the install and these checks, and the folder held 74 files before and after |

The twelve production-renderer browser suites passed **526 checks** with no JavaScript errors and no requests leaving the page: ui-smoke 42, ui-artifacts 24, ui-inline 20, ui-seamless 18, ui-editing 26, ui-responsive 107, ui-spacing 121, ui-activity 49, ui-account 68, ui-handoff 25, ui-cloud 13, ui-charts 13. Twenty-two more than 1.2.0, for the agent's activity, approvals, streaming, the thinking timer, files, themes and the background.

## Android

`tests/android-device.py` ran against the final APKs. Because other work was running on the machine, the emulators ran one at a time, each freshly booted and given a 150-second settle.

| Device image | Android System WebView | `--debug --live` | `--release` |
|---|---|---|---|
| Android 16 (API 36), Pixel 7 profile | 133.0.6943.137 | **41/41** | **13/13** (second run; see below) |
| Android 14 (API 34), Pixel 6 profile | 113.0.5672.136 | **36/36** | **13/13** |

- **The failed release check.** The first release run on Android 16 failed one check, a text file picked in the system picker becoming an attachment: the test looked for the Attach button by its 1.2.0 name, which 89151db changed. The test now matches the new name (738435c); the same APK then passed all 13 checks after a fresh boot, and Android 14 passed with the fixed test the first time.
- **Upgrade in place (Android 16), from 1.2.0.** The published, signed 1.2.0 APK (its SHA-256 matches the release) was installed and a draft typed through the on-screen keyboard; 1.2.0 kept it across a force-stop. `adb install -r` then installed the signed 1.3.0 APK, which reported versionName 1.3.0 and versionCode 1003000. The draft written by 1.2.0 opened and persisted across another force-stop.
- The release APK is signed with the release certificate (SHA-256 `63:95:EA:…:94:CB`).

## Not executed

- **A clean Windows:** not repeated, since the installer configuration is unchanged; see the [1.0.0 record](../v1.0.0/VALIDATION.md#a-clean-windows). A standard-user Windows account was not used, and the portable executable was not run.
- **A phone:** beyond keeping the sign-in across the update, nothing was checked on real Android hardware for this release. Picking a picture or a PDF with Attach on Android was not exercised on a device; the device test picks a text file.
- **The workspace agent** was checked with the three models above in a small project; long tasks, Git Bash with a real model, and the approval levels with a real model were not.
- **Pictures in Tinfoil cloud chats:** checked by hand in both directions (above). `tests/cloud-live.mjs`, which now also takes a generated picture through a test chat, was not run for this release. A model's answer about a fetched picture, a picture Tinfoil no longer has, and a Workbench copy of a chat whose pictures were never fetched were not checked with a real account.
- Everything listed as not executed for [1.2.0](../v1.2.0/VALIDATION.md#not-executed) and not checked above remains open.

## Release artifacts

The release files were built from commit `3dbaec1`. The tag commit adds two test fixes (`738435c`, `80f131b`), this record, the archived 1.2.0 record and handoff checklist, and documentation updates, none of which is packaged.

| File | Bytes | SHA-256 |
|---|---:|---|
| `Tinfoil-Workbench-1.3.0-x64-Setup.exe` | 124,382,666 | `9ee994bc2acd74b0dff1691f5e2bc450286589d5780eb81665390e415238b664` |
| `Tinfoil-Workbench-1.3.0-x64-Portable.exe` | 124,157,815 | `3760560273cd3bae0ad6fdfc00a4fcb9121be43ec77fba0ef35fadea6dfc8ece` |
| `Tinfoil-Workbench-1.3.0-android.apk` | 4,538,496 | `e05731dc938f6b5db059209efaa597d6e3982a3a8d3acdd21335bed0438f291a` |

The Windows files are not code-signed. The APK is signed with APK Signature Scheme v2, with the same release key as 1.2.0 (certificate SHA-256 `6395ead797a520c632156abcd9ee2731869c64ed0ee510ad5b52e887185494cb`), has versionName 1.3.0 and versionCode 1003000, targets SDK 36 with minimum SDK 24, and requests the same two permissions.

GitHub Actions ran all three workflows on the pull request. On commit `738435c` the Windows client run failed one Node test, the agent's new folder: the runner's Temp is an 8.3 short path, which the service expands and the test did not. The other two runs were cancelled by the next push. `80f131b` fixes the test; on it the runs 36798512733 (Windows client), 36798512717 (Android client) and 36798512743 (renderer UI suites) passed, and the Windows and Android runs kept their build copies.
