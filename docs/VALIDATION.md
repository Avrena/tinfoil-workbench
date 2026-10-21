# Tinfoil Workbench 1.5.0 — validation record

Recorded 21 October 2026 for the 1.5.0 release, which adds remote agent jobs on a Linux host to the Windows app, with the host side in `remote/`, and moves Stop into Send's place in the shared composer. The record lists what ran and what did not run.

## Environment

- **Windows build machine:** Windows 11 Pro 10.0.26200 (x64), Node.js 24.21.0, Electron 44.4.5. Other work was running on the machine during the checks.
- **Dependencies:** `npm run bootstrap` ran at the build commit; the lockfile differs from 1.4.1 only in its version fields. `npm audit --omit=dev` reported no vulnerabilities in the runtime dependencies. `npm run doctor` passed all 32 entries, on its own and as part of `npm run dist:win`.
- **Emulators:** the Android 16 and Android 14 images were downloaded again (Google APIs, x86_64) and new Pixel 7 and Pixel 6 profiles created; their WebView versions match 1.4.1's.
- **Remote host:** a test Linux host administered by the maintainer, with Docker and the worker installed as [REMOTE-AGENT.md](REMOTE-AGENT.md) describes.

## Windows

The Windows, browser and Android checks below ran at the build commit `83f37fa`. They ran once before at `b6c83ed`, with the same results; that build was replaced after the CI failure described under [Continuous integration](#continuous-integration).

| Check | Result |
|---|---|
| `npm test` (strict build + Node tests) | **614 passed**, 0 failed, 1 skipped (a check that runs only outside Windows). The Node tests include the remote controller, worker and Chat session tests with mocked SSH and provider |
| `npm run dist:win` | Passed its doctor (32/32), test and native smoke gates, built the x64 NSIS installer and portable executable (unsigned), then `PACKAGE_CHECK_OK` (28 packaged modules) |
| Packaged app `release\win-unpacked\Tinfoil Workbench.exe --smoke-test` | `DESKTOP_SMOKE_OK`, including the attested SDK import, the workspace agent runner and the approval window |
| Packaged app, live enclaves (`check-packaged-provider.mjs`) | `PACKAGED_PROVIDER_OK`: Electron 44.4.5, the inference enclave's five verification steps and 16 models, then the sync enclave's five verification steps |

The twenty production-renderer browser suites passed **587 checks** with no JavaScript errors and no requests leaving the page. The twelve suites from 1.4.1 ran 534: ui-smoke 49, ui-artifacts 24, ui-inline 20, ui-seamless 18, ui-editing 26, ui-responsive 108, ui-spacing 121, ui-activity 49, ui-account 68, ui-handoff 25, ui-cloud 13, ui-charts 13. The eight Remote suites ran 53, with a synthetic controller and no SSH or inference: ui-remote 8, ui-remote-transcript 8, ui-remote-composer 8, ui-remote-availability 5, ui-shared-execution 9, ui-remote-polish 8, ui-stop-slot 3, ui-remote-sidebar 4. renderer.yml now runs all twenty.

## Remote host

These ran on the test host with the 1.5.0 host files, which match this commit byte for byte:

| Check | Result |
|---|---|
| `tests/remote-environments.py` | **18 passed**, no skips: dependency environments, cleanup boundaries, profile selection, operator guards, and the link handling of the controller's record writes (a planted link at the target, at the old temporary name or at a random temporary name is never written through; new records are mode 0600 under a permissive umask; Stop and the two ownership changes leave a link's target unchanged). The five link checks that apply to 1.5.0's change failed against the previous host files, as expected |
| `tests/remote-settings.py` | **5 passed** |
| `tests/remote-display.py` | **9 passed** |
| `tests/remote-environment-images.py` | Passed for the development and Kali images before the link change; the images are unchanged since |

