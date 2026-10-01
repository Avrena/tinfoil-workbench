# Tinfoil Workbench 1.2.0 — validation record

Recorded 30 September 2026 for the 1.2.0 release. An edited message, Retry, and an edited answer or thinking text now make versions inside the conversation, switched with ‹ n/m › arrows, instead of new conversations in the sidebar. Answers and their thinking are edited where they are shown, assistant and system messages can be added from a tab on the composer (off by default), and the thinking effort slider follows a drag. On Android phones the title bar is gone, and the Tinfoil sign-in is kept across restarts and updates, sealed with an Android Keystore key. The record lists what ran, what failed on the way, and what did not run. The previous record is in [history/v1.1.0](../v1.1.0/VALIDATION.md).

## Environment

- **Windows build machine:** Windows 11 Pro 10.0.26200 (x64). Other work was running on the machine during the checks.
- **Toolchains, emulators and dependencies:** unchanged from 1.1.0. The lockfile differs only in its two version fields, so `npm run bootstrap` was not repeated, and the Android Gradle files are unchanged: the cookie reader used to stay signed in (`CookieManagerCompat`) comes from the `androidx.webkit` library the app already included. `npm run doctor` passed all 28 entries as part of `npm run dist:win`. `npm audit --omit=dev` reports no known vulnerabilities in the runtime dependencies; the full audit reports the same moderate advisory as for 1.1.0 (`uuid` below 11.1.1, through `xcode` in `@capacitor/cli`, a development tool for iOS projects that is not packaged).
- **Phone:** Android 15, Android System WebView 153, 360 CSS pixels wide, with the release-signed 1.2.0 APK installed over review builds of 1.2.0.

## With a real account

Performed with a real Tinfoil account on review builds of 1.2.0 and on the release build, all on the phone. Review builds are builds of this branch made before its last commits; each row names what the review found and what was accepted.

| Where | Check | Result |
|---|---|---|
| Phone, review builds | Retry and an edited message, then the arrows between their versions | Worked, each version in its place |
| | The title bar | Gone on the phone, as asked |
| | Editing an answer and its thinking | A resize grip, both fields open at once and the composer below them were reported; one field at a time, where it is shown, with the composer hidden, was accepted |
| | The reply's actions beside the version arrows | They ran past the edge of the screen and the Branch icon looked clipped; icons without words in one row, with a redrawn Branch icon, were accepted |
| | Adding messages in other roles | The switch could not be found in Settings, then in Advanced on the phone, and the role choice used the system's select list; a tab on the composer's top edge was accepted |
| | The thinking effort panel | It stood apart from the composer, then did not reach its edge, and the thumb jumped between levels; the panel on the composer's edge, across it on a phone, with a thumb that follows the finger, was accepted |
| | Stay signed in: sign in, force-stop, open again | Opened signed in without Tinfoil's page, verified the enclave, and a message was answered |
| Phone, release-signed 1.2.0 installed over a review build holding a saved sign-in | Opening the app after the update | Signed in, without Tinfoil's page |
| Phone, release-signed 1.2.0 | A system message added with the System tab in the middle of a conversation, asking the model to refuse the next question, then that question | The model's reasoning referred to the added message, and the model answered anyway. The message went out as a system message at its place; whether a model follows one is the model's decision |

## What changed and how it was checked

