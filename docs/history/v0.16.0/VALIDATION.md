# Tinfoil Workbench 0.16.0 — validation record

Recorded 29 September 2026 for the 0.16.0 release. It tells the model when to use its visual tools and Python, through a guide at the start of the system message, and adds pie, stacked and unit-aware charts with a hover and keyboard readout. The record lists what ran, what failed on the way, and what did not run. The previous record is in [history/v0.15.1](../v0.15.1/VALIDATION.md).

## Environment

- **Windows build machine:** Windows 11 Pro 10.0.26200 (x64).
- **Toolchains, emulators and dependencies:** unchanged from 0.15.1. The lockfile differs only in its version field. A clean `npm run bootstrap` followed by `npm run doctor` passed all 28 entries. `npm audit --omit=dev` reports no known vulnerabilities; the full audit reports the same three moderate advisories in the dev-only `@capacitor/cli` → `xcode` → `uuid` chain.

## The guide to the tools

Before this release the visual tools and Python reached the model only as tool schemas. The system message carried the user's instructions and project context, and nothing about when a tool helps. `src/core/prompt.ts` now puts a fixed `<workbench_tools>` section at the start of the system message, with a `<visuals>` part and a `<python>` part for the tools actually offered on that request. It follows the XML-section layout of Tinfoil Chat's own prompt, whose client and public configuration (`/api/config/system-prompt`, with its GenUI guidance) were read for reference, not copied. The user's instructions follow the guide and take precedence; cloud project context follows them, now escaped as Tinfoil Chat escapes it.

- **Size:** 1,313 characters (about 330 tokens) with the visual tools, 1,616 characters (about 400 tokens) with Python as well, 390 with Python alone. It depends only on the offered tool set and contains no date, time or user data, so the start of every request stays byte-identical and the provider's prefix cache covers it.
- **Checks:** `tests/prompt.test.mjs` (4 tests): the guide names only offered tools and names every visual tool a model chooses between; it is fixed and under 2,200 characters; it is prepended to an existing system message without mutating it; project names, instructions and documents are escaped, so `</project_context>` inside a document stays text. A service test (`tests/visual-service.test.mjs`) checks the guide on both rounds of a tool loop, a single system message, and no guide when visual tools are off or the model cannot call tools. Three service tests now index request messages one place later.
- **Not measured:** whether and how often real models choose a visual now. The checks use scripted provider responses.

## Charts

Chart forms and reading aids follow current chat visualization tools (OpenAI's interactive bar, line, pie and scatter charts; Anthropic's inline visuals, which a model creates unasked when they help) and a data-visualization method for marks, color and interaction:

- **Pie** charts (a donut with 2px gaps, direct labels for parts of 4% or more, the total unless the values are percentages), limited to one series of two to six non-negative parts; **stacked** bar and area charts; **units** as a value prefix and suffix; **round ticks**.
- **Hover and keyboard:** a crosshair and one readout of every visible series on line and area charts, the category band on bar charts with the stack total, the nearest point on scatter charts, the slice on pie charts; arrow keys, Home and End on the focused chart, announced in a polite live region. Labels are inserted as text. The Data tab keeps every value.
- **Palette:** the series colors failed the palette validator on the app's dark surface: lightness band, chroma floor, CVD separation (series 1 and 2 were ΔE 2.0 apart under deuteranopia) and normal-vision floor. They are replaced by the reference palette's dark steps, which pass all five checks on `#1e1e1e` and `#252526` (worst adjacent CVD ΔE 8.4, normal-vision ΔE 19.3, all at least 3:1); the first three also pass all-pairs, as scatter charts need.
- **Checks:** `tests/charts.test.mjs` (9 tests) covers validation, stacking and restacking, units, round ticks, pie geometry, labels and print colors, native tooltips only in exports, and the schema the model reads. Three existing tests follow the palette and the bar paths. The new browser suite `tests/ui-charts.py` (9 checks) drives the hover and keyboard readouts, series toggling, stacked totals, the pie legend, readout and Data tab, and the escaping of model labels, in the production renderer.
- Charts made by earlier versions parse unchanged; the new fields are optional and omitted when unset.

## Windows

