# Tinfoil Workbench 1.4.0 — validation record

Recorded 1 October 2026 for the 1.4.0 release. Conversations can be tagged, by hand or by a short request to a model that also writes a title; tags have colours, styles and icons, filter and group the sidebar, and travel with Tinfoil cloud chats in their encrypted data. The hidden page that keeps the Tinfoil Chat sign-in on Windows is no longer slowed down while out of view. The record lists what ran, what failed on the way, and what did not run. The previous record is in [history/v1.3.0](history/v1.3.0/VALIDATION.md).

## Environment

- **Windows build machine:** Windows 11 Pro 10.0.26200 (x64). Other work was running on the machine during the checks.
- **Toolchains, emulators and dependencies:** unchanged from 1.3.0. The lockfile differs only in its two version fields, so `npm run bootstrap` was not repeated, and the Android Gradle files are unchanged. `npm run doctor` passed all 32 entries as part of `npm run dist:win`.

## With a real account

The manual live checks ran from source in Electron with a temporary profile; the tester signed in to Tinfoil Chat for each run, and each run signed out at its end.

**Tagging (`tests/tags-live.mjs`).** Each run had DeepSeek V4.1 Flash answer a set of first messages, then asked every chat model in Tinfoil's catalog to tag and title them, then ran the behaviour checks: a renamed conversation keeps its name, titles off writes no title, a tag added to the list is used, tags chosen by hand win over a running suggestion, **Tag untagged conversations** asks first with the count and an estimate and tags each conversation once, **Stop** ends the queue, and a declined confirmation sends nothing. The behaviour checks passed in every run. Whether a tag fits was judged by reading each conversation.

| Run, at | Set | Finding | Change |
|---|---|---|---|
| 1, a669621 | 13 conversations | Token use was counted several times over: Tinfoil's router repeats the cumulative usage on every streamed chunk. DeepSeek V4.1 Flash titled some English messages in Spanish, French or Chinese | 8872844 counts usage once per request, asks for a title in the message's language and sets temperature 0 when the model does not think |
| 2, 8872844 | 13 | Llama 3.3 70B returned its one-object JSON answer, when streamed, as two empty chunks finishing with `tool_calls` and no call, also with `tool_choice: "none"`; the same request not streamed returned the answer | 3d3faff asks for the answer whole instead of streamed |
| 3, 3d3faff | 13 | Every model answered. Tags that fit, out of 13: Kimi K3 13; DeepSeek V4.1 Flash, Gemma 4, GLM-5.3 Flash and GLM-5.3 12; gpt-oss-120b 11; Llama 3.3 70B 8. Models often added a second tag for a detail or a possible use | e6cb196 asks for a second tag only when the conversation is mainly about it too |
| 4, e6cb196 | 13 | Tags per model fell from 16–20 to 12–15 over the 13 conversations. DeepSeek V4.1 Flash still titled an English message about a budget in euros in Spanish, at temperature 0 every time | — |
| 5, 20d94bd | 18, with the five new presets | The new presets (Travel, Legal, Cyber, NSFW, Ambiguous) were chosen where they fit. The Spanish title remained | 40c2f23 has the model name the message's language before the title |
| 6, 40c2f23 | 18 | Every title in the message's language. Tags that fit, out of 18: DeepSeek V4.1 Flash, Gemma 4, GLM-5.3 Flash and GLM-5.3 18; Kimi K3 17; gpt-oss-120b 16; Llama 3.3 70B 14 | — |

A tagging request took about 500–700 input and 20–30 output tokens; the six runs, answers included, used about 540,000 tokens.

**Tinfoil cloud chats.**

