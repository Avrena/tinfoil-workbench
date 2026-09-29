# Tinfoil Workbench 0.17.0 — validation record

Recorded 29 September 2026 for the 0.17.0 release. It adds timeline and stat card visual tools, draws bar series that never share a label as whole centred bars, and keeps dashes in saved file names. The record lists what ran, what failed on the way, and what did not run. The previous record is in [history/v0.16.0](../v0.16.0/VALIDATION.md).

## Environment

- **Windows build machine:** Windows 11 Pro 10.0.26200 (x64).
- **Toolchains, emulators and dependencies:** unchanged from 0.16.0. The lockfile differs only in its version field. A clean `npm run bootstrap` followed by `npm run doctor` passed all 28 entries. `npm audit --omit=dev` reports no known vulnerabilities.

## What changed and how it was checked

- **Centred bars.** A bar chart with reported values in one series and a projection in another, made by a real model in 0.16.0, drew each bar at half width beside its label, next to an empty slot for the other series. Series now split a label's band only when two of them have a value there. `tests/charts.test.mjs` measures each bar's centre against its label and checks that overlapping series stay grouped and that hiding a series re-evaluates the rule; with the previous layout the test fails. `tests/ui-charts.py` checks the same in the renderer: four bars of equal width, each within 2px of its label's centre.
- **File names.** The same chart was saved as "…run rate 20232026 approx.svg", because every character other than letters, digits, spaces, `_` and `-` was deleted. `artifactFileName()` keeps dashes as hyphens and turns other punctuation into spaces; a test covers dashes, apostrophes, accents and CJK text, path separators, an empty result and the length limit.
- **Timeline and stat cards.** Tinfoil Chat's public configuration (`/api/config/system-prompt`, `genUI.enabledWidgets`) enables eleven `render_*` widgets. The two that show only model-supplied data, `render_timeline` and `render_stat_cards`, were added with the same names and argument shapes, plus optional fields (`tentative`; `delta`, `good`, `sparkline`). `tests/widgets.test.mjs` (7 tests) covers the schema, validation limits, number formatting, inert markup (only the renderer's own tags and attributes, with hostile text kept as text), the change cues and the runtime including revisions. `tests/ui-charts.py` adds a timeline check (order, the tentative tag, escaped text, Data view, no script control) and a stat card check (values, arrow colours only for a judged change, screen-reader words, one-row layout at 1440px, Data view). The widgets were first drawn indented and with a 17px sparkline, because the reply's list, paragraph and global `svg` rules outranked them; their styles are now scoped to the widget canvas, and screenshots were checked after the change.
- **Tool guide.** It now names the two tools and when to choose them: 1,409 characters with the visual tools (was 1,313) and 1,712 with Python as well (was 1,616); Python alone is unchanged at 390. It stays fixed text, so the provider's prefix cache still covers it.
- **Suite fix.** With six figures in the chart suite, a figure mounting below the line chart moved the page under the pointer and hid the crosshair before it was measured. The suite now mounts every figure before the hover checks.

## Windows

| Check | Result |
|---|---|
| `npm test` (strict build + Node tests) | **441 passed**, 0 failed, 0 skipped: the 432 tests of 0.16.0 and 9 new ones |
| `npm run dist:win` | Passed its doctor (28/28), test and native smoke gates, built the x64 NSIS installer and portable executable (unsigned), then `PACKAGE_CHECK_OK` (31 packaged modules) |
| Packaged app `release\win-unpacked\Tinfoil Workbench.exe --smoke-test` | `DESKTOP_SMOKE_OK`, including the attested SDK import; file version 0.17.0 |
| Packaged app, live enclaves (`check-packaged-provider.mjs`) | `PACKAGED_PROVIDER_OK`: the inference enclave's five verification steps and 17 models, then the sync enclave's five verification steps |
| Silent upgrade over an installed 0.16.0 (`Setup.exe /S /currentuser`) | Exit 0. The installed executable and its uninstall entry report 0.17.0, and its `app.asar` is byte-identical to the build's. The installed app's `--smoke-test` printed `DESKTOP_SMOKE_OK`, and `check-packaged-provider.mjs` run by the installed executable against its own `app.asar` printed `PACKAGED_PROVIDER_OK` with both enclaves. The existing app data (56 files, including a saved sign-in) was unchanged by SHA-256, and the Start menu and desktop shortcuts still point to the installed app. |

