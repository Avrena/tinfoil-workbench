# Tinfoil Workbench 0.13.1 — validation record

Recorded 28 September 2026 for the 0.13.1 release. It replaces the model ID field with a list of Tinfoil's chat models, shows the chosen model's maker on the welcome page, and names the cause of connection failures. The record lists what ran, what failed on the way, and what did not run. The previous record is in [history/v0.13.0](history/v0.13.0/VALIDATION.md).

## Environment

- **Windows build machine:** Windows 11 Pro 10.0.26200 (x64).
- **Toolchain (unchanged from 0.13.0):** Node.js 24.21.0 LTS with npm 11.19.0; Electron 44.4.3 (Chromium 152.0.7977.130), electron-builder 26.17.0, TypeScript 5.8.3, tinfoil 1.2.1, pdfjs-dist 5.4.149; Python 3.10 for the Python-runner tests; Playwright 1.63.0 with its bundled Chromium 153.0.8010.12 (build 1243) for the browser suites.
- **Android toolchain (unchanged):** Temurin JDK 21.0.12.1, Android SDK platform 36 and build-tools 36.0.0, Capacitor 8.5.2, Android Gradle Plugin 8.13.0, Gradle 8.14.3, androidx.webkit 1.14.0.
- **Emulators:** Google APIs x86_64 system images, WHPX acceleration, headless with SwiftShader.

## Dependencies

- **No dependency changes** since 0.13.0; the lockfile differs only in its version field. A clean `npm run bootstrap` (npm ci plus the checksum-verified Electron binary) followed by `npm run doctor` passed all 27 entries.
- **Audit:** `npm audit --omit=dev` reports no known vulnerabilities. The full audit reports the same three moderate advisories as 0.13.0, in the dev-only chain `@capacitor/cli` → `xcode` → `uuid` (GHSA-w5hq-g745-h8pq), which is not shipped.

## Model list and connection failures

- **Catalog.** *Choose model* lists the chat models of Tinfoil's public catalog (`api.tinfoil.sh/api/config/models`), followed by any model a verified endpoint lists that the catalog does not describe. 0.13.0 already fetched this catalog without credentials for reasoning settings, but only after a successful verification; it is now also requested when the picker opens. For the list, only display fields are read: name, short name, type, context size, capability flags, description and the maker's image file name. They are length-limited and stripped of control characters, and they never become request parameters. The maker comes from the image file name, then from the model ID, then from the name's initials. No image is loaded: the badges are SVG monograms drawn by the app.
- **Connection failures.** Verification and model-list failures used to end in one message, "The secure request failed. Check connectivity and enclave verification. No unverified fallback was used." It did not say whether verification timed out, a verification step failed, the Chat session ended during verification or the network failed. Each of these now has its own message, naming the failed step or the network error code, and the step results are kept. Nothing changed about which connection is used; there is still no fallback.
- **Not reproduced.** One such failure, with Chat sign-in on Windows during *Verify & refresh models*, was not reproduced on the build machine. Verification and the model list succeeded there with placeholder credentials in both the API-key and the Chat (bearer token) form, in Node and in Electron 44.4.3.

### Checks

