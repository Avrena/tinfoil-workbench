# Tinfoil Workbench 0.13.0 — validation record

Recorded 28 September 2026 for the 0.13.0 release. It adds Tinfoil Chat sign-in on Android and keeps Android dialogs clear of the system bars. The record lists what ran, what failed on the way, and what did not run. **The custom system prompt is optional and not required**: the live checks ran without custom instructions. The previous record is in [history/v0.12.1](../v0.12.1/VALIDATION.md).

## Environment

- **Windows build machine:** Windows 11 Pro 10.0.26200 (x64).
- **Toolchain:** Node.js 24.21.0 LTS with npm 11.19.0; Electron 44.4.3 (Chromium 152.0.7977.130), electron-builder 26.17.0, TypeScript 5.8.3, tinfoil 1.2.1, pdfjs-dist 5.4.149; Python 3.10 for the Python-runner tests; Playwright 1.63.0 with its bundled Chromium 153.0.8010.12 (build 1243) for the browser suites.
- **Android toolchain:** Temurin JDK 21.0.12.1, Android SDK platform 36 and build-tools 36.0.0, Capacitor 8.5.2, Android Gradle Plugin 8.13.0, Gradle 8.14.3, androidx.webkit 1.14.0.
- **Emulators:** Google APIs x86_64 system images, WHPX acceleration, headless with SwiftShader.
- **Phone:** an Android 15 phone, arm64, Android System WebView 153.0.8010.36, connected over USB.

## Dependencies

- **No dependency changes** since 0.12.1; the lockfile differs only in its version field. A clean `npm run bootstrap` (npm ci plus the checksum-verified Electron binary) followed by `npm run doctor` passed all 27 entries.
- **Audit:** `npm audit --omit=dev` reports no known vulnerabilities. The full audit reports the same three moderate advisories as 0.12.1, in the dev-only chain `@capacitor/cli` → `xcode` → `uuid` (GHSA-w5hq-g745-h8pq), which is not shipped.

## Tinfoil Chat sign-in on Android

The design, its reasons and the storage trade-off are in [ANDROID-ACCOUNT.md](../../ANDROID-ACCOUNT.md). In short:

- Tinfoil's sign-in page runs in a separate WebView with no bridge, in a WebView profile of its own, limited to Tinfoil's sign-in hosts.
- Account credentials reach the host worker over a private message port.
- The key exchange runs natively.
- `AccountSession` runs unchanged, so renewal follows the Windows rules.

### Synthetic checks

`tests/android-account.test.mjs` has 14 tests. They cover:

- **The channel:** only fixed operations, replies matched by ID, timeouts and late replies.
- **The adapter:** a sign-in accepted only after two agreeing session reads; Cancel; a crashed page; refused hosts reported; and "not ready" never treated as a sign-out.
- **The exchange shim:** the fixed URL only, the `Date`, `Retry-After` and `Content-Length` headers passed through, and aborts.
- **`AccountSession` over the channel:** sign-in and renewal on a server clock an hour behind the device.
- **The Java page scripts:** checked text-for-text against the desktop scripts, and run against a stand-in Clerk page.
- **The page host list.**
- **The Android account commands:** with sign-in available, and without it.

All 356 Node tests pass.

### Device checks without credentials

The debug device checks (`tests/android-device.py --debug`) include five sign-in checks on WebViews that support sign-in:

- Tinfoil's page opens on its own screen and profile.
- Google is refused, with the reason shown and reported.
- Cancel ends the sign-in.
- The Workbench page holds no account port or JWT-shaped string.
- The sign-in profile is deleted at the next launch.

Where the WebView lacks the needed features, the checks confirm the refusal instead.

- **Android 16 (WebView 133):** all five sign-in checks passed.
- **Android 14 (WebView 113):** the WebView lacks the needed features. Sign-in and Chat mode were refused with "Tinfoil Chat sign-in needs a newer Android System WebView on this device. Use a developer API key.", and the API-key connection stayed, as designed.

### Live check with a real account

The check used the phone above, the debug build of commit `7cc871a`, and a Tinfoil account. Sign-in was completed on Tinfoil's page. A harness drove the app over DevTools. It logged only statuses, UTC times, counts and booleans.

