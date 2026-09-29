# Tinfoil Workbench 0.14.0 — validation record

Recorded 29 September 2026 for the 0.14.0 release. It keeps a Tinfoil Chat sign-in on Windows across restarts and updates. The record lists what ran, what failed on the way, and what did not run. The previous record is in [history/v0.13.2](history/v0.13.2/VALIDATION.md).

## Environment

- **Windows build machine:** Windows 11 Pro 10.0.26200 (x64).
- **Toolchain (unchanged from 0.13.2):** Node.js 24.21.0 LTS with npm 11.19.0; Electron 44.4.3 (Chromium 152.0.7977.130), electron-builder 26.17.0, TypeScript 5.8.3, tinfoil 1.2.1, pdfjs-dist 5.4.149, zod 4.6.5; Python 3.10 for the Python-runner tests; Playwright 1.63.0 with its bundled Chromium 153.0.8010.12 (build 1243) for the browser suites.
- **Android toolchain (unchanged):** Temurin JDK 21.0.12.1, Android SDK platform 36 and build-tools 36.0.0, Capacitor 8.5.2, Android Gradle Plugin 8.13.0, Gradle 8.14.3, androidx.webkit 1.14.0.
- **Emulators:** Google APIs x86_64 system images, WHPX acceleration, headless with SwiftShader.

## Dependencies

- **No dependency changes** since 0.13.2; the lockfile differs only in its version field. A clean `npm run bootstrap` followed by `npm run doctor` passed all 28 entries.
- **Audit:** `npm audit --omit=dev` reports no known vulnerabilities. The full audit reports the same three moderate advisories as 0.13.2, in the dev-only chain `@capacitor/cli` → `xcode` → `uuid` (GHSA-w5hq-g745-h8pq), which is not shipped.

## Staying signed in

Before this release, the website session lived only in the sign-in window's in-memory partition, and quitting ended its Clerk session, so every restart and update asked for a new sign-in. With *Stay signed in on this PC* on (the default), the persistent cookies of `tinfoil.sh` and its subdomains are saved with the user and Clerk session IDs in `account-session.bin`, sealed by Electron safeStorage (DPAPI). They are saved after sign-in, two seconds after they last changed and at quit. At launch they are loaded into a new in-memory partition before Tinfoil's page opens, hidden, and the session is used only if it belongs to the saved user and Clerk session. [ACCOUNT.md](ACCOUNT.md) and [SECURITY.md](../SECURITY.md) describe what is saved and how it is protected.

### Checks

- `tests/account-remember.test.mjs` (13 tests), with a reversible stand-in for safeStorage and fake Electron objects:
  - the store: nothing in plaintext, a record with a foreign cookie refused whole, an unreadable file deleted, no save without OS encryption;
  - the cookie filter: only persistent cookies of `tinfoil.sh` and its subdomains;
  - the window: cookies set before the page loads, a hidden window, the read bound to the saved IDs, closing without ending the Clerk session, and a page that never becomes ready;
  - the session: saving at sign-in, on cookie changes (once per burst, dropped at sign-out) and at quit; a restore followed by the access check; an ended, changed or foreign session deleted without ending any session; an offline start kept and retried at the next Chat request; the switch; sign-out and invalidation; Android without a store; the workspace preference.
- `tests/account.test.mjs`: its 64 tests pass against the changed window and session code.
- `tests/ui-account.py` gains two checks: the Restoring state offers no sign-in or mode change, and the switch is on by default and changes the session text.

**Not checked with a real account:** the restore of a real Tinfoil session after a restart. The cookies Clerk needs were not observed; the checks use synthetic cookies. If Clerk needs a cookie that is not saved, such as a session cookie, the restore fails safely: the saved sign-in is deleted and the Account view asks for a new sign-in.

## Windows

| Check | Result |
|---|---|
| `npm test` (strict build + Node tests) | **390 passed**, 0 failed, 0 skipped: the 377 tests of 0.13.2 and 13 in `tests/account-remember.test.mjs`. Python-runner cases ran against a real interpreter. |
| `npm run dist:win` | Passed its doctor (28/28), test and native smoke gates, built the x64 NSIS installer and portable executable (unsigned), then `PACKAGE_CHECK_OK` (31 packaged modules) |
| Packaged app `release\win-unpacked\Tinfoil Workbench.exe --smoke-test` | `DESKTOP_SMOKE_OK`, including the attested SDK import; file version 0.14.0 |
| Packaged app, live enclave (`check-packaged-provider.mjs`) | `PACKAGED_PROVIDER_OK`: five verification steps, 17 models |
| Silent upgrade over an installed 0.13.2 (`Setup.exe /S /currentuser`) | Exit 0. The installed executable and its uninstall entry report 0.14.0. The installed app's `--smoke-test` printed `DESKTOP_SMOKE_OK`, and `check-packaged-provider.mjs` run by the installed executable against its own `app.asar` printed `PACKAGED_PROVIDER_OK`. The existing app data (55 files) was unchanged by SHA-256, and the Start menu and desktop shortcuts still point to the installed app |
| Silent install into a new folder and uninstall | **Not repeated.** The installer configuration is unchanged since 0.12.1, where this check passed |