- `tests/model-picker.test.mjs` (17 tests): display metadata and its sanitising, and that display data never becomes reasoning parameters; list order and filtering; maker fallbacks; search; context labels; escaping and accessible names of rows; the network messages, built from the SDK's own error classes; the catalog loaded once and kept across a credential change, and retried only a minute after a failure; and the timeout, failed-step, ended-session and network paths of verification.
- `tests/ui-smoke.py`: three new checks of the picker and the welcome mark in the production renderer.
- `tests/android-device.py --live`: three new checks. The catalog loads in the Android worker with makers; a tap opens the picker with its badges and does not raise the keyboard; choosing a row sets the model and the welcome mark.
- **Live, on the build machine** (commit `a9ef8c2`, in Electron 44.4.3's runtime, without credentials): the desktop catalog loader returned 17 entries in 464 ms, and the picker listed the 7 chat models among them, each with a known maker (DS, GLM, Ki, L, G, OAI). Enclave verification passed all five steps with a placeholder API key and with a placeholder Chat token, and the endpoint listed 17 models. No generation was requested.

## Windows

| Check | Result |
|---|---|
| `npm test` (strict build + Node tests) | **373 passed**, 0 failed, 0 skipped: the 356 tests of 0.13.0 plus 17 in `tests/model-picker.test.mjs`. Python-runner cases ran against a real interpreter. |
| `npm run dist:win` | Passed its doctor (27/27), test and native smoke gates (`DESKTOP_SMOKE_OK: encrypted storage, bridge, native PDF print and PDF.js canvas`); built the x64 NSIS installer and portable executable (unsigned) |
| Packaged app `release\win-unpacked\Tinfoil Workbench.exe --smoke-test` | `DESKTOP_SMOKE_OK`; file version 0.13.1 |
| Silent upgrade over an installed 0.13.0 (`Setup.exe /S /currentuser`) | Exit 0. The installed executable and its uninstall entry report 0.13.1, and the installed app's `--smoke-test` printed `DESKTOP_SMOKE_OK`. The existing app data (55 files) was unchanged by SHA-256, and the Start menu and desktop shortcuts still point to the installed app |
| Silent install into a new folder and uninstall | **Not repeated.** The installer configuration is unchanged since 0.12.1, where this check passed |

The ten production-renderer browser suites passed **443 checks** with no JavaScript errors; the suites that record network requests saw none leave the page:

| Suite | 0.13.0 | 0.13.1 |
| --- | ---: | ---: |
| ui-smoke.py | 33 | 36 |
| ui-artifacts.py | 21 | 21 |
| ui-inline.py | 20 | 20 |
| ui-seamless.py | 17 | 17 |
| ui-editing.py | 21 | 21 |
| ui-responsive.py | 93 | 93 |
| ui-spacing.py | 112 | 112 |
| ui-activity.py | 32 | 32 |
| ui-account.py | 66 | 66 |
| ui-handoff.py | 25 | 25 |

`ui-account.py` no longer expects the account view to repeat the optional-instructions notice; its six end-of-panel reachability checks now use the last account section.

## Android

`tests/android-device.py` ran against the final APKs:

| Device image | Android System WebView | `--debug --live` | `--release` |
|---|---|---|---|
| Android 16 (API 36), Pixel 7 profile | 133.0.6943.137 | **40/40** | **13/13** |
| Android 14 (API 34), Pixel 6 profile | 113.0.5672.136 | **36/36** | **13/13** |

Both images pass the 0.13.0 checks and the three new picker and catalog checks. The two debug counts differ because of the sign-in checks, as in 0.13.0: Android 16 supports sign-in, while Android 14 runs one refusal check instead.

- **Emulator timing.** These runs started 90 seconds after the emulators had booted. During development of this code, two debug runs on the Android 14 image started straight after a cold boot failed the Back checks: the first Back press after the test's restart did nothing, and later checks failed after it. With the image settled, the same build passed 36/36 twice, and the steps passed when repeated by hand. The Android 16 image did not show it. It is recorded as an emulator timing issue; nothing in this release changes it.
- **Upgrade in place (Android 16).** The published, signed 0.13.0 APK (its SHA-256 matches the 0.13.0 release) was installed, a starter chosen and a draft typed through the on-screen keyboard. `adb install -r` then installed the signed 0.13.1 APK, which reported versionName 0.13.1. The draft and the starter choice written by 0.13.0 opened, and both persisted across a force-stop.
- **Phone.** Not used for this release.
- **Android 11** (API 30) was not rerun. In 0.12.0 the app refused its stock WebView as designed, and nothing that affects that check has changed.

## Not executed

- **Sign-in:** no sign-in with a real account ran for this release. The sign-in code is unchanged since 0.13.0, whose record has the checks with a real account ([history/v0.13.0](history/v0.13.0/VALIDATION.md)). Still open:
  - the release-signed Android APK with a real account;
  - sign-in from the installed Windows app; additional sign-in methods on Windows;
  - additional sign-in methods on Android, other phones, and WebViews between 113 and 133.
- **Live failure paths:** the new connection messages ran as synthetic checks only; the failure seen with Chat sign-in on Windows was not reproduced (see above). Sign-out during a key exchange, an account or session change, 401, 402, 403 and 429 responses, and an inference rejection also ran only as synthetic checks.
- **Windows hardware and configuration:** the silent install into a new folder and uninstall (see above); the portable executable's own smoke output, which its launcher does not pass through; a clean, standard-user Windows machine; display scaling, high contrast, IME and the other manual items in [HANDOFF.md](HANDOFF.md); ARM64 Windows; code signing (not configured).
- **Android hardware and configuration:** physical devices, tablets and foldables, TalkBack, non-English system pickers, OEM WebViews; a downgrade install.
- **iOS** is not supported.

## Release artifacts

The release files were built from commit `a9ef8c2`. The tag commit adds only this record, the archived 0.13.0 record, the updated handoff checklist, README and ARCHITECTURE text, and refreshed screenshots and check records, none of which is packaged. The packaging, smoke and upgrade checks and the release-mode device checks ran on these exact files; the debug device checks used the debug APK built from the same commit.

| File | Bytes | SHA-256 |
|---|---:|---|
| `Tinfoil-Workbench-0.13.1-x64-Setup.exe` | 139,405,322 | `da9d691a38c19c53cadaf85acb292b612c541d91a75d49ddfeade6df1a4f3909` |
| `Tinfoil-Workbench-0.13.1-x64-Portable.exe` | 139,180,548 | `db6ab65e1c0bfe9a1114b2e9baab85e5745ba4a9dbda47fb73bdbebc1154ba23` |
| `Tinfoil-Workbench-0.13.1-android.apk` | 4,264,497 | `4318769013019221e3b6f2699556f925d416458f131969cf9f8a17f327b4501d` |

The Windows files are not code-signed. The APK is signed with APK Signature Scheme v2, with the same release key as 0.13.0, and verified with `apksigner`. The signer's certificate SHA-256 is `6395ead797a520c632156abcd9ee2731869c64ed0ee510ad5b52e887185494cb`. The APK has versionName 0.13.1 and versionCode 13001, targets SDK 36 with minimum SDK 24, and requests the same two permissions as 0.13.0.

GitHub Actions passed all three workflows on commit `a9ef8c2`, in the pull request runs 36490350524 (Windows client), 36490350443 (Android client) and 36490350326 (renderer UI suites).
