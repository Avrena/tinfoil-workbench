# Tinfoil Workbench 0.13.2 — validation record

Recorded 29 September 2026 for the 0.13.2 release. It lets the installed Windows app connect, adds checks of the packaged app to the release gates, names module-loading failures, and shows makers' logos and descriptions in the model picker. The record lists what ran, what failed on the way, and what did not run. The previous record is in [history/v0.13.1](history/v0.13.1/VALIDATION.md).

## Environment

- **Windows build machine:** Windows 11 Pro 10.0.26200 (x64).
- **Toolchain (unchanged from 0.13.1):** Node.js 24.21.0 LTS with npm 11.19.0; Electron 44.4.3 (Chromium 152.0.7977.130), electron-builder 26.17.0, TypeScript 5.8.3, tinfoil 1.2.1, pdfjs-dist 5.4.149; Python 3.10 for the Python-runner tests; Playwright 1.63.0 with its bundled Chromium 153.0.8010.12 (build 1243) for the browser suites.
- **Android toolchain (unchanged):** Temurin JDK 21.0.12.1, Android SDK platform 36 and build-tools 36.0.0, Capacitor 8.5.2, Android Gradle Plugin 8.13.0, Gradle 8.14.3, androidx.webkit 1.14.0.
- **Emulators:** Google APIs x86_64 system images, WHPX acceleration, headless with SwiftShader.

## Dependencies

- **zod 4.6.5 becomes a direct dependency.** It was already installed at that version, as a peer dependency of the SDK's `@ai-sdk/provider-utils` and `@ai-sdk/openai-compatible` (range `^3.25.76 || ^4.1.8`), so the resolved tree is unchanged. The lockfile now lists it as a dependency of the app instead of a peer-only install. A clean `npm run bootstrap` followed by `npm run doctor` passed all 28 entries; the new entry is the zod pin.
- **Audit:** `npm audit --omit=dev` reports no known vulnerabilities. The full audit reports the same three moderate advisories as 0.13.1, in the dev-only chain `@capacitor/cli` → `xcode` → `uuid` (GHSA-w5hq-g745-h8pq), which is not shipped.

## The installed Windows app could not connect

- **Defect.** The SDK's main entry re-exports its AI SDK provider, whose dependencies import zod. zod is only their peer dependency, so npm installed it as a peer, and electron-builder packs dependencies and optional dependencies but not such peers. In the installed 0.13.1, loading the provider failed with `ERR_MODULE_NOT_FOUND` ("Cannot find package 'zod' imported from …\app.asar\node_modules\@ai-sdk\provider-utils\dist\index.js"). Every verification therefore failed, with an API key and with Chat sign-in, and *Verify & refresh models* showed the failure.
- **Releases affected.** Confirmed on the installed 0.13.1. The lockfile has listed zod as a peer-only install since it was added, and electron-builder 26.17.0 has packaged every release, so the Windows builds of 0.11.0 to 0.13.0 have the same package contents in this respect; they were not checked one by one. The Android app bundles its dependencies with esbuild and is not affected.
- **Why the gates missed it.** The Node tests, the smoke test run from source and the live checks of earlier releases loaded modules from the repository's `node_modules`, where zod exists. The packaged app's smoke test covered storage, the bridge and printing, but the app loads the SDK only when a connection starts. The Chat sign-in checks with a real account ran from source.
- **Message.** 0.13.1 reported the failure as "Tinfoil could not be reached (ERR_MODULE_NOT_FOUND). Check your connection and try again.", because it took any error code for a network code. Module-loading codes now read "Workbench could not load part of its secure connection code (ERR_MODULE_NOT_FOUND). Reinstall or update Workbench. Nothing was sent.", only socket, DNS and TLS codes read "could not be reached", and other failures show their code.

### New checks of the packaged app

