# Tinfoil Workbench 0.17.2 — validation record

Recorded 29 September 2026 for the 0.17.2 release. It tells the model that a visual appears where its tool is called, keeps wide diagrams readable on phones and redraws diagram edges, after a test of the visual tools with a real model on an Android phone. The record lists what ran, what failed on the way, and what did not run. The previous record is in [history/v0.17.1](../v0.17.1/VALIDATION.md).

## Environment

- **Windows build machine:** Windows 11 Pro 10.0.26200 (x64).
- **Toolchains, emulators and dependencies:** unchanged from 0.17.1. The lockfile differs only in its version field. A clean `npm run bootstrap` followed by `npm run doctor` passed all 28 entries.
- **Phone:** an Android 15 phone, signed in to a real Tinfoil Chat account.

## Model test on a phone

Kimi K3 through the Chat account, with the Visual explainer starter, the visual tools on, Python off and default generation settings. Each question was asked once in a new conversation and none of them asks for a visual.

| Question | 0.17.1 (signed release APK) | 0.17.2 test build |
|---|---|---|
| How a company's revenue has grown since 2021, and the outlook for 2026 | **Failed.** No tool call. The reasoning planned two charts; the answer contained `<div id="…"></div>` placeholders, notes "on the chart" and a Markdown table | `render_chart`: bars for reported values and a projection, then the takeaway |
| A short history of the Apollo program | `render_timeline` after its lead-in | Not asked again |
| How a web request reaches a database | **Partly failed.** `render_diagram`, then the same flow again as a Mermaid block shown as code. The diagram, four columns wide, was scaled to the screen with labels a few pixels high | `render_diagram` only |
| The capital of Japan | "Tokyo.", no visual | Not asked again |

- **Cause of the failures.** The starter asked the model to put a visual next to the text it supports, and nothing said how placement works, so the model wrote placeholders where it wanted the charts. The `<visuals>` guide now says that a visual appears where its tool is called and only there, and rules out HTML, placeholders, Mermaid or ASCII drawings in place of a visual and repeating one as a table or code block. The starter says the same and not to mention a visual that was not created. `tests/prompt.test.mjs` and `tests/instructions.test.mjs` check the wording. The guide is 1,694 characters with the visual tools and 1,997 with Python.
- **The test build** had this guidance and the phone-width fix below. Its diagram showed further defects of the renderer: the two edges between the browser and the DNS resolver were drawn on top of each other, the arrowheads of edges pointing up or along a row ended under their target box, and grid columns the model left empty became blank space.
- **The final build** redraws those edges (below). Installed over the test build with `adb install -r`, it showed the same saved conversation's diagram with the two edges apart, every arrowhead on the edge of its box and every label readable, scrolling sideways. No request was sent with the final build; its guidance and starter text are those of the test build.
- **Automatic enclave check with a real account on Android.** With the signed 0.17.1 APK and again with the test build, the status read *Enclave verified* after the sign-in without *Verify & refresh models* being chosen. These are also the first Chat sign-ins in release-signed Android builds. After each in-place update the app was signed out, as after any restart.

## What changed and how it was checked

- **Placement guidance:** above.
- **Diagrams on phones.** The inline preview scaled a diagram to the screen with a 420px minimum. It now keeps at least 80% of the drawn width and scrolls sideways inside the figure. `tests/ui-charts.py` checks this at 390px.
- **Diagram edges.** `diagramSVG()` removes empty grid columns and rows, starts and ends every edge on the facing sides of its boxes, runs edges in both directions between two boxes side by side with their labels apart, and draws labels after the boxes with a surface-coloured halo, same-row labels above the row. `tests/diagrams.test.mjs` covers the compaction, the edges in both directions and that no arrow starts or ends inside a box; all three tests fail with the previous renderer. A diagram built like the model's was also checked by eye at desktop and phone widths in the production renderer.

## Windows

