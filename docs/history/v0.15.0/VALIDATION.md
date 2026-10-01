# Tinfoil Workbench 0.15.0 — validation record

Recorded 29 September 2026 for the 0.15.0 release. It adds two-way sync with Tinfoil Chat's cloud chats and projects to the Windows app. The record lists what ran, what failed on the way, and what did not run. The previous record is in [history/v0.14.0](../v0.14.0/VALIDATION.md).

## Environment

- **Windows build machine:** Windows 11 Pro 10.0.26200 (x64).
- **Toolchain (unchanged from 0.14.0):** Node.js 24.21.0 LTS with npm 11.19.0; Electron 44.4.3 (Chromium 152.0.7977.130), electron-builder 26.17.0, TypeScript 5.8.3, tinfoil 1.2.1, pdfjs-dist 5.4.149, zod 4.6.5; Python 3.10 for the Python-runner tests; Playwright 1.63.0 with its bundled Chromium 153.0.8010.12 (build 1243) for the browser suites.
- **Android toolchain (unchanged):** Temurin JDK 21.0.12.1, Android SDK platform 36 and build-tools 36.0.0, Capacitor 8.5.2, Android Gradle Plugin 8.13.0, Gradle 8.14.3, androidx.webkit 1.14.0.
- **Emulators:** Google APIs x86_64 system images, WHPX acceleration, headless with SwiftShader.

## Dependencies

- **No dependency changes** since 0.14.0; the lockfile differs only in its version field. Cloud sync uses the attested client of the tinfoil SDK that inference already uses. A clean `npm run bootstrap` followed by `npm run doctor` passed all 28 entries.
- **Audit:** `npm audit --omit=dev` reports no known vulnerabilities. The full audit reports the same three moderate advisories as 0.14.0, in the dev-only chain `@capacitor/cli` → `xcode` → `uuid` (GHSA-w5hq-g745-h8pq), which is not shipped.

## Tinfoil cloud chats and projects

With a chat key added under Account → Tinfoil cloud chats, the Windows app lists the account's cloud chats and projects, loads a chat's messages when it is opened, and writes continued, renamed, edited, moved and deleted cloud chats back. The key is sent only to the sync enclave (`sync.tinfoil.sh`) through the SDK's attested client, verified against `tinfoilsh/confidential-sync`. Writes name the version they were made against; if a chat changed in Tinfoil meanwhile, the cloud version wins and Workbench's version is kept as a local copy. [CLOUD.md](../../CLOUD.md) describes the design and [SECURITY.md](../../../SECURITY.md) its boundaries.

### Checks

- `tests/cloud.test.mjs` (9 tests): key parsing in both forms, grouping messages into turns, mapping chats and projects, write-back fidelity (an unchanged chat is unchanged; unknown fields are kept; edits, new turns, renames and long chats), project context and validation.
- `tests/cloud-sync.test.mjs` (16 tests): the sync engine against an in-memory enclave with the same version rules (the key check, listing and loading, write-back, conflicts before and during a write, re-sealed rows, deletions on both sides, uploads, another account, a changed key, the 300-chat limit, removing the key); the service commands; the client's wire format over the attested channel only; sync refusals reported as such; chat IDs in Tinfoil Chat's format; the key ID against a WebCrypto HKDF derivation; and the Android worker's imports, which must not reach the cloud modules.
- `tests/ui-cloud.py` (6 checks), a new browser suite: the Account section signed out, signed in and connected (a masked key field that is cleared after use, sync state, counts, the listing limit, errors and the key ID, never the key), sidebar markers for cloud chats and projects, the loading state, and *Move to Tinfoil cloud* only for local conversations.
- The packaged-app gate `scripts/check-packaged-provider.mjs` now also verifies the sync enclave through the packaged cloud client (see Windows).

### Live check with a real account

`tests/cloud-live.mjs` ran the app from source with a temporary profile against the maintainer's Tinfoil account, which has cloud sync set up. The tester signed in and added the chat key in the Account view; the harness logged statuses and counts only.

