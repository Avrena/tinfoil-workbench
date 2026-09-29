# Tinfoil Workbench 0.18.0 — validation record

Recorded 29 September 2026 for the 0.18.0 release. It shows Tinfoil Chat's widgets in synced cloud chats on Windows, raises the default output limit to 32,768 tokens with a clearer notice at the limit, bends diagonal pairs of diagram edges apart and keeps labels off nodes and each other, and keeps Send on the phone composer's row. The last three came from a test of the visual tools with GLM-5.3 on an Android phone. The record lists what ran, what failed on the way, and what did not run. The previous record is in [history/v0.17.2](../v0.17.2/VALIDATION.md).

## Environment

- **Windows build machine:** Windows 11 Pro 10.0.26200 (x64).
- **Toolchains, emulators and dependencies:** unchanged from 0.17.2. The lockfile differs only in its version field. A clean `npm run bootstrap` followed by `npm run doctor` passed all 28 entries.
- **Phone:** an Android 15 phone, with the signed 0.17.2 APK, signed in to a real Tinfoil Chat account.

## Model test on a phone

GLM-5.3 through the Chat account, with the Visual explainer starter, the visual tools on, Python off and default reasoning. Each question was asked once in a new conversation; the four are those of the 0.17.2 test with Kimi K3. The token counts are the app's own.

| Question | Output limit | Result | Input / output tokens |
|---|---|---|---:|
| How a company's revenue has grown since 2021, and the outlook for 2026 | 8,192 (the default) | **Failed.** The model spent the whole limit reasoning and wrote no answer; the app showed "No answer text was returned" and the output-limit notice | 2,906 / 8,192 |
| The same | 32,768 | `render_chart` after its lead-in, with reported and projected series, then the takeaway | 12,072 / 6,547 |
| A short history of the Apollo program | 32,768 | `render_timeline` after three short sections | 7,501 / 1,663 |
| How a web request reaches a database | 32,768 | `render_diagram` after its lead-in, then the steps; no Mermaid or code block. The two edges between the browser and the DNS resolver, one row and one column apart, ran almost together, with a label on them | 9,638 / 4,420 |
| The capital of Japan | 32,768 | "The capital of Japan is Tokyo.", no visual | 2,893 / 47 |

- **Output limit.** Workbench sends `max_tokens` with every request, 8,192 by default; Tinfoil Chat's web client sends none. The guidance and the starter are those of 0.17.2; the failure came from the limit.
- **The new limit with every model.** In a conversation without instructions or visual tools and a limit of 32,768, a short prompt to each other chat model in Tinfoil's catalog (DeepSeek V4.1 Flash, GLM-5.3 Flash, Kimi K3, Llama 3.3 70B, Gemma 4 31B, GPT-OSS 120B) completed without an error, using under 1,000 tokens in all.
- **Composer.** With GLM-5.3 chosen, its thinking-effort picker pushed Send onto a second row of its own, at the left edge.
- The model test used the published 0.17.2 APK. The signed 0.18.0 APK was not installed on the phone: the install was refused on the device.

## What changed and how it was checked

- **Widgets in synced chats.** `cloudWidgets()` turns each widget call in a cloud answer's timeline into a tool run placed at its offset in the text, and draws charts, timelines and stat cards through `structuredVisual()`, now shared with the `render_*` tools. `tests/cloud-widgets.test.mjs` covers placement between paragraphs, Tinfoil Chat's chart shape, default titles, fallback positions, escaping of hostile text, error runs, the 32-run limit and byte-for-byte write-back; `tests/cloud-sync.test.mjs` covers the one-time re-read of chats read before, which skips a chat with unwritten changes. `tests/ui-cloud.py` renders a chat built by the real `threadFromCloud()` in the production renderer, with its chart and timeline between the right paragraphs and a map listed as not displayed. Mutating the offset rule or the re-read condition fails the tests. Not checked with a real Tinfoil Chat account.
- **Default output limit and notice.** `defaults.maxTokens` is 32,768, a new conversation copied from one on 8,192 starts at 32,768, and `outputLimitNotice()` says when the model spent the whole limit on reasoning. Core, service and project tests cover both notices, the service's notice for a reply that ends in reasoning, and the seeding.
- **Diagrams.** A diagonal pair of edges is bent apart, each labelled beside its own curve, and labels are moved off nodes and earlier labels. `tests/diagrams.test.mjs` (5 tests) checks the pair's separation and label sides and that no label covers a node or another label in a chain of long labels and in a layout like the model's; removing the bend or the label placement fails them. A diagram like the model's was also checked by eye in the production renderer.
- **Phone composer.** The model button starts from a 64px basis and grows into the free space. A `tests/ui-responsive.py` check at 393px with an effort picker requires Send on the model's row at the right; it fails with the previous rules.

## Windows