| Check | Result |
|---|---|
| `npm test` (strict build + Node tests) | **449 passed**, 0 failed, 0 skipped: the 445 tests of 0.17.1 and 4 new ones |
| `npm run dist:win` | Passed its doctor (28/28), test and native smoke gates, built the x64 NSIS installer and portable executable (unsigned), then `PACKAGE_CHECK_OK` (31 packaged modules) |
| Packaged app `release\win-unpacked\Tinfoil Workbench.exe --smoke-test` | `DESKTOP_SMOKE_OK`, including the attested SDK import; file version 0.17.2 |
| Packaged app, live enclaves (`check-packaged-provider.mjs`) | `PACKAGED_PROVIDER_OK`: the inference enclave's five verification steps and 17 models, then the sync enclave's five verification steps |
| Silent upgrade over an installed 0.17.1 (`Setup.exe /S /currentuser`) | The running app was closed first. Exit 0. The installed executable and its uninstall entry report 0.17.2, and its `app.asar` is byte-identical to the build's. The installed app's `--smoke-test` printed `DESKTOP_SMOKE_OK`, and `check-packaged-provider.mjs` run by the installed executable against its own `app.asar` printed `PACKAGED_PROVIDER_OK` with both enclaves. The existing app data (56 files, including a saved sign-in) was unchanged by SHA-256. Started afterwards and left alone, the installed app read *Enclave verified* within 25 seconds with the restored Chat sign-in |

The twelve production-renderer browser suites passed **464 checks** with no JavaScript errors and no requests leaving the page: ui-smoke 36, ui-artifacts 21, ui-inline 20, ui-seamless 17, ui-editing 21, ui-responsive 93, ui-spacing 112, ui-activity 32, ui-account 68, ui-handoff 25, ui-cloud 6, ui-charts 13 (one more than 0.17.1: the phone-width diagram).

## Android

`tests/android-device.py` ran against the final APKs, with the Android 14 debug run first on each emulator after a 150-second settle.

| Device image | Android System WebView | `--debug --live` | `--release` |
|---|---|---|---|
| Android 16 (API 36), Pixel 7 profile | 133.0.6943.137 | **40/40** | **13/13** |
| Android 14 (API 34), Pixel 6 profile | 113.0.5672.136 | **36/36** | **13/13** |

- **Upgrade in place (Android 16).** The published, signed 0.17.1 APK (its SHA-256 matches the 0.17.1 release) was installed, a starter chosen and a draft typed through the on-screen keyboard. `adb install -r` then installed the signed 0.17.2 APK, which reported versionName 0.17.2. The draft and the starter choice written by 0.17.1 opened, and both persisted across a force-stop.
- **Phone:** the model test above; the final APK is the one released.

## Not executed

- **Other models, and repeated samples:** only Kimi K3 was asked, once per question. The two questions answered well in 0.17.1 were not asked again with the new guidance, and no model was asked with the final build.
- **The model test on Windows:** the guidance and renderer are shared, but no request with a real model ran in the Windows app for this release.
- **Key renewal after expiry, background and resume, and sign-out in a release-signed Android build:** checked with a debug build for 0.13.0 only.
- **The automatic check with a real API key on either platform, and one that fails at launch in the installed app:** covered by service tests only.
- Everything listed as not executed for [0.17.1](../v0.17.1/VALIDATION.md#not-executed) and not checked above remains open.

## Release artifacts

The release files were built from commit `9d0c294`. The tag commit adds only this record, the archived 0.17.1 record and handoff checklist, corrections to the documentation of Android Chat sign-in, and refreshed screenshots and check records, none of which is packaged.

| File | Bytes | SHA-256 |
|---|---:|---|
| `Tinfoil-Workbench-0.17.2-x64-Setup.exe` | 140,185,673 | `af4815d44e21467931abd4b76eabd8c0eb15b9c61a7d2a27147515f26e4ef19e` |
| `Tinfoil-Workbench-0.17.2-x64-Portable.exe` | 139,960,904 | `bd39f3d284714c97d56cc0f1490f0961cbd25b43dfd5dbd218c9a59b60f3a3d5` |
| `Tinfoil-Workbench-0.17.2-android.apk` | 4,302,478 | `fb6c31fb413ecb24228766ee8cba04cecff26f00d69e7ee6d4db8c3e47c67fe7` |

The Windows files are not code-signed. The APK is signed with APK Signature Scheme v2, with the same release key as 0.17.1 (certificate SHA-256 `6395ead797a520c632156abcd9ee2731869c64ed0ee510ad5b52e887185494cb`), has versionName 0.17.2 and versionCode 17002, targets SDK 36 with minimum SDK 24, and requests the same two permissions.

GitHub Actions passed all three workflows on commit `9d0c294`, in the pull request runs 36583747655 (Windows client), 36583747968 (Android client) and 36583747935 (renderer UI suites).