- **First sync:** the account's cloud chats and projects, one of them with instructions, and their documents were listed. The workspace snapshot did not contain the key.
- **Fidelity, read-only:** the 10 most recent chats (1 to 4 turns) were opened. For each, writing it back unchanged was computed from a fresh pull: all messages and all top-level fields were kept exactly, and the loaded version matched the pulled one. Nothing was written.
- **The first run stopped at the upload** of its test chat. Workbench requested a chat ID from `api.tinfoil.sh/api/chats/generate-id`, which Tinfoil Chat's current client no longer uses: it makes IDs itself, a 13-digit reverse timestamp, an underscore and a random UUID. The request failed with an HTTP status that Workbench reported as a model rejection, because `publicError` read any 400, 404 or 422 as one. Nothing had been written. Commit `ec92a0e` makes IDs locally in that format and reports sync errors as the sync service's.
- **The second run, on `ec92a0e`,** continued with the first run's profile. The saved sign-in was restored at launch, within about a second and without the sign-in window, and the chat key came from the encrypted workspace. It then repeated the first sync and the fidelity check with the same results, and took a new test chat through its whole life, confirming each step by pulling the row again:
  - one short message (DeepSeek V4.1 Flash, 64 tokens at most) and *Move to Tinfoil cloud*: version 1, 2 messages, the title and the writer ID matched;
  - rename: version 2, the new title with `titleState: manual`;
  - a second short message: version 3, 4 messages in the order user, assistant, user, assistant, and Workbench's link at the same version;
  - delete, confirmed in the app's dialog: the row answered `NOT_FOUND`, and the conversation was gone locally.
- **At the end** no file in the profile contained the key, its base64 form or a session token in plaintext, and the account was signed out, which deleted the saved sign-in. The profile was then deleted.

The live check ran from source on `ec92a0e`. The later commits add the sync enclave to the packaged-app check, the version and, in `117a0d1`, move the construction of the sync engine from the shared service to the Windows entry point (see Android). The installed app was not run with a real account.

## Staying signed in

The 0.14.0 record listed the restore of a real sign-in as not checked. The second live run above restored a real Tinfoil Chat session saved by the first run, after that app had quit, from source. The installed app was not checked with a real account: the installed 0.14.0 had no saved sign-in when it was upgraded.

## Windows

| Check | Result |
|---|---|
| `npm test` (strict build + Node tests) | **415 passed**, 0 failed, 0 skipped: the 390 tests of 0.14.0, 9 in `tests/cloud.test.mjs` and 16 in `tests/cloud-sync.test.mjs`. Python-runner cases ran against a real interpreter. |
| `npm run dist:win` | Passed its doctor (28/28), test and native smoke gates, built the x64 NSIS installer and portable executable (unsigned), then `PACKAGE_CHECK_OK` (31 packaged modules) |
| Packaged app `release\win-unpacked\Tinfoil Workbench.exe --smoke-test` | `DESKTOP_SMOKE_OK`, including the attested SDK import; file version 0.15.0 |
| Packaged app, live enclaves (`check-packaged-provider.mjs`) | `PACKAGED_PROVIDER_OK`: the inference enclave's five verification steps and 17 models, then the sync enclave's five verification steps through the packaged cloud client |
| Silent upgrade over an installed 0.14.0 (`Setup.exe /S /currentuser`) | Exit 0. The installed executable and its uninstall entry report 0.15.0. The installed app's `--smoke-test` printed `DESKTOP_SMOKE_OK`, and `check-packaged-provider.mjs` run by the installed executable against its own `app.asar` printed `PACKAGED_PROVIDER_OK` with both enclaves. The existing app data (55 files) was unchanged by SHA-256, and the Start menu and desktop shortcuts still point to the installed app |
| Silent install into a new folder and uninstall | **Not repeated.** The installer configuration is unchanged since 0.12.1, where this check passed |
| Opening a 0.15.0 workspace in 0.14.0 | 0.14.0's workspace validation, taken from the installed 0.14.0, opens a 0.15.0 workspace with cloud chats, a cloud project and a chat key, and drops the cloud links and the key. It refuses a workspace with more than 300 conversations, the 0.14.0 limit |

The eleven production-renderer browser suites passed **451 checks** with no JavaScript errors; the suites that record network requests saw none leave the page. They ran on commit `117a0d1`; its renderer preview is byte-identical to the one built from `abceed7`, where the suites also passed.

| Suite | 0.14.0 | 0.15.0 |
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
| ui-cloud.py | — | 6 |

## Android

The Android app has no cloud sync. Its worker bundles the shared service with a crypto shim that provides only `randomUUID`, so the first 0.15.0 APK build failed: the service imported the sync engine, which reaches Node's `hkdfSync`. Commit `117a0d1` moves the engine's construction to the Windows entry point, so the cloud modules are not in the worker, and adds a test of the worker's imports.