- **Versions.** `src/core/versions.ts` keeps the version shown in `thread.turns` and sets the others aside on the turn where they part (`Turn.versions`), at most 50 per point and 2,000 stored turns. Versions of a point are grouped by their message (role, text and files): arrows on a message switch between its wordings, each showing its latest answer, and arrows on a reply switch between the answers to the same message. Only the version shown is sent to a model, exported as Markdown and written to a Tinfoil cloud chat; the JSON export keeps all of them. `tests/versions.test.mjs` covers Retry and edited messages as versions, switching between them both ways, versions deeper in a set-aside path, validation and limits, a branch from the path shown, the history sent, the service doing all of this in one conversation, and a Tinfoil cloud chat: rewritten from a changed point with the path shown, and keeping its versions for unchanged turns when read again. `tests/ui-editing.py` covers an edited message, Retry and the arrows.
- **Editing in place.** `src/renderer/inline-editor.ts` mounts one field in the drawn reply: the answer in place of its text, or the thinking inside its Reasoning box, with Save and Cancel in place of the reply's actions, and the composer hidden meanwhile. `tests/ui-editing.py` covers each field, the composer leaving and returning, and an edit whose reply leaves the page; `tests/ui-responsive.py` checks that the reply's actions and arrows fit one row at 360 pixels.
- **Messages in other roles.** They are sent in their role at their place in the history (`buildHistory`). The service refuses them in Tinfoil cloud chats and projects and when a conversation holding them would be uploaded (`tests/versions.test.mjs`). `tests/ui-editing.py` covers the tab on the composer's edge, its keyboard use and a system message added without a request; `tests/ui-cloud.py` covers the tab in a cloud chat. Earlier versions cannot open a workspace that holds such messages and drop set-aside versions when they save; the changelog says so.
- **Composer.** `tests/ui-artifacts.py` drags the effort thumb with a mouse and `tests/ui-responsive.py` with a touch: the thumb stays under the pointer, names the nearest level, and settles on it when released. They also check that the panel stands on the composer's top edge, spans it on a phone and follows it as it grows.
- **Android title bar.** `tests/ui-responsive.py` checks that Android shows no title bar up to 600 pixels wide and keeps it at 800.
- **Staying signed in on Android.** The worker saves the persistent cookies of Tinfoil's sign-in hosts with the user and Clerk session they belong to; native code seals the record with AES-GCM under a Keystore key that is never released, in no-backup storage, and restores it into a fresh, hidden profile at launch, used only for the same user and session. `tests/android-account.test.mjs` (eight new tests) covers the cookie filter, the sealed store, a restore without Tinfoil's page, a record bound to another session being deleted, a restore that cannot reach Tinfoil keeping the record, turning the option off, and signing out. `tests/android-device.py` checks the switch on the emulator and that nothing is saved before a sign-in. The design is in [ANDROID-ACCOUNT.md](../../ANDROID-ACCOUNT.md#staying-signed-in-120).
- **Package.** `app.asar` holds the same 28 modules as 1.1.0; the electron-builder configuration is unchanged apart from the version.

## Windows

| Check | Result |
|---|---|
| `npm test` (strict build + Node tests) | **488 passed**, 0 failed, 0 skipped |
| `npm run dist:win` | Passed its doctor (28/28), test and native smoke gates, built the x64 NSIS installer and portable executable (unsigned), then `PACKAGE_CHECK_OK` (28 packaged modules) |
| Packaged app `release\win-unpacked\Tinfoil Workbench.exe --smoke-test` | `DESKTOP_SMOKE_OK`, including the attested SDK import |
| Packaged app, live enclaves (`check-packaged-provider.mjs`) | `PACKAGED_PROVIDER_OK`: Electron 44.4.5, the inference enclave's five verification steps and 17 models, then the sync enclave's five verification steps |
| Silent install (`Setup.exe /S /currentuser`) over an installed review build of 1.2.0, itself installed over 1.1.0 | Exit 0. The installed executable and its uninstall entry report 1.2.0, and its `app.asar` is byte-identical to the build's. The installed app's `--smoke-test` printed `DESKTOP_SMOKE_OK`, and `check-packaged-provider.mjs` run by the installed executable printed `PACKAGED_PROVIDER_OK` with both enclaves; these checks left the files at the top of the app data folder unchanged by SHA-256. The app data folder held the same number of files before and after the install; their contents were not compared across it |

The twelve production-renderer browser suites passed **504 checks** with no JavaScript errors and no requests leaving the page: ui-smoke 37, ui-artifacts 24, ui-inline 20, ui-seamless 18, ui-editing 26, ui-responsive 107, ui-spacing 121, ui-activity 32, ui-account 68, ui-handoff 25, ui-cloud 13, ui-charts 13. Twenty-eight more than 1.1.0, for versions, editing in place, messages in other roles, the Android title bar, the reply's actions on a phone and the effort slider.

## Android

`tests/android-device.py` ran against the final APKs. Because other work was running on the machine, the emulators ran one at a time, each freshly booted and given a 150-second settle.

| Device image | Android System WebView | `--debug --live` | `--release` |
|---|---|---|---|
| Android 16 (API 36), Pixel 7 profile | 133.0.6943.137 | **41/41** | **13/13** |
| Android 14 (API 34), Pixel 6 profile | 113.0.5672.136 | **36/36** | **13/13** |

- **Upgrade in place (Android 16), from 1.1.0.** The published, signed 1.1.0 APK (its SHA-256 matches the release) was installed and a draft typed through the on-screen keyboard; 1.1.0 kept it across a force-stop. `adb install -r` then installed the signed 1.2.0 APK, which reported versionName 1.2.0 and versionCode 1002000. The draft written by 1.1.0 opened and persisted across another force-stop.

## Not executed

- **A clean Windows:** not repeated, since the installer configuration is unchanged; see the [1.0.0 record](../v1.0.0/VALIDATION.md#a-clean-windows). A standard-user Windows account was not used.
- **The portable executable:** built but not started.
- **The review on Windows:** review builds were installed on Windows, but the interface review was made on the phone; the browser suites cover the same renderer at desktop sizes.
- **Versions in a Tinfoil cloud chat with a real account:** covered by the cloud sync tests only.
- **Staying signed in on the phone, further:** the account key's renewal after a restored sign-in has been open for 15 minutes, signing out, and turning the option off were not checked on the phone; the tests above cover them.
- Everything listed as not executed for [1.1.0](../v1.1.0/VALIDATION.md#not-executed) and not checked above remains open.

## Release artifacts

The release files were built from commit `3024788`. The tag commit adds only this record, the archived 1.1.0 record and handoff checklist, documentation updates and refreshed screenshots and check records, none of which is packaged.

| File | Bytes | SHA-256 |
|---|---:|---|
| `Tinfoil-Workbench-1.2.0-x64-Setup.exe` | 124,325,371 | `83b2ac9992cc9bf94cbc02f95fed2ea0bd85d6f1c6ad561dddf3d42a963f5a17` |
| `Tinfoil-Workbench-1.2.0-x64-Portable.exe` | 124,100,516 | `b7a3de85465bd42a1eaac05c3191f3530e59facd67ac0411327cc6087a653ae3` |
| `Tinfoil-Workbench-1.2.0-android.apk` | 4,462,511 | `2fc0bee465be671ca13a070ab0490001d43ed439b7adfd7cbdca48ad2a39b3a5` |

The Windows files are not code-signed. The APK is signed with APK Signature Scheme v2, with the same release key as 1.1.0 (certificate SHA-256 `6395ead797a520c632156abcd9ee2731869c64ed0ee510ad5b52e887185494cb`), has versionName 1.2.0 and versionCode 1002000, targets SDK 36 with minimum SDK 24, and requests the same two permissions.

GitHub Actions ran all three workflows on commit `3024788` in the pull request runs 36668587934 (Windows client), 36668587954 (Android client) and 36668587919 (renderer UI suites); all three passed. The Windows and Android runs could not keep their build copies: the repository's artifact storage quota was full, and the upload step is allowed to fail, so GitHub reported it as passed.
