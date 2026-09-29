# Tinfoil Workbench 0.18.1 — validation record

Recorded 29 September 2026 for the 0.18.1 release. It fixes two phone layouts found on a 360px-wide Android phone: the model name in the composer, which 0.18.0 cut to "G…", and the rows of *Choose model*, which overlapped. It also records the two questions Kimi K3 had not been asked again since 0.17.1, asked with 0.18.0 on the same phone. The record lists what ran, what failed on the way, and what did not run. The previous record is in [history/v0.18.0](../v0.18.0/VALIDATION.md).

## Environment

- **Windows build machine:** Windows 11 Pro 10.0.26200 (x64).
- **Toolchains, emulators and dependencies:** unchanged from 0.18.0. The lockfile differs only in its version fields. A clean `npm run bootstrap` followed by `npm run doctor` passed all 28 entries.
- **Phone:** an Android 15 phone, a 1080px screen at density 480, so 360 CSS pixels wide. It ran the published 0.18.0 APK, then 0.18.1 builds installed over it, signed in to a real Tinfoil Chat account. After each in-place update the app was signed out, as after any restart, and sign-in was completed again.

## Model test on a phone

Kimi K3 through the Chat account on 0.18.0, with the Visual explainer starter, the visual tools on, Python off, default reasoning and the new 32,768-token limit. Each question was asked once in a new conversation. The token counts are the app's own.

| Question | Result | Input / output tokens |
|---|---|---:|
| A short history of the Apollo program | A one-sentence lead-in, `render_timeline` from 1961 to 1975 in order, then a closing summary | 6,396 / 1,131 |
| The capital of Japan | "Tokyo", with two sentences of context, no visual | 2,588 / 107 |

With the 0.17.2 test build's answers to the other two questions (a chart for the revenue question, one diagram for the web request; see [the 0.17.2 record](../v0.17.2/VALIDATION.md#model-test-on-a-phone)), Kimi K3 has answered all four as intended with the current guidance, once each. The guidance and the starter have not changed since 0.17.2.

## The fixes on the phone

- **0.18.0's diagram fix on real data.** GLM-5.3's request-flow diagram from the 0.18.0 test, opened in 0.18.0, drew the two edges between the browser and the DNS resolver apart, each labelled beside its own curve.
- **Composer.** With GLM-5.3 and its thinking-effort picker, 0.18.0 kept Send on the row but showed the model as "G…". A build with the chevron removed showed "GLM-…"; with the tighter spacing and smaller maker mark it showed "GLM-5.3" in full, with the effort picker, the instructions control and Send on one row.
- **Choose model.** With seven chat models, more than fit in the dialog, the rows' lines overlapped. With the fix every row showed its name, two-line description, maker and id, and capabilities with nothing overlapping.
- The last build installed on the phone is the released 0.18.1 APK: the gate's release build found its inputs unchanged and kept that file, with the SHA-256 listed below.

## What changed and how it was checked

- **Composer.** Up to 600px wide the model button hides its chevron (it still opens the picker), uses a 4px gap and an 18px maker mark, and the composer's controls are 2px apart. The check in `tests/ui-responsive.py` now runs at 360 and 393px with an effort picker. It requires Send on the model's row at the right and at least 50px for the name (57px at 360px in the test browser), and fails at 360px with the 0.18.0 rules.
- **Choose model.** On touch screens every button gets `min-height: 44px`, which replaces the automatic content minimum, so the picker's scrolling flex column squeezed its rows instead of scrolling. The rows no longer shrink (`flex: none`). A new `tests/ui-responsive.py` check opens the picker at 360 × 560, where the preview's list scrolls, and requires every row to keep its content height; it fails without the fix.

## Windows