`tests/android-device.py` ran against the final APKs:

| Device image | Android System WebView | `--debug --live` | `--release` |
|---|---|---|---|
| Android 16 (API 36), Pixel 7 profile | 133.0.6943.137 | **40/40** | **13/13** |
| Android 14 (API 34), Pixel 6 profile | 113.0.5672.136 | **36/36** | **13/13** |

The counts equal those of 0.14.0; the debug counts differ because Android 16 runs the sign-in checks and Android 14 one refusal check instead, and the runs started 90 seconds after the emulators had booted.

- **Upgrade in place (Android 16).** The published, signed 0.14.0 APK (its SHA-256 matches the 0.14.0 release) was installed, a starter chosen and a draft typed through the on-screen keyboard. `adb install -r` then installed the signed 0.15.0 APK, which reported versionName 0.15.0. The draft and the starter choice written by 0.14.0 opened, and both persisted across a force-stop.
- **Phone.** Not used for this release.
- **Android 11** (API 30) was not rerun. In 0.12.0 the app refused its stock WebView as designed, and nothing that affects that check has changed.

## Not executed

- **Cloud sync in the installed app** with a real account, and on the final build commit; the live check ran from source on `ec92a0e`.
- **Cloud sync cases not reached by the live check:** a conflict with a real concurrent edit in Tinfoil Chat, a chat deleted in Tinfoil Chat while Workbench has unwritten changes, moving a chat between real cloud projects, a new conversation in a real cloud project, chats with images or attachments written back, project documents near their size limits, more than 300 cloud chats, a key rotated in Tinfoil Chat, and sync while another account is signed in. These ran only against the in-memory enclave.
- **Staying signed in with the installed app:** sign in, quit and reopen; and a restore after an update.
- **Sign-in:** apart from the live cloud check (Chat sign-in on Windows, from source), no sign-in with a real account ran for this release. Still open: the release-signed Android APK with a real account; additional sign-in methods on Windows; additional sign-in methods on Android; other phones, and WebViews between 113 and 133.
- **Live failure paths:** sign-out during a key exchange or a sync, an account or session change, 401, 402, 403 and 429 responses, and an inference rejection ran only as synthetic checks.
- **Windows hardware and configuration:** the silent install into a new folder and uninstall; the portable executable's own smoke output, which its launcher does not pass through; a clean, standard-user Windows machine; display scaling, high contrast, IME and the other manual items in [HANDOFF.md](HANDOFF.md); ARM64 Windows; code signing (not configured).
- **Android hardware and configuration:** physical devices, tablets and foldables, TalkBack, non-English system pickers, OEM WebViews; a downgrade install.
- **iOS** is not supported.

## Release artifacts

The release files were built from commit `117a0d1`. The tag commit adds only this record, the archived 0.14.0 record, the updated handoff checklist, README, ARCHITECTURE and CHANGELOG text, and refreshed screenshots and check records, none of which is packaged. The packaging, smoke, live packaged, upgrade and release-mode device checks ran on these exact files; the debug device checks used the debug APK built from the same commit.

| File | Bytes | SHA-256 |
|---|---:|---|
| `Tinfoil-Workbench-0.15.0-x64-Setup.exe` | 140,174,386 | `a366d48c2eb420792862b89fa023c7cec60c2d3862a75b9e12a4c7e9e87e62a2` |
| `Tinfoil-Workbench-0.15.0-x64-Portable.exe` | 139,949,520 | `e753a89233033dbeff1723c5100208088ba71be09f890f276534ce2645c2f577` |
| `Tinfoil-Workbench-0.15.0-android.apk` | 4,281,521 | `26cf17e2bc03616b22ef9b71de5ae0645c712b94be06f5761668b58907ba80b9` |

The Windows files are not code-signed. The APK is signed with APK Signature Scheme v2, with the same release key as 0.14.0, and verified with `apksigner`. The signer's certificate SHA-256 is `6395ead797a520c632156abcd9ee2731869c64ed0ee510ad5b52e887185494cb`. The APK has versionName 0.15.0 and versionCode 15000, targets SDK 36 with minimum SDK 24, and requests the same two permissions as 0.14.0.

GitHub Actions passed all three workflows on commit `117a0d1`, in the pull request runs 36507936493 (Windows client, including the package check and the packaged app's smoke test), 36507936638 (Android client, whose build includes the worker bundle) and 36507936489 (renderer UI suites, now eleven).