| Check | Result |
|---|---|
| `npm test` (strict build + Node tests) | **432 passed**, 0 failed, 0 skipped: the 418 tests of 0.15.1 and 14 new ones |
| `npm run dist:win` | Passed its doctor (28/28), test and native smoke gates, built the x64 NSIS installer and portable executable (unsigned), then `PACKAGE_CHECK_OK` (31 packaged modules) |
| Packaged app `release\win-unpacked\Tinfoil Workbench.exe --smoke-test` | `DESKTOP_SMOKE_OK`, including the attested SDK import; file version 0.16.0 |
| Packaged app, live enclaves (`check-packaged-provider.mjs`) | `PACKAGED_PROVIDER_OK`: the inference enclave's five verification steps and 17 models, then the sync enclave's five verification steps |
| Silent upgrade over an installed 0.15.1 (`Setup.exe /S /currentuser`) | Exit 0. The installed executable and its uninstall entry report 0.16.0. The installed app's `--smoke-test` printed `DESKTOP_SMOKE_OK`, and `check-packaged-provider.mjs` run by the installed executable against its own `app.asar` printed `PACKAGED_PROVIDER_OK` with both enclaves. The existing app data (56 files, including a saved sign-in) was unchanged by SHA-256, and the Start menu and desktop shortcuts still point to the installed app. 0.15.1 had been installed over 0.15.0 earlier the same day in the same way, with the same results |

The twelve production-renderer browser suites passed **460 checks** with no JavaScript errors and no requests leaving the page:

| Suite | 0.15.1 | 0.16.0 |
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
| ui-charts.py | — | 9 |

## Android

The Android app shares the renderer and the service, so it gets the guide and the charts too. `tests/android-device.py` ran against the final APKs; its instructions-picker check follows the reworded None option.

| Device image | Android System WebView | `--debug --live` | `--release` |
|---|---|---|---|
| Android 16 (API 36), Pixel 7 profile | 133.0.6943.137 | **40/40** | **13/13** |
| Android 14 (API 34), Pixel 6 profile | 113.0.5672.136 | **36/36** | **13/13** |

- **Upgrade in place (Android 16).** The published, signed 0.15.1 APK (its SHA-256 matches the 0.15.1 release) was installed, a starter chosen and a draft typed through the on-screen keyboard. `adb install -r` then installed the signed 0.16.0 APK, which reported versionName 0.16.0. The draft and the starter choice written by 0.15.1 opened, and both persisted across a force-stop. The counts equal those of 0.15.1.
- **Phone.** Not used for this release.

## Not executed

- **Model behavior with the guide:** no request with a real model ran for this release, so whether models now create visuals unasked, and choose between the tools as the guide says, is not measured.
- **The hover layer on touch screens and with a screen reader:** the checks use a mouse pointer and the keyboard in Chromium.
- Everything listed as not executed for [0.15.1](../v0.15.1/VALIDATION.md#not-executed) remains open.

## Release artifacts

The release files were built from commit `45ef4bb`. The tag commit adds only this record, the archived 0.15.1 record, the updated handoff checklist and README text, and refreshed screenshots and check records, none of which is packaged.

| File | Bytes | SHA-256 |
|---|---:|---|
| `Tinfoil-Workbench-0.16.0-x64-Setup.exe` | 140,181,335 | `7c0ac38bab688ba0820b9bb4a4971f45828cff5ea531809647dc1cc3d478b77b` |
| `Tinfoil-Workbench-0.16.0-x64-Portable.exe` | 139,956,478 | `6e50667f2e353f6dcd0b2ba65329cd42e30741217f265dc03566b5b65008d3f0` |
| `Tinfoil-Workbench-0.16.0-android.apk` | 4,293,230 | `eb8d844aff34215e54a7d98636fe8ab70c1fe363d6b458c48e08f55046f66c07` |

The Windows files are not code-signed. The APK is signed with APK Signature Scheme v2, with the same release key as 0.15.1 (certificate SHA-256 `6395ead797a520c632156abcd9ee2731869c64ed0ee510ad5b52e887185494cb`), has versionName 0.16.0 and versionCode 16000, targets SDK 36 with minimum SDK 24, and requests the same two permissions.

GitHub Actions passed all three workflows on commit `45ef4bb`, in the pull request runs 36562959207 (Windows client), 36562959160 (Android client) and 36562959181 (renderer UI suites, now twelve).