| Check | On the installed 0.13.1 | On 0.13.2 |
|---|---|---|
| `scripts/check-package.mjs` (every packaged module's dependencies and required peers resolve in `app.asar`) | Failed: zod missing, as a peer of `@ai-sdk/openai-compatible` 3.0.57 and `@ai-sdk/provider-utils` 5.0.49 | `PACKAGE_CHECK_OK`, 31 packaged modules |
| `--smoke-test`, which now also loads the SDK and builds a client without a request | Not in that build | `DESKTOP_SMOKE_OK: encrypted storage, bridge, attested SDK import, native PDF print and PDF.js canvas` |
| `scripts/check-packaged-provider.mjs`, run by the packaged executable in Node mode: live enclave verification with a placeholder key, then the model list | Failed: `ERR_MODULE_NOT_FOUND`, "Cannot find package 'zod'" | `PACKAGED_PROVIDER_OK`: all five verification steps succeeded, 17 models listed |

`tests/packaging.test.mjs` fails when the lockfile has a runtime package installed only as a peer (it fails on the 0.13.1 lockfile), and checks `check-package.mjs` against synthetic archives. Windows CI now runs the package check and the packaged app's smoke test after packaging. The live check needs the network and stays a release gate ([RELEASING.md](RELEASING.md)).

## Model picker

- **Logos.** Makers with a logo (DeepSeek, Z.ai, Moonshot AI, Gemma, Google, OpenAI, Meta for Llama, Mistral AI and Qwen) are drawn with it: in white on the maker's colour in list rows and the model button, and alone in muted white on the welcome page. The paths come from LobeHub Icons (`@lobehub/icons-static-svg` 1.95.1, MIT) without their inline styles, which the renderer's CSP refuses; NOTICE credits the source and the trademarks. Other makers, and IDs that the catalog does not describe, keep the monogram.
- **Rows.** The catalog's description shows in two lines at most, with the full text as the row's tooltip. The reasoning, image and tool marks keep fixed columns. On screens up to 780 px wide, the marks and the context size take their own line.
- **Model button.** `#composer-model{display:block}`, an ID rule, overrode the button's flex layout, so the badge sat on the text baseline above the name. The badge, the name and an SVG chevron are now a centred flex row.
- **Checks.** Unit tests cover the logo and monogram markup, the path data, the escaping of descriptions and the empty mark slots. `tests/ui-smoke.py` checks in the production renderer that rows show logos and a two-line description, that the mark columns line up across rows, that the welcome page shows the logo alone, and that the button's badge, name and chevron are centred within 1.5 px.

## Windows

| Check | Result |
|---|---|
| `npm test` (strict build + Node tests) | **377 passed**, 0 failed, 0 skipped: the 373 tests of 0.13.1, 2 in `tests/packaging.test.mjs`, and 2 more in `tests/model-picker.test.mjs`. Python-runner cases ran against a real interpreter. |
| `npm run dist:win` | Passed its doctor (28/28), test and native smoke gates, built the x64 NSIS installer and portable executable (unsigned), then `PACKAGE_CHECK_OK` |
| Packaged app `release\win-unpacked\Tinfoil Workbench.exe --smoke-test` | `DESKTOP_SMOKE_OK`, including the attested SDK import; file version 0.13.2 |
| Packaged app, live enclave (`check-packaged-provider.mjs`) | `PACKAGED_PROVIDER_OK`: five verification steps, 17 models |
| Silent upgrade over an installed 0.13.1 (`Setup.exe /S /currentuser`) | Exit 0. The installed executable and its uninstall entry report 0.13.2. The installed app's `--smoke-test` printed `DESKTOP_SMOKE_OK`, and `check-packaged-provider.mjs` run by the installed executable against its own `app.asar` printed `PACKAGED_PROVIDER_OK`. The existing app data (55 files) was unchanged by SHA-256, and the Start menu and desktop shortcuts still point to the installed app |
| Silent install into a new folder and uninstall | **Not repeated.** The installer configuration is unchanged since 0.12.1, where this check passed |

The ten production-renderer browser suites passed **443 checks** with no JavaScript errors; the suites that record network requests saw none leave the page. The counts equal those of 0.13.1: the picker checks in `ui-smoke.py` were extended, not added.

| Suite | 0.13.1 | 0.13.2 |
| --- | ---: | ---: |
| ui-smoke.py | 36 | 36 |
| ui-artifacts.py | 21 | 21 |
| ui-inline.py | 20 | 20 |
| ui-seamless.py | 17 | 17 |
| ui-editing.py | 21 | 21 |
| ui-responsive.py | 93 | 93 |
| ui-spacing.py | 112 | 112 |
| ui-activity.py | 32 | 32 |
| ui-account.py | 66 | 66 |
| ui-handoff.py | 25 | 25 |

## Android

`tests/android-device.py` ran against the final APKs:

| Device image | Android System WebView | `--debug --live` | `--release` |
|---|---|---|---|
| Android 16 (API 36), Pixel 7 profile | 133.0.6943.137 | **40/40** | **13/13** |
| Android 14 (API 34), Pixel 6 profile | 113.0.5672.136 | **36/36** | **13/13** |

The Android app was not affected by the packaging defect: its build bundles the SDK and its dependencies, zod included. It gains the new model picker and the new messages. The counts equal those of 0.13.1; as there, the debug counts differ because Android 16 runs the sign-in checks and Android 14 one refusal check instead, and the runs started 90 seconds after the emulators had booted.

- **Upgrade in place (Android 16).** The published, signed 0.13.1 APK (its SHA-256 matches the 0.13.1 release) was installed, a starter chosen and a draft typed through the on-screen keyboard. `adb install -r` then installed the signed 0.13.2 APK, which reported versionName 0.13.2. The draft and the starter choice written by 0.13.1 opened, and both persisted across a force-stop.
- **Phone.** Not used for this release.
- **Android 11** (API 30) was not rerun. In 0.12.0 the app refused its stock WebView as designed, and nothing that affects that check has changed.

## Not executed

- **A real connection from the installed Windows app.** The packaged checks verified the live enclave and listed the models with a placeholder key; no message was sent with a real API key or a Chat account from the installed app. With Chat sign-in, run *Verify & refresh models* in the installed app to confirm.
- **Sign-in:** no sign-in with a real account ran for this release; the sign-in code is unchanged since 0.13.0 ([history/v0.13.0](history/v0.13.0/VALIDATION.md)). Still open: the release-signed Android APK with a real account; sign-in from the installed Windows app; additional sign-in methods on Windows; additional sign-in methods on Android; other phones, and WebViews between 113 and 133.
- **Live failure paths:** the connection messages ran as synthetic checks only. Sign-out during a key exchange, an account or session change, 401, 402, 403 and 429 responses, and an inference rejection also ran only as synthetic checks.
- **Earlier Windows releases** were not checked one by one for the missing module (see above).
- **Windows hardware and configuration:** the silent install into a new folder and uninstall; the portable executable's own smoke output, which its launcher does not pass through; a clean, standard-user Windows machine; display scaling, high contrast, IME and the other manual items in [HANDOFF.md](HANDOFF.md); ARM64 Windows; code signing (not configured).
- **Android hardware and configuration:** physical devices, tablets and foldables, TalkBack, non-English system pickers, OEM WebViews; a downgrade install.
- **iOS** is not supported.

## Release artifacts

The release files were built from commit `9a10585`. The tag commit adds only this record, the archived 0.13.1 record with a note on the packaging defect, the updated handoff checklist, README and ARCHITECTURE text, and refreshed screenshots and check records, none of which is packaged. The packaging, smoke, live packaged, upgrade and release-mode device checks ran on these exact files; the debug device checks used the debug APK built from the same commit.

| File | Bytes | SHA-256 |
|---|---:|---|
| `Tinfoil-Workbench-0.13.2-x64-Setup.exe` | 140,157,297 | `297f6025ec3cd8179fefa63ddafd7a0f0180d399fd4fa3903c625d750211694d` |
| `Tinfoil-Workbench-0.13.2-x64-Portable.exe` | 139,932,524 | `cdaff3f9943373e245b64217a1fb83d5166c973a9c407529934533c19f96c768` |
| `Tinfoil-Workbench-0.13.2-android.apk` | 4,272,848 | `9db1658cd1673455d117e6e0d31338dd74a7e79e851c2747ad4c682c0aa43ac7` |

The Windows files are not code-signed. The APK is signed with APK Signature Scheme v2, with the same release key as 0.13.1, and verified with `apksigner`. The signer's certificate SHA-256 is `6395ead797a520c632156abcd9ee2731869c64ed0ee510ad5b52e887185494cb`. The APK has versionName 0.13.2 and versionCode 13002, targets SDK 36 with minimum SDK 24, and requests the same two permissions as 0.13.1.

GitHub Actions passed all three workflows on commit `9a10585`, in the pull request runs 36498060460 (Windows client, which now also ran the package check and the packaged app's smoke test), 36498060321 (Android client) and 36498060417 (renderer UI suites).
