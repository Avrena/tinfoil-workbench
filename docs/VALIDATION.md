# Tinfoil Workbench 0.12 — validation record

Recorded 28 September 2026 for the 0.12.0 release. It lists what ran, what failed on the way, and what did not run. **The custom system prompt is optional and not required**: None remains the default in the new instructions picker, and blank instructions remain covered by tests. The previous record is in [history/v0.11](history/v0.11/VALIDATION.md).

## Environment

- **Windows build machine:** Windows 11 Pro 10.0.26200 (x64).
- **Toolchain:** Node.js 24.21.0 LTS with npm 11.19.0; Electron 44.4.3 (Chromium 152.0.7977.130), electron-builder 26.17.0, TypeScript 5.8.3, tinfoil 1.2.1, pdfjs-dist 5.4.149; Python 3.10 for the Python-runner tests; Playwright 1.63.0 with its bundled Chromium 153.0.8010.12 (build 1243) for the browser suites.
- **Android toolchain:** Temurin JDK 21.0.12.1, Android SDK platform 36 and build-tools 36.0.0, Capacitor 8.5.2, Android Gradle Plugin 8.13.0, Gradle 8.14.3.
- **Emulators:** Google APIs x86_64 system images, WHPX acceleration, headless with SwiftShader.

## Dependencies

- **No dependency changes** since 0.11.0; the lockfile differs only in its version field. A clean `npm run bootstrap` (npm ci plus the checksum-verified Electron binary) followed by `npm run doctor` passed all 27 entries.
- **Audit:** `npm audit --omit=dev` reports no known vulnerabilities. The full audit reports the same three moderate advisories as 0.11.0, in the dev-only chain `@capacitor/cli` → `xcode` → `uuid` (GHSA-w5hq-g745-h8pq), which is not shipped.

## Windows

| Check | Result |
|---|---|
| `npm test` (strict build + Node tests) | **313 passed**, 0 failed, 0 skipped: the 300 tests of 0.11.0 plus 13 in `tests/instructions.test.mjs`. Python-runner cases ran against a real interpreter. |
| `npm run dist:win` | Passed its doctor (27/27), test and native smoke gates (`DESKTOP_SMOKE_OK: encrypted storage, bridge, native PDF print and PDF.js canvas`); built the x64 NSIS installer and portable executable (unsigned) |
| Packaged app `release\win-unpacked\Tinfoil Workbench.exe --smoke-test` | `DESKTOP_SMOKE_OK` |
| Silent per-user install (`/S /D=…`) → installed-app smoke → silent uninstall | Installed with an uninstall entry for 0.12.0 plus Start-menu and desktop shortcuts; the installed app printed `DESKTOP_SMOKE_OK`; uninstall removed the program files, the uninstall entry and both shortcuts |

The ten production-renderer browser suites passed **437 checks** on the release commit with no JavaScript errors and no external requests:

| Suite | 0.11.0 | 0.12.0 |
| --- | ---: | ---: |
| ui-smoke.py | 22 | 33 |
| ui-artifacts.py | 21 | 21 |
| ui-inline.py | 20 | 20 |
| ui-seamless.py | 17 | 17 |
| ui-editing.py | 19 | 21 |
| ui-responsive.py | 89 | 90 |
| ui-spacing.py | 103 | 112 |
| ui-activity.py | 32 | 32 |
| ui-account.py | 66 | 66 |
| ui-handoff.py | 24 | 25 |

### Fonts on Windows 11

DevTools `CSS.getPlatformFontsForNode` reported the fonts actually used, both in Electron 44.4.3 (a standalone probe with a throwaway profile, loading the preview) and in Playwright's Chromium 153:

- **0.11.0 stack** `"Segoe UI Variable","Segoe UI",system-ui,sans-serif`: rendered with Segoe UI. The bare name `Segoe UI Variable` matches no installed family; on its own it fell through to the default serif face.
- **0.12.0:** answer text rendered with Segoe UI Variable (PostScript `Segoe-UI-Variable-Text`), reply headings with `Segoe-UI-Variable-Display-Semibold`, and inline and block code with Consolas.

### Defects found and fixed