After the 0.13.2 release, *Verify & refresh models* with Chat sign-in succeeded in the installed 0.13.2 in a manual check with the real account, the first real-account check of an installed Windows build.

The ten production-renderer browser suites passed **445 checks** with no JavaScript errors; the suites that record network requests saw none leave the page:

| Suite | 0.13.2 | 0.14.0 |
| --- | ---: | ---: |
| ui-smoke.py | 36 | 36 |
| ui-artifacts.py | 21 | 21 |
| ui-inline.py | 20 | 20 |
| ui-seamless.py | 17 | 17 |
| ui-editing.py | 21 | 21 |
| ui-responsive.py | 93 | 93 |
| ui-spacing.py | 112 | 112 |
| ui-activity.py | 32 | 32 |
| ui-account.py | 66 | 68 |
| ui-handoff.py | 25 | 25 |

## Android

The Android app keeps its behaviour: it has no store, so nothing is saved, and the sign-in profile is deleted when the app next starts. The shared account code changed, so the device checks ran as usual.

`tests/android-device.py` ran against the final APKs:

| Device image | Android System WebView | `--debug --live` | `--release` |
|---|---|---|---|
| Android 16 (API 36), Pixel 7 profile | 133.0.6943.137 | **40/40** | **13/13** |
| Android 14 (API 34), Pixel 6 profile | 113.0.5672.136 | **36/36** | **13/13** |

The counts equal those of 0.13.2; the debug counts differ because Android 16 runs the sign-in checks and Android 14 one refusal check instead, and the runs started 90 seconds after the emulators had booted.

- **Upgrade in place (Android 16).** The published, signed 0.13.2 APK (its SHA-256 matches the 0.13.2 release) was installed, a starter chosen and a draft typed through the on-screen keyboard. `adb install -r` then installed the signed 0.14.0 APK, which reported versionName 0.14.0. The draft and the starter choice written by 0.13.2 opened, and both persisted across a force-stop.
- **Phone.** Not used for this release.
- **Android 11** (API 30) was not rerun. In 0.12.0 the app refused its stock WebView as designed, and nothing that affects that check has changed.

## Not executed

- **Restoring a real sign-in** after a restart or an update (see above). With the installed app: sign in, quit, reopen; the account must be restored without the sign-in window.
- **Sign-in:** no sign-in with a real account ran for this release. Still open: the release-signed Android APK with a real account; additional sign-in methods on Windows; additional sign-in methods on Android; other phones, and WebViews between 113 and 133.
- **Live failure paths:** sign-out during a key exchange, an account or session change, 401, 402, 403 and 429 responses, and an inference rejection ran only as synthetic checks.
- **Windows hardware and configuration:** the silent install into a new folder and uninstall; the portable executable's own smoke output, which its launcher does not pass through; a clean, standard-user Windows machine; display scaling, high contrast, IME and the other manual items in [HANDOFF.md](HANDOFF.md); ARM64 Windows; code signing (not configured).
- **Android hardware and configuration:** physical devices, tablets and foldables, TalkBack, non-English system pickers, OEM WebViews; a downgrade install.
- **iOS** is not supported.

## Release artifacts

The release files were built from commit `4e3b5d2`. The tag commit adds only this record, the archived 0.13.2 record, the updated handoff checklist, README and ARCHITECTURE text, and refreshed screenshots and check records, none of which is packaged. The packaging, smoke, live packaged, upgrade and release-mode device checks ran on these exact files; the debug device checks used the debug APK built from the same commit.

| File | Bytes | SHA-256 |
|---|---:|---|
| `Tinfoil-Workbench-0.14.0-x64-Setup.exe` | 140,162,554 | `8ed3951079dcad00a6ee0d75645087c2680349197e463ef7fce0361826fb7f0b` |
| `Tinfoil-Workbench-0.14.0-x64-Portable.exe` | 139,937,708 | `d69f9bdd9236a3c3a3024228b028667a3e7637275710a305c3e75f03bfe6e1bd` |
| `Tinfoil-Workbench-0.14.0-android.apk` | 4,274,068 | `6a8284e3420b36e55efa0b8e5f5df4ca2c714e03560d0bd672d0947c72dd8dcc` |

The Windows files are not code-signed. The APK is signed with APK Signature Scheme v2, with the same release key as 0.13.2, and verified with `apksigner`. The signer's certificate SHA-256 is `6395ead797a520c632156abcd9ee2731869c64ed0ee510ad5b52e887185494cb`. The APK has versionName 0.14.0 and versionCode 14000, targets SDK 36 with minimum SDK 24, and requests the same two permissions as 0.13.2.

GitHub Actions passed all three workflows on commit `4e3b5d2`, in the pull request runs 36502335910 (Windows client, including the package check and the packaged app's smoke test), 36502336057 (Android client) and 36502336036 (renderer UI suites).
