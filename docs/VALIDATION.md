# Tinfoil Workbench 1.4.1 — validation record

Recorded 2 October 2026 for the 1.4.1 release, the first release from the public repository. Workbench is now licensed under the Apache License 2.0: 1.4.1 adds `LICENSE`, changes the licence fields of `package.json` and `package-lock.json`, and rewrites `NOTICE.md` and the README's licence section. The application code (`src/`, `desktop/`, `mobile/`, `android/`) is unchanged since 1.4.0, so this record covers the build, packaging, installation and update checks; the live checks with a real account are those of [1.4.0](history/v1.4.0/VALIDATION.md#with-a-real-account). The record lists what ran and what did not run.

## Environment

- **Windows build machine:** Windows 11 Pro 10.0.26200 (x64). Other work was running on the machine during the checks.
- **Toolchains, emulators and dependencies:** unchanged from 1.4.0. `npm run bootstrap` ran on this source tree before the version change; the lockfile differs from 1.4.0 only in its version and licence fields, and the Android Gradle files are unchanged. `npm run doctor` passed all 32 entries as part of `npm run dist:win`.

## What changed and how it was checked

- **Licence.** `LICENSE` is the unmodified Apache License 2.0 text (SHA-256 `cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30`, compared with the copy at apache.org). `package.json` and `package-lock.json` say `Apache-2.0`; `package.json` keeps `"private": true`, so the package cannot be published to npm by accident.
- **Notices.** `NOTICE.md`, which is packaged, states the licence and copyright, keeps the third-party and trademark notices, and describes the appearance presets as colour values only.
- **Package.** `app.asar` holds the same 28 modules as 1.4.0; the electron-builder configuration is unchanged apart from the version.

## Windows

| Check | Result |
|---|---|
| `npm test` (strict build + Node tests) | **583 passed**, 0 failed, 1 skipped (a check that runs only outside Windows) |
| `npm run dist:win` | Passed its doctor (32/32), test and native smoke gates, built the x64 NSIS installer and portable executable (unsigned), then `PACKAGE_CHECK_OK` (28 packaged modules) |
| Packaged app `release\win-unpacked\Tinfoil Workbench.exe --smoke-test` | `DESKTOP_SMOKE_OK`, including the attested SDK import, the workspace agent runner and the approval window |
| Packaged app, live enclaves (`check-packaged-provider.mjs`) | `PACKAGED_PROVIDER_OK`: Electron 44.4.5, the inference enclave's five verification steps and 17 models, then the sync enclave's five verification steps |
| Silent install (`Setup.exe /S /currentuser`) over an installed 1.4.0 | Exit 0. The installed executable and its uninstall entry report 1.4.1, and its `app.asar` is byte-identical to the build's. The installed app's `--smoke-test` printed `DESKTOP_SMOKE_OK`, and `check-packaged-provider.mjs` run by the installed executable printed `PACKAGED_PROVIDER_OK` with both enclaves. The app data folder held 78 files before and after; every file was unchanged by SHA-256 across the install, and the files at its top across the checks too |

The twelve production-renderer browser suites passed **533 checks** with no JavaScript errors and no requests leaving the page, as for 1.4.0: ui-smoke 49, ui-artifacts 24, ui-inline 20, ui-seamless 18, ui-editing 26, ui-responsive 107, ui-spacing 121, ui-activity 49, ui-account 68, ui-handoff 25, ui-cloud 13, ui-charts 13.

## Android

`tests/android-device.py` ran against the final APKs. Because other work was running on the machine, the emulators ran one at a time, each freshly booted and given a 150-second settle. Every run passed the first time.

| Device image | Android System WebView | `--debug --live` | `--release` |
|---|---|---|---|
| Android 16 (API 36), Pixel 7 profile | 133.0.6943.137 | **41/41** | **13/13** |
| Android 14 (API 34), Pixel 6 profile | 113.0.5672.136 | **36/36** | **13/13** |

- **Upgrade in place (Android 16), from 1.4.0.** The signed 1.4.0 release APK (its SHA-256 matches the [1.4.0 record](history/v1.4.0/VALIDATION.md#release-artifacts)) was installed and a draft typed through the on-screen keyboard; 1.4.0 kept it across a force-stop. `adb install -r` then installed the signed 1.4.1 APK, which reported versionName 1.4.1 and versionCode 1004001. The draft written by 1.4.0 opened and persisted across another force-stop.
- The release APK is signed with the release certificate (SHA-256 `63:95:EA:…:94:CB`).

## Not executed

- **A real account:** no live check with a real account ran for 1.4.1; the application code is unchanged since 1.4.0, whose live checks are in [its record](history/v1.4.0/VALIDATION.md#with-a-real-account).
- **A phone:** 1.4.1 was not installed on a physical phone.
- **A clean Windows:** not repeated, since the installer configuration is unchanged; see the [1.0.0 record](history/v1.0.0/VALIDATION.md#a-clean-windows). A standard-user Windows account was not used, and the portable executable was not run.
- Everything listed as not executed for [1.4.0](history/v1.4.0/VALIDATION.md#not-executed) and not checked above remains open.

## Release artifacts

The release files were built from commit `d4efdb9`. The tag commit adds this record, the archived 1.4.0 record and handoff checklist, and documentation updates, none of which is packaged.

| File | Bytes | SHA-256 |
|---|---:|---|
| `Tinfoil-Workbench-1.4.1-x64-Setup.exe` | 124,398,297 | `02d6a94bb5aef44d8ca7b938eff215cbb387a15fcdd6467a40fadbb918e28167` |
| `Tinfoil-Workbench-1.4.1-x64-Portable.exe` | 124,173,461 | `fd8ebb359d12e2957f50475fe695a2907e41ad33d7b4ac103a5d3f4eda2e4dfd` |
| `Tinfoil-Workbench-1.4.1-android.apk` | 4,561,881 | `32388cd3ca04a32d6e0f4654b3339f2be7ae8709c0568a157d00887225cea72d` |

The Windows files are not code-signed. The APK is signed with APK Signature Scheme v2, with the same release key as 1.4.0 (certificate SHA-256 `6395ead797a520c632156abcd9ee2731869c64ed0ee510ad5b52e887185494cb`), has versionName 1.4.1 and versionCode 1004001, targets SDK 36 with minimum SDK 24, and requests the same two permissions.

GitHub Actions ran all three workflows on the pull request. On the build commit `d4efdb9` the runs 36946130381 (Windows client), 36946130369 (Android client) and 36946130384 (renderer UI suites) passed, and the Windows and Android runs kept their build copies.