The twelve production-renderer browser suites passed **463 checks** with no JavaScript errors and no requests leaving the page:

| Suite | 0.16.0 | 0.17.0 |
| --- | ---: | ---: |
| ui-smoke.py | 36 | 36 |
| ui-artifacts.py | 21 | 21 |
| ui-inline.py | 20 | 20 |
| ui-seamless.py | 17 | 17 |
| ui-editing.py | 21 | 21 |
| ui-responsive.py | 93 | 93 |
| ui-spacing.py | 112 | 112 |
| ui-activity.py | 32 | 32 |
| ui-account.py | 68 | 68 |
| ui-handoff.py | 25 | 25 |
| ui-cloud.py | 6 | 6 |
| ui-charts.py | 9 | 12 |

## Android

The Android app shares the renderer and the service, so it gets the new tools and the fixes too. `tests/android-device.py` ran against the final APKs.

| Device image | Android System WebView | `--debug --live` | `--release` |
|---|---|---|---|
| Android 16 (API 36), Pixel 7 profile | 133.0.6943.137 | **40/40** | **13/13** |
| Android 14 (API 34), Pixel 6 profile | 113.0.5672.136 | **36/36** on a rerun (the first run failed 4 checks and stopped after 28; see below) | **13/13** |

- **Android 14 rerun.** The first debug run on Android 14 started right after the release run on the same emulator. Its three Back checks failed right after the force-stop restart, the pattern recorded for this image when the first Back press after that restart is dropped; the instructions check that follows then found the page in the wrong state, and the run stopped. The same APK passed 36/36 on a freshly booted emulator left to settle for 150 seconds. Neither area changed in this release.
- **Upgrade in place (Android 16).** The published, signed 0.16.0 APK (its SHA-256 matches the 0.16.0 release) was installed, a starter chosen and a draft typed through the on-screen keyboard. `adb install -r` then installed the signed 0.17.0 APK, which reported versionName 0.17.0. The draft and the starter choice written by 0.16.0 opened, and both persisted across a force-stop.
- **Phone.** Not used for this release.

## Not executed

- **Model behavior with the new tools:** no request with a real model ran for this release, so whether models choose a timeline or stat cards when they help is not measured. The centred-bar fix answers a chart a real model made with 0.16.0; the new checks use synthetic data.
- **Widgets made in Tinfoil Chat:** Tinfoil Chat's message format has fields for widget calls (`toolCalls`, `timeline`). Workbench shows only the message text of a synced chat; whether synced chats carry these calls, and showing them, was not checked.
- **The widgets on touch screens and with a screen reader:** the checks use Chromium with a mouse pointer and inspect the screen-reader text, without a screen reader.
- Everything listed as not executed for [0.16.0](../v0.16.0/VALIDATION.md#not-executed) remains open.

## Release artifacts

The release files were built from commit `0d2c7a1`. The tag commit adds only this record, the archived 0.16.0 record and handoff checklist, and refreshed screenshots and check records, none of which is packaged.

| File | Bytes | SHA-256 |
|---|---:|---|
| `Tinfoil-Workbench-0.17.0-x64-Setup.exe` | 140,184,357 | `71cba421b31f4d16d8a4b194dc5d3a6eb7b34a7dd64701a9ad9b1a9a4c5c3d3a` |
| `Tinfoil-Workbench-0.17.0-x64-Portable.exe` | 139,959,493 | `f94a6265b9d9a5ca6f9209db2f486339ea69f102e5bbb95d842406e16cac5a55` |
| `Tinfoil-Workbench-0.17.0-android.apk` | 4,299,718 | `291bb55dfe0b529c3eb04368f9211d9ed6f4812c46389ec69c5dbce29c94716b` |

The Windows files are not code-signed. The APK is signed with APK Signature Scheme v2, with the same release key as 0.16.0 (certificate SHA-256 `6395ead797a520c632156abcd9ee2731869c64ed0ee510ad5b52e887185494cb`), has versionName 0.17.0 and versionCode 17000, targets SDK 36 with minimum SDK 24, and requests the same two permissions.

GitHub Actions passed all three workflows on commit `0d2c7a1`, in the pull request runs 36570046669 (Windows client), 36570046455 (Android client) and 36570046887 (renderer UI suites).
