# Tinfoil Workbench 1.1.0 — validation record

Recorded 30 September 2026 for the 1.1.0 release. It fixes the two failures found with a real account for 1.0.0: an Android reply cut off because the app left the screen now says so instead of blaming the network, and a chart, table, diagram, timeline or stat-card call that a model writes into its answer as text is drawn in place. It also brings the sidebar closer to Tinfoil Chat's (Sync, Cloud and Local lists, hover actions), shows thinking effort as a gauge with a slider, centres the title search, quiets the status bar, removes the Advanced Model field and says in the app that Workbench is unofficial. The record lists what ran, what failed on the way, and what did not run. The previous record is in [history/v1.0.0](../v1.0.0/VALIDATION.md).

## Environment

- **Windows build machine:** Windows 11 Pro 10.0.26200 (x64). Other work was running on the machine during the checks.
- **Toolchains, emulators and dependencies:** unchanged from 1.0.0; the lockfile differs only in its two version fields, so `npm run bootstrap` was not repeated. `npm run doctor` passed all 28 entries as part of `npm run dist:win`. `npm audit --omit=dev` reports no known vulnerabilities in the runtime dependencies; the full audit reports the same moderate advisory as for 1.0.0 (`uuid` below 11, through `xcode` in `@capacitor/cli`, a development tool for iOS projects that is not packaged).
- **Phone:** Android 15, Android System WebView 153, 360 CSS pixels wide, with the release-signed 1.1.0 APK installed over a review build of 1.1.0.

## With a real account

Performed with a real Tinfoil account on review builds of 1.1.0 and on the release builds. Review builds are builds of this branch made before its last commits.

| Where | Check | Result |
|---|---|---|
| Windows, review builds installed over 1.0.0 | The title bar: centred search, no *Ready* or *Encrypted on this device* | Accepted |
| | The sidebar with Tinfoil cloud chats connected: Sync on the Threads heading, the Cloud and Local lists, Delete and Move to Tinfoil cloud on hover | Accepted |
| | Thinking effort from the composer | Worked; the list of levels became a slider after this review |
| | The Reasoning disclosure | Its label sat higher than its arrow; the arrows are now drawn and centred |
| Windows, installed 1.1.0 (the release build) | The chart question that GLM-5.3 Flash answered with a call written as text in 1.0.0, asked again with GLM-5.3 Flash | A chart was drawn. Whether the model made the call or wrote it as text was not recorded |
| Phone, a review build | The sidebar | The hover Delete button covered thread titles; the row actions are now hidden after a touch and on Android |
| Phone, release-signed 1.1.0 | A message, then the home screen while the reply was being written, then back | The reply had finished; its text was shown on return |

- **The interruption message.** Android did not cut this reply off, so the new message did not appear on the phone. The service tests cover it: a stream failure after the host reported a pause is named as an interruption, the same failure without a pause is still a network failure, and a Stop the user chose or an HTTP error keeps its own message.

## What changed and how it was checked

- **Interrupted Android replies.** The bridge posts the app's pause to the host worker with its time; the service asks the host whether it was paused since the request began (`backgroundedSince`). `tests/service.test.mjs` covers the cases above.
- **Visual calls written as text.** `findTextToolCalls()` in `src/core/tools.ts` finds `render_*` calls with JSON arguments in a finished answer, only for the visual tools that were offered; the service draws them in place, records paired tool messages for later turns, and marks them as written as text. Python and artifacts never run from text. `tests/text-tool-calls.test.mjs` covers nested and quoted braces and fenced calls, text that is not one named call with a JSON object, a chart drawn in place and recorded as a real call, and an invalid chart, visual tools turned off and a Python call, which all stay text. With a real account, GLM-5.3 Flash's chart question from 1.0.0 now produces a chart (see above).
- **Sidebar.** `tests/cloud-sync.test.mjs` covers a thread started from the Cloud list, which becomes a cloud chat after its first reply and not before, and never when moved into a local project; `tests/ui-cloud.py` covers Sync, the Cloud and Local lists, the remembered view, the hover actions, and that they stay hidden after a touch.
- **Composer and title bar.** `tests/ui-artifacts.py` drives the effort gauge, its slider, the stops and Escape; `tests/ui-handoff.py` chooses the model from the composer and checks that Advanced has no Model field; `tests/ui-smoke.py` covers the centred search and the idle status bar.
- **Package.** `app.asar` holds the same 28 modules as 1.0.0; the electron-builder configuration is unchanged apart from the version.

## Windows