| At | Check | Result |
|---|---|---|
| 40c2f23, with the field check uncommitted | Sign in, add the chat key, sync | Adding the chat key failed once with "Tinfoil sign-in did not respond", and the first sync then timed out. Electron throttled the hidden sign-in page: twenty chained 50 ms timers took 22 s in a window hidden for 10 s and over 90 s after six minutes, against 4.2 s and 1.2 s unthrottled. Fixed in e152366 (`backgroundThrottling: false`) |
| e152366 | The same | The key was added and the first sync finished 25 seconds after sign-in. The check then stopped before writing anything, because its test chat had no model; fixed in the harness (0f73df5) |
| 0f73df5 (`tests/cloud-field-live.mjs`) | A test chat with an extra top-level field, renamed by the tester in Tinfoil Chat on the web | The field was still there after the web's write (version 1 to 2); the web added its own fields and dropped a null `projectId`. The test chat was then deleted from the cloud and the workspace |

Tags of cloud chats themselves (8d39365) were checked with the in-memory enclave below, not between two installs with a real account.

**Phone.** The release-signed 1.4.0 APK, installed over the release-signed 1.3.0 holding a saved sign-in, opened without Tinfoil's sign-in page and showed the enclave verified.

## What changed and how it was checked

- **Tags.** `src/core/tags.ts` (the list, presets, icons, the request and the answer). `tests/tags.test.mjs` covers workspaces from before tags, the list's validation (names, colours, styles, icons), the presets and their looks, the first letter shown for a tag without an icon, what the request contains and when it is sent, lenient answers that keep only listed tags and a short single-line title, the language field, titles that may be replaced, branches, exports and imports, the bulk question, `#name` search, every theme's tag colours, the service queue (the first answer tagged without tools, a chosen model, a renamed conversation, tags chosen by hand, wrong answers, tool calls and cut-short answers not retried, **Tag untagged conversations** and Stop, refusals that never cross accounts) and the request sent whole.
- **Tags of cloud chats.** `src/core/tags.ts` (`cloudTagsValue`, `readCloudTags`), `src/core/cloud.ts` (`cloudTagsPatch`) and `desktop/cloud-sync.mjs`. `tests/cloud-sync.test.mjs` runs the sync engine against the in-memory enclave: tags read from the cloud with tags the list lacks added, tags-only writes that keep the messages and `updatedAt`, a newer cloud version taken without a Workbench copy, tags waiting to be written kept over the cloud's, tags written with a rename, chats tagged before tags were synced, new cloud chats, and a later format left alone; the service test covers the tag commands reaching the cloud. The sync rules were broken on purpose in turn, and a test failed for each; a content write that dropped the tags at first went unnoticed, so the rename test now changes the tags too.
- **The hidden sign-in page.** `desktop/account-window.mjs`; `tests/account.test.mjs` checks that background throttling is off.
- **Renderer.** `tests/ui-smoke.py` gains seven checks for tags: Settings → Tags (colours, styles, adding, renaming, a refused duplicate name, removing and restoring presets), a first answer tagged and titled, the tags dialog, the sidebar's tag row with `#name` search and grouping, the five chip styles in light and dark, a sidebar row's tag button with **New tag** and **Remove all**, and icons or first letters at phone width with the icon picker in Settings.
- **Package.** `app.asar` holds the same 28 modules as 1.3.0; the electron-builder configuration is unchanged apart from the version.

## Windows

| Check | Result |
|---|---|
| `npm test` (strict build + Node tests) | **583 passed**, 0 failed, 1 skipped (a check that runs only outside Windows) |
| `npm run dist:win` | Passed its doctor (32/32), test and native smoke gates, built the x64 NSIS installer and portable executable (unsigned), then `PACKAGE_CHECK_OK` (28 packaged modules) |
| Packaged app `release\win-unpacked\Tinfoil Workbench.exe --smoke-test` | `DESKTOP_SMOKE_OK`, including the attested SDK import, the workspace agent runner and the approval window |
| Packaged app, live enclaves (`check-packaged-provider.mjs`) | `PACKAGED_PROVIDER_OK`: Electron 44.4.5, the inference enclave's five verification steps and 17 models, then the sync enclave's five verification steps |
| Silent install (`Setup.exe /S /currentuser`) over an installed review build of 1.4.0 (built from 8d39365, before the version change, so it reported 1.3.0) | Exit 0. The installed executable and its uninstall entry report 1.4.0, and its `app.asar` is byte-identical to the build's. The installed app's `--smoke-test` printed `DESKTOP_SMOKE_OK`, and `check-packaged-provider.mjs` run by the installed executable printed `PACKAGED_PROVIDER_OK` with both enclaves. The app data folder held 78 files before and after; every file was unchanged by SHA-256 across the install, and the files at its top across the checks too |

