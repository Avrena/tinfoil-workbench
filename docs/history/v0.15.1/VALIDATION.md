# Tinfoil Workbench 0.15.1 — validation record

Recorded 29 September 2026 for the 0.15.1 release. It keeps a saved Tinfoil Chat sign-in on Windows when Tinfoil cannot be reached as Workbench starts. The record lists what ran, what failed on the way, and what did not run. The previous record is in [history/v0.15.0](../v0.15.0/VALIDATION.md).

## Environment

- **Windows build machine:** Windows 11 Pro 10.0.26200 (x64).
- **Toolchains, emulators and dependencies:** unchanged from 0.15.0. The lockfile differs only in its version field. A clean `npm run bootstrap` followed by `npm run doctor` passed all 28 entries. `npm audit --omit=dev` reports no known vulnerabilities; the full audit reports the same three moderate advisories in the dev-only `@capacitor/cli` → `xcode` → `uuid` chain as 0.15.0.

## The defect

After an unexpected shutdown, Workbench 0.15.0 was started while the network was still coming up. Restoring the saved sign-in needs Tinfoil's page within 30 seconds; when it is not reached, `restore()` keeps the saved sign-in as pending and shows the account as expired, as designed. Two gaps then led to a new sign-in:

- Nothing retried the saved sign-in except the next Chat request, so the Account view kept offering *Reconnect Tinfoil Chat* after the network was back.
- *Reconnect* runs the sign-in command, which signs out an expired account first. Signing out deletes `account-session.bin` and ends the Clerk session, so a session that was still valid was replaced by a new sign-in.

Which restore outcome occurred on that launch was not recorded: Workbench keeps no log of it. The network was still changing within the 30 seconds after the launch, and the other outcome, a session that Tinfoil ended, deletes the saved sign-in with a different message. Both writes of the saved files are atomic (a flushed temporary file, then a rename), and the key that protects them was unchanged.

The chat key for cloud sync is kept in the workspace and is unaffected by any of this: only *Remove chat key* removes it. Signing in again, or a deleted saved sign-in, does not.

## Checks

- `tests/account-remember.test.mjs` gains three tests, 16 in all. With an adapter that cannot reach Tinfoil until told to: the saved sign-in is retried on the timer until it is restored, and not after; signing out, turning the option off and quitting stop the retries; a retry that finds the session ended deletes the saved sign-in and stops. *Reconnect* while still offline keeps the saved sign-in and says so, restores it once Tinfoil is reachable without ending or deleting anything, and leads to a new sign-in only when the saved session has ended or there is none. Waking from sleep starts the backoff over. Removing the scheduled retry fails two of the tests.
- The browser suites' renderer preview is byte-identical to 0.15.0's; the Account view is unchanged apart from the message text that the host sends.

## Windows

| Check | Result |
|---|---|
| `npm test` (strict build + Node tests) | **418 passed**, 0 failed, 0 skipped: the 415 tests of 0.15.0 and the three new ones |
| `npm run dist:win` | Passed its doctor (28/28), test and native smoke gates, built the x64 NSIS installer and portable executable (unsigned), then `PACKAGE_CHECK_OK` (31 packaged modules) |
| Packaged app `release\win-unpacked\Tinfoil Workbench.exe --smoke-test` | `DESKTOP_SMOKE_OK`, including the attested SDK import; file version 0.15.1 |
| Packaged app, live enclaves (`check-packaged-provider.mjs`) | `PACKAGED_PROVIDER_OK`: the inference enclave's five verification steps and 17 models, then the sync enclave's five verification steps |
| Silent upgrade over an installed 0.15.0 | **Not run before publishing:** the installed 0.15.0 was in use. The installer configuration is unchanged since 0.12.1, and the same upgrade from 0.14.0 to 0.15.0 passed earlier the same day |

The eleven production-renderer browser suites passed **451 checks**, the same counts as 0.15.0, with no JavaScript errors and no requests leaving the page.

## Android

The Android app has no saved sign-in, so no restore is ever pending there and no retry is scheduled. `tests/android-device.py` ran against the final APKs:

| Device image | Android System WebView | `--debug --live` | `--release` |
|---|---|---|---|
| Android 16 (API 36), Pixel 7 profile | 133.0.6943.137 | **40/40** | **13/13** |
| Android 14 (API 34), Pixel 6 profile | 113.0.5672.136 | **36/36** | **13/13** |

- **Upgrade in place (Android 16).** The published, signed 0.15.0 APK (its SHA-256 matches the 0.15.0 release) was installed, a starter chosen and a draft typed through the on-screen keyboard. `adb install -r` then installed the signed 0.15.1 APK, which reported versionName 0.15.1. The draft and the starter choice written by 0.15.0 opened, and both persisted across a force-stop.
- **Phone.** Not used for this release.

## Not executed

- **The retry with a real account after a real outage or a slow network.** The checks simulate an unreachable Tinfoil. Still open from 0.15.0: staying signed in and cloud sync in the installed app with a real account.
- Everything else listed as not executed for [0.15.0](../v0.15.0/VALIDATION.md#not-executed) remains open.

## Release artifacts

The release files were built from commit `5954fb8`. The tag commit adds only this record, the archived 0.15.0 record and refreshed screenshots and check records, none of which is packaged.

| File | Bytes | SHA-256 |
|---|---:|---|
| `Tinfoil-Workbench-0.15.1-x64-Setup.exe` | 140,174,988 | `2ed3e3f349180cfdafd735facecaeafb52a00839e090ea7b69e40499f52ae521` |
| `Tinfoil-Workbench-0.15.1-x64-Portable.exe` | 139,950,224 | `8e400924332f4353daeca4c5b01c6f76b0fae196ff92651339b17fe29c58ac30` |
| `Tinfoil-Workbench-0.15.1-android.apk` | 4,281,741 | `981b302488a76e843f38ab87ea5d58021a95bbbb49adeed01078555881a491cf` |

The Windows files are not code-signed. The APK is signed with APK Signature Scheme v2, with the same release key as 0.15.0 (certificate SHA-256 `6395ead797a520c632156abcd9ee2731869c64ed0ee510ad5b52e887185494cb`), has versionName 0.15.1 and versionCode 15001, targets SDK 36 with minimum SDK 24, and requests the same two permissions.

GitHub Actions passed all three workflows on commit `5954fb8`, in the pull request runs 36511348437 (Windows client), 36511348568 (Android client) and 36511348429 (renderer UI suites).