| Check | Result |
|---|---|
| `npm test` (strict build + Node tests) | **457 passed**, 0 failed, 0 skipped, as in 0.18.0; both fixes are CSS and are checked by the browser suites |
| `npm run dist:win` | Passed its doctor (28/28), test and native smoke gates, built the x64 NSIS installer and portable executable (unsigned), then `PACKAGE_CHECK_OK` (31 packaged modules) |
| Packaged app `release\win-unpacked\Tinfoil Workbench.exe --smoke-test` | `DESKTOP_SMOKE_OK`, including the attested SDK import |
| Packaged app, live enclaves (`check-packaged-provider.mjs`) | `PACKAGED_PROVIDER_OK`: the inference enclave's five verification steps and 17 models, then the sync enclave's five verification steps |
| Silent upgrade over an installed 0.18.0 (`Setup.exe /S /currentuser`) | Exit 0. The installed executable and its uninstall entry report 0.18.1, and its `app.asar` is byte-identical to the build's. The installed app's `--smoke-test` printed `DESKTOP_SMOKE_OK`, and `check-packaged-provider.mjs` run by the installed executable against its own `app.asar` printed `PACKAGED_PROVIDER_OK` with both enclaves. The existing app data (56 files) was unchanged by SHA-256. The app was not started afterwards |

The twelve production-renderer browser suites passed **467 checks** with no JavaScript errors and no requests leaving the page: ui-smoke 36, ui-artifacts 21, ui-inline 20, ui-seamless 17, ui-editing 21, ui-responsive 95, ui-spacing 112, ui-activity 32, ui-account 68, ui-handoff 25, ui-cloud 7, ui-charts 13. One more than 0.18.0: the model picker check; the composer check was extended to 360px.

## Android

`tests/android-device.py` ran against the final APKs, with the Android 14 debug run first on each emulator after a 150-second settle.

| Device image | Android System WebView | `--debug --live` | `--release` |
|---|---|---|---|
| Android 16 (API 36), Pixel 7 profile | 133.0.6943.137 | **40/40** | **13/13** |
| Android 14 (API 34), Pixel 6 profile | 113.0.5672.136 | **36/36** | **13/13** |

- **Upgrade in place (Android 16).** The published, signed 0.18.0 APK (its SHA-256 matches the 0.18.0 release) was installed, a starter chosen and a draft typed through the on-screen keyboard. `adb install -r` then installed the signed 0.18.1 APK, which reported versionName 0.18.1. The draft and the starter choice written by 0.18.0 opened, and both persisted across a force-stop.

## Not executed

- **Other phones, font scales and system fonts:** the composer and the picker were seen on one phone at 360 CSS pixels and in the test browser at 360 and 393px.
- **The model test on 0.18.1:** Kimi K3's two questions ran on 0.18.0; 0.18.1 changes only phone layout rules.
- Everything listed as not executed for [0.18.0](../v0.18.0/VALIDATION.md#not-executed) and not checked above remains open.

## Release artifacts

The release files were built from commit `46a8bdf`. The tag commit adds only this record, the archived 0.18.0 record and handoff checklist, a correction to the 0.18.1 changelog entry, a sentence order and version range in the handoff checklist, and refreshed screenshots and check records, none of which is packaged.

| File | Bytes | SHA-256 |
|---|---:|---|
| `Tinfoil-Workbench-0.18.1-x64-Setup.exe` | 140,188,766 | `2ddea71c7f3218b6f84d6e6877815bd7083497e535216a39aed802679ff24d32` |
| `Tinfoil-Workbench-0.18.1-x64-Portable.exe` | 139,963,909 | `1edc9bc91b704b2893779cb61a2d9932dbc326b6ed7f4f6f73738713ec722163` |
| `Tinfoil-Workbench-0.18.1-android.apk` | 4,306,874 | `b8877dee385aa50359b15f6835fa717ee4bc59366e882e710ad65baa9b684576` |

The Windows files are not code-signed. The APK is signed with APK Signature Scheme v2, with the same release key as 0.18.0 (certificate SHA-256 `6395ead797a520c632156abcd9ee2731869c64ed0ee510ad5b52e887185494cb`), has versionName 0.18.1 and versionCode 18001, targets SDK 36 with minimum SDK 24, and requests the same two permissions.

GitHub Actions passed all three workflows on commit `46a8bdf`, in the pull request runs 36614267446 (Windows client), 36614267439 (Android client) and 36614267721 (renderer UI suites).