| Check | Result |
|---|---|
| `npm test` (strict build + Node tests) | **457 passed**, 0 failed, 0 skipped: the 449 tests of 0.17.2 and 8 new ones |
| `npm run dist:win` | Passed its doctor (28/28), test and native smoke gates, built the x64 NSIS installer and portable executable (unsigned), then `PACKAGE_CHECK_OK` (31 packaged modules) |
| Packaged app `release\win-unpacked\Tinfoil Workbench.exe --smoke-test` | `DESKTOP_SMOKE_OK`, including the attested SDK import; file version 0.18.0 |
| Packaged app, live enclaves (`check-packaged-provider.mjs`) | `PACKAGED_PROVIDER_OK`: the inference enclave's five verification steps and 17 models, then the sync enclave's five verification steps |
| Silent upgrade over an installed 0.17.2 (`Setup.exe /S /currentuser`) | Exit 0. The installed executable and its uninstall entry report 0.18.0, and its `app.asar` is byte-identical to the build's. The installed app's `--smoke-test` printed `DESKTOP_SMOKE_OK`, and `check-packaged-provider.mjs` run by the installed executable against its own `app.asar` printed `PACKAGED_PROVIDER_OK` with both enclaves. The existing app data (56 files, including a saved sign-in) was unchanged by SHA-256. The app was not started afterwards |

The twelve production-renderer browser suites passed **466 checks** with no JavaScript errors and no requests leaving the page: ui-smoke 36, ui-artifacts 21, ui-inline 20, ui-seamless 17, ui-editing 21, ui-responsive 94, ui-spacing 112, ui-activity 32, ui-account 68, ui-handoff 25, ui-cloud 7, ui-charts 13. Two more than 0.17.2: the synced widgets and the phone composer.

## Android

`tests/android-device.py` ran against the final APKs, with the Android 14 debug run first on each emulator after a 150-second settle.

| Device image | Android System WebView | `--debug --live` | `--release` |
|---|---|---|---|
| Android 16 (API 36), Pixel 7 profile | 133.0.6943.137 | **40/40** | **13/13** on a rerun; 11/13 in the gate run |
| Android 14 (API 34), Pixel 6 profile | 113.0.5672.136 | **36/36** | **13/13** |

- **The failed release run.** In the gate run, which ran beside the Android 14 debug run on the other emulator, the Android 16 release run did not see *Connect an account or API key to start.* within its five-second wait, and the account check that follows it failed with it. The same APK passed all 13 checks on Android 14 in the same gate, and all 13 on Android 16 when run alone on a freshly booted emulator after a 150-second settle.
- **Upgrade in place (Android 16).** The published, signed 0.17.2 APK (its SHA-256 matches the 0.17.2 release) was installed, a starter chosen and a draft typed through the on-screen keyboard. `adb install -r` then installed the signed 0.18.0 APK, which reported versionName 0.18.0. The draft and the starter choice written by 0.17.2 opened, and both persisted across a force-stop.

## Not executed

- **Synced widgets with a real Tinfoil Chat account,** and the one-time re-read in the installed app: covered by tests and synthetic chats in the production renderer only.
- **Other models with the Visual explainer starter, and repeated samples:** only Kimi K3 (0.17.2) and GLM-5.3 were asked, once per question.
- **The 0.18.0 APK on the phone,** so the composer and diagram fixes were not seen on a physical device.
- **An answer that reaches the 32,768 limit:** covered by service tests only.
- Everything listed as not executed for [0.17.2](../v0.17.2/VALIDATION.md#not-executed) and not checked above remains open.

## Release artifacts

The release files were built from commit `6aea4b3`. The tag commit adds only this record, the archived 0.17.2 record and handoff checklist, a link update, and refreshed screenshots and check records, none of which is packaged.

| File | Bytes | SHA-256 |
|---|---:|---|
| `Tinfoil-Workbench-0.18.0-x64-Setup.exe` | 140,188,306 | `820603e2893977336b257c3b36df016f9a1d854a94c74dea103c4deec83826f5` |
| `Tinfoil-Workbench-0.18.0-x64-Portable.exe` | 139,963,537 | `c8ba841a76e824bccd2462b8e3e30df09145707190554a44694e768f0525e6f3` |
| `Tinfoil-Workbench-0.18.0-android.apk` | 4,306,586 | `e87e9effeca52836609f50c6bf404a7788bedb9ed5a463a01d152a7577b351b2` |

The Windows files are not code-signed. The APK is signed with APK Signature Scheme v2, with the same release key as 0.17.2 (certificate SHA-256 `6395ead797a520c632156abcd9ee2731869c64ed0ee510ad5b52e887185494cb`), has versionName 0.18.0 and versionCode 18000, targets SDK 36 with minimum SDK 24, and requests the same two permissions.

GitHub Actions passed all three workflows on commit `6aea4b3`, in the pull request runs 36608081583 (Windows client), 36608081662 (Android client) and 36608081657 (renderer UI suites).