| Check | Result |
|---|---|
| `npm test` (strict build + Node tests) | **465 passed**, 0 failed, 0 skipped |
| `npm run dist:win` | Passed its doctor (28/28), test and native smoke gates, built the x64 NSIS installer and portable executable (unsigned), then `PACKAGE_CHECK_OK` (28 packaged modules) |
| Packaged app `release\win-unpacked\Tinfoil Workbench.exe --smoke-test` | `DESKTOP_SMOKE_OK`, including the attested SDK import |
| Packaged app, live enclaves (`check-packaged-provider.mjs`) | `PACKAGED_PROVIDER_OK`: Electron 44.4.5, the inference enclave's five verification steps and 17 models, then the sync enclave's five verification steps |
| Silent install (`Setup.exe /S /currentuser`) over an installed review build of 1.1.0, itself installed over 1.0.0 | Exit 0. The installed executable and its uninstall entry report 1.1.0, and its `app.asar` is byte-identical to the build's. The installed app's `--smoke-test` printed `DESKTOP_SMOKE_OK`, and `check-packaged-provider.mjs` run by the installed executable printed `PACKAGED_PROVIDER_OK` with both enclaves. The files at the top of the app data folder, the encrypted workspace among them, were unchanged by SHA-256 |

The twelve production-renderer browser suites passed **476 checks** with no JavaScript errors and no requests leaving the page: ui-smoke 37, ui-artifacts 23, ui-inline 20, ui-seamless 18, ui-editing 21, ui-responsive 95, ui-spacing 112, ui-activity 32, ui-account 68, ui-handoff 25, ui-cloud 12, ui-charts 13. Eight more than 1.0.0: the effort slider, the title search and status bar, an error without the no-text note, and five sidebar checks.

## Android

`tests/android-device.py` ran against the final APKs. Because other work was running on the machine, the emulators ran one at a time, each freshly booted and given a 150-second settle, the Android 14 one first.

| Device image | Android System WebView | `--debug --live` | `--release` |
|---|---|---|---|
| Android 16 (API 36), Pixel 7 profile | 133.0.6943.137 | **40/40** | **13/13** |
| Android 14 (API 34), Pixel 6 profile | 113.0.5672.136 | **36/36** on a rerun; the gate run failed 4 and stopped | **13/13** |

- **The failed debug run.** In the gate run on Android 14 the three Back checks after the force-stop restart failed in the pattern of a dropped first Back, [as seen for 1.0.0](../v1.0.0/VALIDATION.md#android): each later Back closed the layer that the check before it had left open. The next check, the instructions picker opened by a tap, failed as well, for a reason that was not established, and the run stopped at the check after it, which needs the open picker. The same APK passed all 36 checks after the next cold boot, with the same settle. The Back handling in `mobile/bridge.mjs` is unchanged from 1.0.0.
- **Upgrade in place (Android 16), from 1.0.0.** The published, signed 1.0.0 APK (its SHA-256 matches the release) was installed and a draft typed through the on-screen keyboard; 1.0.0 kept it across a force-stop. `adb install -r` then installed the signed 1.1.0 APK, which reported versionName 1.1.0 and versionCode 1001000. The draft written by 1.0.0 opened and persisted across another force-stop.

## Not executed

- **A clean Windows:** not repeated, since the installer configuration is unchanged; see the [1.0.0 record](../v1.0.0/VALIDATION.md#a-clean-windows). A standard-user Windows account was not used.
- **The portable executable:** built but not started.
- **A call written as text by a real model, seen drawn:** the GLM-5.3 Flash chart was drawn, but whether it came from text was not recorded.
- **The interruption message on a device**, since Android did not cut the reply off.
- **The final sidebar on the phone**, after the row actions were hidden on touch screens; the browser suites check it with touch input.
- Everything listed as not executed for [1.0.0](../v1.0.0/VALIDATION.md#not-executed) and not checked above remains open.

## Release artifacts

The release files were built from commit `6a26cd0`. The tag commit adds only this record, the archived 1.0.0 record and handoff checklist, documentation updates and refreshed screenshots and check records, none of which is packaged.

| File | Bytes | SHA-256 |
|---|---:|---|
| `Tinfoil-Workbench-1.1.0-x64-Setup.exe` | 124,314,813 | `a4f71e9bcb858b73980a8a9a66184f58f100281ea2dd60ac80c4fc81cc244fe7` |
| `Tinfoil-Workbench-1.1.0-x64-Portable.exe` | 124,090,053 | `2d687d2685659e8194762a75d09cc69a51006b0270b2a421750922edcd240f72` |
| `Tinfoil-Workbench-1.1.0-android.apk` | 4,443,870 | `29447220e69b3aa991e45112f14ac0132cca4981b634048f08ffcee32b202eea` |

The Windows files are not code-signed. The APK is signed with APK Signature Scheme v2, with the same release key as 1.0.0 (certificate SHA-256 `6395ead797a520c632156abcd9ee2731869c64ed0ee510ad5b52e887185494cb`), has versionName 1.1.0 and versionCode 1001000, targets SDK 36 with minimum SDK 24, and requests the same two permissions.

GitHub Actions ran all three workflows on commit `6a26cd0` in the pull request runs 36654637301 (Windows client), 36654637345 (Android client) and 36654637383 (renderer UI suites); all three passed. The Windows and Android runs could not keep their build copies: the repository's artifact storage quota was full, and the upload step is allowed to fail, so GitHub reported it as passed. This sentence was corrected after the 1.2.0 release; it said the uploads had passed.