The twelve production-renderer browser suites passed **533 checks** with no JavaScript errors and no requests leaving the page: ui-smoke 49, ui-artifacts 24, ui-inline 20, ui-seamless 18, ui-editing 26, ui-responsive 107, ui-spacing 121, ui-activity 49, ui-account 68, ui-handoff 25, ui-cloud 13, ui-charts 13. Seven more than 1.3.0, all in ui-smoke, for tags.

## Android

`tests/android-device.py` ran against the final APKs. Because other work was running on the machine, the emulators ran one at a time, each freshly booted and given a 150-second settle. Every run passed the first time.

| Device image | Android System WebView | `--debug --live` | `--release` |
|---|---|---|---|
| Android 16 (API 36), Pixel 7 profile | 133.0.6943.137 | **41/41** | **13/13** |
| Android 14 (API 34), Pixel 6 profile | 113.0.5672.136 | **36/36** | **13/13** |

- **Upgrade in place (Android 16), from 1.3.0.** The published, signed 1.3.0 APK (its SHA-256 matches the release) was installed and a draft typed through the on-screen keyboard; 1.3.0 kept it across a force-stop. `adb install -r` then installed the signed 1.4.0 APK, which reported versionName 1.4.0 and versionCode 1004000. The draft written by 1.3.0 opened and persisted across another force-stop.
- The release APK is signed with the release certificate (SHA-256 `63:95:EA:…:94:CB`).

## Not executed

- **Tags between two installs:** a cloud chat's tags were not checked between two Workbench installs with a real account; the sync engine's handling of them was checked against the in-memory enclave. Tinfoil Chat on the web was checked to keep an extra field when it renames a chat, not when it continues one.
- **A phone:** tags were checked neither on real Android hardware nor by the emulator checks; their phone layout was checked in the browser suites at phone width.
- **A clean Windows:** not repeated, since the installer configuration is unchanged; see the [1.0.0 record](history/v1.0.0/VALIDATION.md#a-clean-windows). A standard-user Windows account was not used, and the portable executable was not run.
- Everything listed as not executed for [1.3.0](history/v1.3.0/VALIDATION.md#not-executed) and not checked above remains open.

## Release artifacts

The release files were built from commit `07ea332`. The tag commit adds this record, the archived 1.3.0 record and handoff checklist, and documentation updates, none of which is packaged.

| File | Bytes | SHA-256 |
|---|---:|---|
| `Tinfoil-Workbench-1.4.0-x64-Setup.exe` | 124,398,739 | `c8d9638f0b4a4fb820e96f6cb0f7c58593a7b88e5d9210edd2af32403cc24bdc` |
| `Tinfoil-Workbench-1.4.0-x64-Portable.exe` | 124,173,905 | `a196c5b21674d4982087f513b1b9dbbd923fe082634c9639056b5affc3391d1a` |
| `Tinfoil-Workbench-1.4.0-android.apk` | 4,562,101 | `4561750a3c060a1f0420014c74e960f8947b14d483cbe45d329ca30e1477903c` |

The Windows files are not code-signed. The APK is signed with APK Signature Scheme v2, with the same release key as 1.3.0 (certificate SHA-256 `6395ead797a520c632156abcd9ee2731869c64ed0ee510ad5b52e887185494cb`), has versionName 1.4.0 and versionCode 1004000, targets SDK 36 with minimum SDK 24, and requests the same two permissions.

GitHub Actions ran all three workflows on the pull request. On the build commit `07ea332` the runs 36902037678 (Windows client), 36902037760 (Android client) and 36902037575 (renderer UI suites) passed, and the Windows and Android runs kept their build copies.
