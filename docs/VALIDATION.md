# Tinfoil Workbench 0.17.1 — validation record

Recorded 29 September 2026 for the 0.17.1 release. It verifies the enclave and loads the model list by itself at launch, after a Chat sign-in and after a change of connection, and adds a Visual explainer starter. The record lists what ran, what failed on the way, and what did not run. The previous record is in [history/v0.17.0](history/v0.17.0/VALIDATION.md).

## Environment

- **Windows build machine:** Windows 11 Pro 10.0.26200 (x64).
- **Toolchains, emulators and dependencies:** unchanged from 0.17.0. The lockfile differs only in its version field. A clean `npm run bootstrap` followed by `npm run doctor` passed all 28 entries.

## What changed and how it was checked

- **Automatic enclave check.** In 0.17.0 the installed app, with a saved Chat sign-in, showed "Not connected" after launch until *Verify & refresh models* was chosen or a message sent. `WorkbenchService.autoConnect()` now runs the same connection check at launch for a saved API key, when the account becomes signed in, and after a change of connection mode, when the host enables it (the Windows app outside its smoke test, and the Android worker). Service tests cover the API-key case: nothing unless enabled, one check and the model list, no request without a key, and a failure recorded without throwing. An account test covers the Chat case: nothing while signed out and no use of a saved developer key, one key exchange shared by the sign-in and the check, and the API-key mode checked after a switch. Removing either trigger fails its test.
- **In the installed app with a real account.** After the silent upgrade below, the installed 0.17.1 was started with the saved Tinfoil Chat sign-in and left alone. About 25 seconds later its status bar read *Enclave verified*, and the model picker showed the catalog name of the conversation's model. Nothing was sent to a model.
- **Visual explainer starter.** A read-only starter (about 1,250 characters, some 300 tokens while selected) asks for a visual whenever it helps and names the tool for each job. A test checks that every tool it names is a real visual tool, that it names those a model chooses between, and that Concise stays the first starter. The browser suites that open the instructions picker passed with five starters.

## Windows

| Check | Result |
|---|---|
| `npm test` (strict build + Node tests) | **445 passed**, 0 failed, 0 skipped: the 441 tests of 0.17.0 and 4 new ones |
| `npm run dist:win` | Passed its doctor (28/28), test and native smoke gates, built the x64 NSIS installer and portable executable (unsigned), then `PACKAGE_CHECK_OK` (31 packaged modules) |
| Packaged app `release\win-unpacked\Tinfoil Workbench.exe --smoke-test` | `DESKTOP_SMOKE_OK`, including the attested SDK import; file version 0.17.1 |
| Packaged app, live enclaves (`check-packaged-provider.mjs`) | `PACKAGED_PROVIDER_OK`: the inference enclave's five verification steps and 17 models, then the sync enclave's five verification steps |
| Silent upgrade over an installed 0.17.0 (`Setup.exe /S /currentuser`) | Exit 0. The installed executable and its uninstall entry report 0.17.1, and its `app.asar` is byte-identical to the build's. The installed app's `--smoke-test` printed `DESKTOP_SMOKE_OK`, and `check-packaged-provider.mjs` run by the installed executable against its own `app.asar` printed `PACKAGED_PROVIDER_OK` with both enclaves. The existing app data (56 files, including a saved sign-in) was unchanged by SHA-256. |

The twelve production-renderer browser suites passed **463 checks** with no JavaScript errors and no requests leaving the page, the same counts as 0.17.0: ui-smoke 36, ui-artifacts 21, ui-inline 20, ui-seamless 17, ui-editing 21, ui-responsive 93, ui-spacing 112, ui-activity 32, ui-account 68, ui-handoff 25, ui-cloud 6, ui-charts 12.

## Android

The Android app shares the renderer and the service, so it gets the automatic check and the starter too. `tests/android-device.py` ran against the final APKs, this time with the Android 14 debug run first on each emulator after a 150-second settle.

| Device image | Android System WebView | `--debug --live` | `--release` |
|---|---|---|---|
| Android 16 (API 36), Pixel 7 profile | 133.0.6943.137 | **40/40** | **13/13** |
| Android 14 (API 34), Pixel 6 profile | 113.0.5672.136 | **36/36** | **13/13** |

- **Upgrade in place (Android 16).** The published, signed 0.17.0 APK (its SHA-256 matches the 0.17.0 release) was installed, a starter chosen and a draft typed through the on-screen keyboard. `adb install -r` then installed the signed 0.17.1 APK, which reported versionName 0.17.1. The draft and the starter choice written by 0.17.0 opened, and both persisted across a force-stop.
- **Phone.** Not used for this release.

## Not executed

- **Model behavior with the starter:** no request with a real model ran for this release, so how closely models follow the Visual explainer starter is not measured.
- **The automatic check on Android with a real account, and with a real API key on either platform:** the Android device checks use a placeholder key, and the Windows check above used a Chat sign-in.
- **An automatic check that fails at launch in the installed app** (for example offline): covered by a service test only.
- Everything listed as not executed for [0.17.0](history/v0.17.0/VALIDATION.md#not-executed) remains open.

## Release artifacts

The release files were built from commit `1792e49`. The tag commit adds only this record, the archived 0.17.0 record and handoff checklist, and refreshed screenshots and check records, none of which is packaged.

| File | Bytes | SHA-256 |
|---|---:|---|
| `Tinfoil-Workbench-0.17.1-x64-Setup.exe` | 140,185,074 | `cd3b22c590543a5c5bbf19fb9a1df9413de0f2fb2b254b31ea7edf46ec156179` |
| `Tinfoil-Workbench-0.17.1-x64-Portable.exe` | 139,960,220 | `7b0776e5cac19cf719795e4110fad2e972030db37688fa7b5d82100ef12b6947` |
| `Tinfoil-Workbench-0.17.1-android.apk` | 4,301,034 | `17e2f41bbc11f56b542fa9aa0c9b4876e6df074aa1b0c6abac396c645aa8018a` |

The Windows files are not code-signed. The APK is signed with APK Signature Scheme v2, with the same release key as 0.17.0 (certificate SHA-256 `6395ead797a520c632156abcd9ee2731869c64ed0ee510ad5b52e887185494cb`), has versionName 0.17.1 and versionCode 17001, targets SDK 36 with minimum SDK 24, and requests the same two permissions.

GitHub Actions passed all three workflows on commit `1792e49`, in the pull request runs 36575573479 (Windows client), 36575573583 (Android client) and 36575573339 (renderer UI suites).