During development, earlier builds ran real Tinfoil Chat subscription jobs on the test host: a job that created and checked a file, a job with custom system instructions and generation settings, a stopped command, a time limit, and a job that kept running while Workbench was closed and whose result appeared after reopening. The packaged development builds also passed native checks against the host with isolated profiles: adding and forgetting a host, the approval window showing the exact task and settings (cancelled), drafts and settings surviving a restart, and reading an existing job's transcript over SSH.

## Android

`tests/android-device.py` ran against the final APKs. Because other work was running on the machine, the emulators ran one at a time, each freshly booted and given a 150-second settle. Every run passed the first time.

| Device image | Android System WebView | `--debug --live` | `--release` |
|---|---|---|---|
| Android 16 (API 36), Pixel 7 profile | 133.0.6943.137 | **41/41** | **13/13** |
| Android 14 (API 34), Pixel 6 profile | 113.0.5672.136 | **36/36** | **13/13** |

- **Upgrade in place (Android 16), from 1.4.1.** The signed 1.4.1 release APK (its SHA-256 matches the [1.4.1 record](history/v1.4.1/VALIDATION.md#release-artifacts)) was installed and a draft typed through the on-screen keyboard, then the app was force-stopped. `adb install -r` installed the signed 1.5.0 APK, which reported versionName 1.5.0 and versionCode 1005000, and the draft written by 1.4.1 was still there.
- The release APK is signed with the release certificate (SHA-256 `63:95:EA:…:94:CB`).

## Not executed

- **Remote with the release build:** the 1.5.0 release build itself was not run against a real host, and no remote job ran with it; see above for the development builds.
- **A real account:** no live check with a real account ran in Chat for 1.5.0. Chat's code changes are the composer's Stop placement and the shared toolbar and transcript components, covered by the browser suites.
- **A phone:** 1.5.0 was not installed on a physical phone.
- **Installation:** no silent install over an installed copy ran, since the installer configuration is unchanged; see the [1.4.1 record](history/v1.4.1/VALIDATION.md#windows). A clean Windows, a standard-user Windows account and the portable executable were not run.
- Everything listed as not executed for [1.4.1](history/v1.4.1/VALIDATION.md#not-executed) and not checked above remains open.

## Release artifacts

The release files were built from commit `83f37fa`. The tag commit on top of it updates this record and the screenshots and check records from the final run of the browser suites, none of which is packaged.

| File | Bytes | SHA-256 |
|---|---:|---|
| `Tinfoil-Workbench-1.5.0-x64-Setup.exe` | 124,421,685 | `f7bcf91fe70f4af4e6672b9c037eb540dc57e96ec33794441f320758766d8a8a` |
| `Tinfoil-Workbench-1.5.0-x64-Portable.exe` | 124,196,932 | `beeda97f49fd5ad46a4b47ae1b1a926a0801e9b10d601db8f820a45972e23bf6` |
| `Tinfoil-Workbench-1.5.0-android.apk` | 4,604,741 | `ee4bd9fb82610431afd1b4cc678ccc240773b93cf244b6e3a372b33ce8120f67` |

The Windows files are not code-signed. The APK is signed with APK Signature Scheme v2, with the same release key as 1.4.1 (certificate SHA-256 `6395ead797a520c632156abcd9ee2731869c64ed0ee510ad5b52e887185494cb`), and has versionName 1.5.0 and versionCode 1005000.

## Continuous integration

GitHub Actions ran all three workflows on the pull request. On `1f42704`, the renderer job failed in `ui-responsive.py`: at 320px, with a remote host saved and the role tab shown, the role tab ended 1.2px past the composer edge, because the Linux browser's fallback font is wider than Segoe UI. Verdana reproduced it on Windows. `83f37fa` narrows the role buttons' padding when both tabs show on a narrow screen, which leaves 20px to spare with Verdana. On the build commit `83f37fa` the runs 39532582483 (Windows client), 39532582680 (Android client) and 39532582478 (renderer UI suites, all twenty) passed, and the Windows and Android runs kept their build copies.