| Check | Result |
|---|---|
| Sign-in | Completed 56 seconds after the page opened; Chat access active; the sign-in screen closed by itself |
| Enclave verification | All five steps succeeded; 17 models |
| Message | Completed in 1.2 s (deepseek-v4-1-flash) |
| Renewal after expiry | The key in use expired at 19:10:17Z. A message sent after that got a new key, expiring at 19:25:37Z, and completed in 3.9 s, with no sign-in screen and no interactive sign-in |
| Background and resume | The same process resumed in the foreground, and a message completed |
| Exposure | No JWT-shaped string in the Workbench page (DOM, localStorage, sessionStorage, window property names), in snapshots, or in the Workbench page's storage and app files (32 files) |
| Sign-out | The native confirmation appeared and was confirmed on the phone. The account signed out, and a message afterwards was refused with "Sign in to Tinfoil Chat in Account first. No API-key fallback is used." |
| Restart | The sign-in profile was gone |

The released code differs from `7cc871a` in three ways: the order in which `mobile/bridge.mjs` registers its listeners and requests the channel (`61adbef`, see [Defects found and fixed](#defects-found-and-fixed)), the Account view's text, and the version.

### Security review

- **Kept.** Tinfoil's page never shares the Capacitor WebView, and no browser cookies are copied. The page has no JavaScript interface, web-message listener or document-start script, and runs only fixed scripts. Its main frame is limited to `chat.tinfoil.sh`, `clerk.tinfoil.sh` and `accounts.tinfoil.sh`, and sub-resources to HTTPS. Account data never returns through `runNative()`. No failure falls back to a developer key, and generation retries stay at zero.
- **Weaker than Windows, by decision.** While signed in, the Tinfoil website session, including Clerk's client cookie, is in the app's private storage. After a crash or force-stop it stays there until the next launch deletes it. Backup and device transfer are disabled for the app.
- **Residual risks.**
  - If the Workbench page were compromised before the port handover at start-up, it could keep the port.
  - Results of the asynchronous page scripts pass through a one-time page global that Tinfoil's page can read; the page already holds that data.
  - The key endpoint and Clerk's page API are Tinfoil's, not a published contract.
  - Google sign-in on Android needs a supported browser integration that Tinfoil does not publish.

## Defects found and fixed

- **Android dialogs under the status bar** (merged before this release, `764918f`). From WebView 140, Capacitor draws the page under the system bars and leaves the insets to CSS. `body`'s padding kept the shell clear, but modal dialogs and the phone message editor are laid out against the whole screen.
  - *Before.* On the phone, the close buttons of Account & connection and of the message editor sat at y = 36 px, inside the 120 px status bar, and did not respond to a tap. With the fix they sit at 156 px and close their dialogs. System instructions, Model picker and Settings, which already worked, moved 60 px down, to the middle of the area below the status bar.
  - *Why the emulators missed it.* Their WebViews (133 and 113) are below 140, where Capacitor pads the view itself.
  - *Test.* `tests/ui-responsive.py` now simulates the insets for every dialog; it failed on four layers before the fix.
- **A Back press lost right after a cold start** (found by the release gates, fixed in `61adbef`). The Android plugin passes Back to the page's `backButton` listener and drops it until that listener is registered. `bridge.mjs` requested the account channel first, which put a plugin round trip ahead of the registration.
  - *Found.* On the Android 14 emulator (WebView 113), a Back press right after a cold start did nothing, and the debug checks for Back failed twice in a row, also when run alone. In isolation the same steps passed once a second had passed after the start. The release build and the Android 16 image passed.
  - *Fix.* The channel is now requested after the Back, pause and resume listeners. A test keeps that order, and the Android 14 debug checks then passed twice in a row.
- **Test harness.** The device test matched labels exactly, but the phone draws native dialog buttons in capitals, so the harness could not find "Sign out on this device". Labels now match regardless of case.

## Windows

| Check | Result |
|---|---|
| `npm test` (strict build + Node tests) | **356 passed**, 0 failed, 0 skipped: the 342 tests of 0.12.1 plus 14 in `tests/android-account.test.mjs`. Python-runner cases ran against a real interpreter. |
| `npm run dist:win` | Passed its doctor (27/27), test and native smoke gates (`DESKTOP_SMOKE_OK: encrypted storage, bridge, native PDF print and PDF.js canvas`); built the x64 NSIS installer and portable executable (unsigned) |
| Packaged app `release\win-unpacked\Tinfoil Workbench.exe --smoke-test` | `DESKTOP_SMOKE_OK`; file version 0.13.0 |
| Portable executable `--smoke-test` | Exited 0, but its launcher does not pass the app's output through, so the smoke result is not observable; not counted |
| Silent install → installed-app smoke → silent uninstall | **Not repeated.** 0.12.1 is installed and in use on the build machine, and a silent install could close or replace it. The installer configuration is unchanged since 0.12.1, where this check passed |

The Windows app itself changes only in shared renderer text and in dialog CSS, whose added terms are zero outside Android.

The ten production-renderer browser suites passed **440 checks**, with no JavaScript errors and no external requests:

| Suite | 0.12.1 | 0.13.0 |
| --- | ---: | ---: |
| ui-smoke.py | 33 | 33 |
| ui-artifacts.py | 21 | 21 |
| ui-inline.py | 20 | 20 |
| ui-seamless.py | 17 | 17 |
| ui-editing.py | 21 | 21 |
| ui-responsive.py | 90 | 93 |
| ui-spacing.py | 112 | 112 |
| ui-activity.py | 32 | 32 |
| ui-account.py | 66 | 66 |
| ui-handoff.py | 25 | 25 |

## Android

`tests/android-device.py` ran against the final APKs:

| Device image | Android System WebView | `--debug --live` | `--release` |
|---|---|---|---|
| Android 16 (API 36), Pixel 7 profile | 133.0.6943.137 | **37/37** | **13/13** |
| Android 14 (API 34), Pixel 6 profile | 113.0.5672.136 | **33/33** | **13/13** |

Both images still pass the 0.12.1 checks, including live enclave verification from the worker, where a deliberately invalid key was rejected. The two debug counts differ because of the five sign-in checks: Android 16 supports sign-in, while Android 14 runs one refusal check instead. The release checks now accept either onboarding and Account view: with sign-in, the view offers *Sign in to Tinfoil Chat*; without it, it explains why.

- **Upgrade in place (Android 16).** The published, signed 0.12.1 APK was installed, a starter chosen and a draft typed through the on-screen keyboard. `adb install -r` then installed the signed 0.13.0 APK, which reported versionName 0.13.0. The draft and the starter choice written by 0.12.1 opened, and both persisted across a force-stop.
- **Phone.** Besides the sign-in check above, the dialog fix was checked before and after on the phone (see [Defects found and fixed](#defects-found-and-fixed)).
- **Android 11** (API 30) was not rerun. In 0.12.0 the app refused its stock WebView as designed, and nothing that affects that check has changed.

## Not executed

- **Sign-in:**
  - The release-signed Android APK with a real account; the live check used the debug build.
  - Other phones, and WebViews between 113 and 133, where support for the needed features was not mapped.
  - additional sign-in methods on Android.
  - Sign-in from the installed Windows app; additional sign-in methods on Windows.
- **Live failure paths:** sign-out while a key exchange is in flight, an account or session change, 401, 402, 403 and 429 responses, and an inference rejection. These ran only as synthetic checks, on Android and on Windows.
- **Windows hardware and configuration:** the silent install and uninstall (see above); a clean, standard-user Windows machine; display scaling, high contrast, IME and the other manual items in [HANDOFF.md](HANDOFF.md); ARM64 Windows; code signing (not configured).
- **Android hardware and configuration:** other physical devices, ARM hardware other than the phone above, tablets and foldables, TalkBack, non-English system pickers, OEM WebViews; a downgrade install.
- **iOS** is not supported.

## Release artifacts

The release files were built from commit `61adbef`. The tag commit adds only this record, the updated handoff checklist, refreshed screenshots and check records, none of which is packaged. The packaging, smoke and device checks above ran on these exact files; the live account check used the debug build named above.

| File | Bytes | SHA-256 |
|---|---:|---|
| `Tinfoil-Workbench-0.13.0-x64-Setup.exe` | 139,399,813 | `72360bc591c414d518d1b8f183d649a6d725815a694f700295edafc372c9b651` |
| `Tinfoil-Workbench-0.13.0-x64-Portable.exe` | 139,175,038 | `d5722bbad5204d30a3892a2b95125f1c75b58d9a4bf5cbfaeb15dec83fd91979` |
| `Tinfoil-Workbench-0.13.0-android.apk` | 4,257,485 | `7d1529cf8db5dcd384b9691ee6281f71cc6f47bf694c46d9c3975570d0f5bf0b` |

The Windows files are not code-signed. The APK is signed with APK Signature Scheme v2, with the same release key as 0.12.1, and verified with `apksigner`. The signer's certificate SHA-256 is `6395ead797a520c632156abcd9ee2731869c64ed0ee510ad5b52e887185494cb`. The APK has versionName 0.13.0 and versionCode 13000, targets SDK 36 with minimum SDK 24, and requests the same two permissions as 0.12.1.

GitHub Actions passed all three workflows on commit `61adbef`, in the pull request runs 36474547042 (Windows client), 36474547099 (Android client) and 36474546965 (renderer UI suites).