- **A second Escape discarded unsaved text.** Both the message editor and the new instructions editor keep their dialog open on Escape by cancelling its `cancel` event and asking before discarding. Chromium lets a page prevent only one close request per user activation, and Escape is not an activation. The second Escape therefore delivered a non-cancelable `cancel` event and closed the dialog without the question it had just shown. This reproduced in Electron 44.4.3 and in Chromium 153 with a single opening click, typed text and two Escape presses. The renderer now handles Escape at `keydown` (commit `7e17f04`).
- **Tests that could not see it.** The first regression checks passed even without the fix, because Playwright evaluates its page queries with a user gesture. Each `expect()` between the two presses granted a new activation. The final checks press Escape twice with no page query in between. They fail when the `keydown` handler or the IME guard is removed, and pass with them.
- **Stacked dialogs.** Android Back acted on the last open dialog in document order. The message editor is appended after every other dialog, so with close review open over an editor the lower dialog would have been chosen. Escape and Back now share `cancelTopDialog()`, which uses the opening order recorded by `openModal()`. `ui-handoff.py` checks Escape with close review over an unsaved editor, and fails when document order is used.

## Android

### Unit tests

The Node tests above include the 18 Android host tests from 0.11.0. `tests/instructions.test.mjs` also sends the new library commands through the Android command handler with a real `WorkbenchService`.

### Device checks

`tests/android-device.py` ran against the final APKs:

| Device image | Android System WebView | `--debug --live` | `--release` |
|---|---|---|---|
| Android 16 (API 36), Pixel 7 profile | 133.0.6943.137 | **30/30** | **13/13** |
| Android 14 (API 34), Pixel 6 profile | 113.0.5672.136 | **30/30** | **13/13** |
| Android 11 (API 30), Pixel 4 profile | 83.0.4103.106 (stock) | The app refused to load and showed *Update Android System WebView*, as designed | — |

The 0.11.0 checks all still pass. That includes live enclave verification from the worker, where all five steps succeeded on both images and a request with a deliberately invalid key was rejected with "API authentication was rejected". The new checks are:

- **Debug build**, through DevTools and real input:
  - A touch on the icon-only instructions control (36 × 44 CSS px) opens the picker.
  - A tapped starter applies through the Android host, and the control shows a dot as well as colour.
  - The real Back key asks before discarding unsaved instructions, also when pressed again.
  - Save is tapped while the on-screen keyboard is open and stores the entry without changing the conversation.
  - Back steps from an unchanged editor to the list, then closes the picker.
  - The saved entry and the conversation's choice survive a force-stop in the Keystore-encrypted vault.
  - Inline and block code render with Droid Sans Mono. The 0.11.0 stack rendered with Cutive Mono, the typewriter face that Android maps Courier New to.
- **Release build**, through UI Automator: the picker opens from the composer, a chosen starter names the control, and Back steps from the editor to the list and then closes the picker.

Further checks on the same images:

- **Upgrade in place (Android 16).** The signed 0.11.0 APK was installed and a draft typed through the on-screen keyboard. Then `adb install -r` installed the signed 0.12.0 APK, which reported versionName 0.12.0. The draft written by 0.11.0 reopened. A starter chosen in 0.12.0 persisted, together with that draft, across a force-stop.
- **Logs.** After clearing logcat, both runs on each image left no plugin arguments or results in the log; Capacitor wrote only its "Starting BridgeActivity" lines.

### Defect found and fixed

- **Instructions editor actions behind the keyboard.** The first debug run on Android 16 failed three of the new checks. Tapping *Keep editing* focuses the text field and opens the on-screen keyboard. The dialog then fits the 527 CSS px left above the keyboard, and Back, Save for reuse and Use in this conversation sat at 540–584 px, below the visible part of the scrolling dialog. The harness tapped the keyboard instead of Save. A user would have had to discover that the dialog scrolls.
- **Fix.** The action row is now sticky (commit `3f6d5f7`). `ui-responsive.py` checks Save and Use at 390×420 and 844×390 and fails without the fix (Save at y=421 in a 420 px viewport). The device checks now tap Save with the real keyboard open. The harness also accounts for the first Back only hiding the keyboard.

### Compatibility checks

- **Downgrade.** A workspace written by 0.12.0 was opened with 0.11.0's own `validateWorkspace()`, built from the `v0.11.0` tag. It opened, and conversations and instruction text were kept. The saved library, the thread's instruction name and the per-reply names were dropped. Reopening that result in 0.12.0 gave an empty library and unlabelled replies, as the changelog states. This was not repeated as a downgrade install on a device.
- **Permissions.** The release APK requests `android.permission.INTERNET`. It also requests `org.avrena.tinfoil.workbench.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION`, an app-private permission at signature protection level that AndroidX Core declares for the app's own non-exported receivers. 0.11.0 declares the same two; its record described it as requesting only `INTERNET`.

## Live inference with a Chat credential (recorded after release)

Recorded 28 September 2026 on the build machine, after the release, with the code of the `v0.12.0` tag.

- **Credential.** A short-lived Chat inference credential was exported from a signed-in Tinfoil Chat web session with an active subscription. It has `key` and `expires_at` fields, the shape the token endpoint returns, and was valid for 15 minutes.
- **Code path.** A test process read the credential from a local file into memory. It ran `WorkbenchService` in `chat-account` mode, with an in-memory vault and a stand-in for `AccountSession` that returned the credential. The requests therefore went through `desktop/provider.mjs`, the official SDK, attestation and EHBP, as they do after a Windows sign-in.
- **Handling.** The credential was not printed, logged, persisted or committed. A check after each run found it absent from the vault data.

| Check | Result |
|---|---|
| Enclave verification | All five steps succeeded (`fetchDigest`, `verifyCode`, `verifyEnclave`, `compareMeasurements`, `verifyCertificate`) in about 4 s; 17 models listed |
| Plain message (deepseek-v4-1-flash) | Streamed and completed in about 3 s, with usage reported (1,663 input tokens including the visual-tool definitions, 18 output) |
| Message with the Concise starter selected | Completed with returned reasoning; the reply recorded the instructions name "Concise" |
| Stop during a streamed answer | The reply was marked stopped, the text received before Stop was kept, and the conversation was no longer busy. Sending again in that thread was refused with "Select a completed reply before continuing…", as designed |
| Visual tool | The model called `render_chart`, which completed and produced a chart artifact, followed by a sentence about the trend |
| Comparison (deepseek-v4-1-flash and gpt-oss-120b) | Both replies completed independently |
| Tinfoil web search | The provider's web search completed with 8 sources, and the answer cited docs.tinfoil.sh |

These checks do not cover the Windows sign-in window and token exchange that produce the credential ([ACCOUNT.md](ACCOUNT.md)), or the renderer and Electron main process in Chat mode. They also do not cover Android, which has no Chat-account mode and still needs a developer API key. Those remain manual checks in [HANDOFF.md](HANDOFF.md).

## Not executed

- **Real account and key:** live inference ran only through the service, with an exported Chat credential (see above). The Windows Chat sign-in window and token exchange, a real developer API key, delegation against a real entitlement, and live inference from the Electron renderer or the Android app were not executed.
- **Windows hardware and configuration:** a clean, standard-user Windows machine (install, run and uninstall ran on the build machine); display scaling, high contrast, IME and the other manual items in [HANDOFF.md](HANDOFF.md); ARM64 Windows; code signing (not configured).
- **Android hardware and configuration:** physical Android devices, ARM hardware, tablets and foldables, TalkBack (including the picker's spoken labels), non-English system pickers, OEM WebViews; a downgrade install from 0.12.0 to 0.11.0.
- **iOS** is not supported.

## Release artifacts

The release files were built from commit `e05441d`, the code of the `v0.12.0` tag. The tag commit adds only this record, the updated handoff checklist, refreshed screenshots and check records, none of which is packaged. Every check above ran on these exact files:

| File | Bytes | SHA-256 |
|---|---:|---|
| `Tinfoil-Workbench-0.12.0-x64-Setup.exe` | 139,398,373 | `8742efefd2fc5e7bbdf389c0855f9f34c05966c3b26b1d5a1719f25c86beb2c5` |
| `Tinfoil-Workbench-0.12.0-x64-Portable.exe` | 139,173,591 | `20e27c3d1e949514cf85d50f854d2907adf31592aa2ebd0bb02cc610d5e14750` |
| `Tinfoil-Workbench-0.12.0-android.apk` | 4,238,101 | `0822c2eea55ebb0c35f1b4745ec00bda12000d8d8ddc3736863b75d769f3d064` |

The Windows files are not code-signed. The APK is signed with APK Signature Scheme v2, with the same release key as 0.11.0, and verified with `apksigner`. The signer's certificate SHA-256 is `6395ead797a520c632156abcd9ee2731869c64ed0ee510ad5b52e887185494cb`. The APK has versionName 0.12.0 and versionCode 12000, and targets SDK 36 with minimum SDK 24.

GitHub Actions passed all three workflows on commit `e05441d`, in the pull request runs 36412699439 (Windows client), 36412699319 (Android client) and 36412699505 (renderer UI suites).
