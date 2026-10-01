# Tinfoil Workbench 0.12.1 — validation record

Recorded 28 September 2026 for the 0.12.1 release, which completes Tinfoil Chat sign-in and key renewal on Windows. It lists what ran, what failed on the way, and what did not run. Synthetic checks, native Windows checks and checks against the live provider are listed separately. **The custom system prompt is optional and not required**: the live checks ran without custom instructions. The previous record is in [history/v0.12](../v0.12/VALIDATION.md).

## Environment

- **Windows build machine:** Windows 11 Pro 10.0.26200 (x64).
- **Toolchain:** Node.js 24.21.0 LTS with npm 11.19.0; Electron 44.4.3 (Chromium 152.0.7977.130), electron-builder 26.17.0, TypeScript 5.8.3, tinfoil 1.2.1, pdfjs-dist 5.4.149; Python 3.10 for the Python-runner tests; Playwright 1.63.0 with its bundled Chromium 153.0.8010.12 (build 1243) for the browser suites.
- **Android toolchain:** Temurin JDK 21.0.12.1, Android SDK platform 36 and build-tools 36.0.0, Capacitor 8.5.2, Android Gradle Plugin 8.13.0, Gradle 8.14.3.
- **Emulators:** Google APIs x86_64 system images, WHPX acceleration, headless with SwiftShader.

## Dependencies

- **No dependency changes** since 0.12.0; the lockfile differs only in its version field. A clean `npm run bootstrap` (npm ci plus the checksum-verified Electron binary) followed by `npm run doctor` passed all 27 entries.
- **Audit:** `npm audit --omit=dev` reports no known vulnerabilities. The full audit reports the same three moderate advisories as 0.12.0, in the dev-only chain `@capacitor/cli` → `xcode` → `uuid` (GHSA-w5hq-g745-h8pq), which is not shipped.

## Tinfoil Chat sign-in and key renewal

### Synthetic checks

`tests/account.test.mjs` runs `AccountSession`, `AccountWindow` and `WorkbenchService` against injected stand-ins: a Clerk page, a token endpoint with scripted responses and a controllable clock, Electron windows and SDK clients. It uses no network and no Electron. Its 64 tests (29 more than in 0.12.0) all pass. They establish:

- **Expiry:** a key needs an RFC 3339 `expires_at` with `Z` or an offset. A missing, malformed, zone-less or past time, or one less than 30 seconds away, is refused and the key is never used.
- **Clock skew:** a key's lifetime follows the response `Date` header when the local clock is wrong.
- **Reuse:** a cached key is reused only while more than 60 seconds remain, and never for more than an hour, even when it expires later. Before any reuse the website session is read again and must still have the bound user and Clerk session.
- **Exchange failures:** 401 gets one forced identity refresh and one repeated exchange, never a repeated generation. 401 again, or 403, requires a new sign-in; 402 keeps the identity. 429, or the hourly-limit code with any status, starts a cooldown that follows `resets_at` on the server's clock, then `Retry-After`, then 60 seconds, bounded to between 10 seconds and one hour; explicit refreshes are spaced 30 seconds apart. Network errors, 5xx, malformed bodies, responses over 64 KiB (declared or only streamed) and an exchange that hangs past 15 seconds leave access unavailable. The exchange is sent with `redirect: 'error'` and `cache: 'no-store'`.
- **Concurrency:** concurrent callers share one session read and one exchange. During a cooldown they send nothing.
- **Binding:** sign-in binds the Clerk user and session. Another session for the same user, a user or session change while an exchange is in flight, and a session read whose owner does not match are refused, and that exchange's result is discarded.
- **Sign-out and account change during a renewal:** a late token response cannot restore access or deliver the old key. Existing history needs approval under the new account.
- **Inference rejection:** a 401 or 403 from inference drops only that key and its client, keeps partial output and the identity, and the next send renews without replaying anything. A renewal between tool rounds replaces the client for that round only.
- **Ownership:** a Chat request refuses an SDK client minted for another account.
- **Sleep:** resume drops an expired cached key without a network request.
- **Sign-in window:** it opens `https://chat.tinfoil.sh/signin` and injects no sign-in script. A sign-in needs two agreeing session reads a second apart. A page that is loading or on another origin is not ready, never a sign-out. The host list governs the page, and a frame redirect cannot stall it; a refused host is reported by name. Google's country account hosts are allowed; other hosts on those domains and lookalikes are not.

**Mutation checks.** A script disabled one rule at a time in `desktop/account-session.mjs`, `desktop/account-window.mjs`, `desktop/service.mjs` and the compiled host policy, and ran the account tests after each of the 36 changes. Examples: accepting a missing expiry for 60 seconds, as 0.12.0 did; ignoring the `Date` header; reusing a key until its last second; removing the 401 refresh or treating 403 as unavailable; dropping the cooldown or the hourly-limit code; following redirects; removing the coalescing, the Clerk-session comparison or the identity read after an exchange; guarding frame redirects; refusing Google's country hosts. 34 made the matching test fail. The two that did not were the one-hour reuse cap and the 64 KiB limit on a streamed body: the only oversize case sent a key that `secret()` refuses anyway, and a constructed `Response` declares no length. Tests for both were added in `397a64e`. With them, those two changes, and removing the check on a declared length, each make a test fail.

`tests/ui-account.py` checks the production renderer's account view with synthetic snapshots: 66 checks, as in 0.12.0.

### Native Windows checks

The packaged and installed smoke checks in [Windows](#windows) cover storage, the bridge and printing, not sign-in. The sign-in window, the token exchange and renewal ran natively only in the live runs below, and those started Workbench from source, not from the packaged or installed app. Real system sleep and resume were not exercised.

### Live provider checks

`tests/account-live.mjs` started Workbench from source with Electron 44.4.3 (Chromium 152.0.7977.130) and Node 24.21.0 on Windows 10.0.26200, with a temporary profile. Sign-in was completed with a real Tinfoil account. The harness drove the real renderer, main process, sign-in window and SDK. It logs statuses, UTC times, counts, booleans and page hosts (with paths on Tinfoil's origin). Credentials were compared only in memory; none was printed, logged or saved. Each temporary profile was scanned, then deleted. No custom system prompt was set.

| Run | Code | Result |
|---|---|---|
| 1 | `7eb098e` | Signed in. The exchange returned 200 in 393 ms with a `Date` header and a key valid for 15 minutes; verification completed all five steps in 4.6 s. The harness then read the model list before it had loaded and stopped (fixed in the harness, `c466ad2`). |
| 2 | `c466ad2` | Sign-in remained stalled after an authentication step. This run did not yet log page hosts. |
| 3 | `232ff18` | The same stall. The log showed the page's navigation to `accounts.youtube.com` refused. |
| 4 | `963a85c` | The same stall; the page's navigation to `accounts.google.co.uk` was refused. |
| 5 | `5134a17` | Full run, below. The generic sign-in modal needed another action to continue the pending authentication step. |
| 6 | `203cbbe` | Quick run with Tinfoil's own sign-in page, below. The pending authentication step continued directly. |

**Run 5, full run (`5134a17`):**

- **Sign-in:** one interactive sign-in. The profile matched the binding, the Clerk session was bound, and the identity read after the exchange matched. The exchange returned 200 in 176 ms with a `Date` header, and the sign-in window was then hidden.
- **Verification:** all five steps in 3.1 s; 17 models.
- **Renewal through expiry:** the key in use expired at 15:28:16Z. A comparison of deepseek-v4-1-flash and gpt-oss-120b was sent at 15:28:36Z, 20 seconds later. One exchange (200, 382 ms) served both lanes and returned a different key (key changed: true) expiring at 15:43:36Z. One new SDK client was created for the new key and passed verification. No interactive sign-in occurred, and the sign-in window stayed hidden. Both replies completed.
- **Exposure:** 7 credentials (identity tokens and inference keys) were tracked in memory. None appeared in renderer content, in 49 renderer snapshots or in 14 vault writes. The temporary profile (53 files) held no JWT-shaped string and none of the tracked credentials.
- **Sign-out during a renewal:** the harness held a renewal's response and signed out. The 200 response arrived after sign-out and was discarded; the refresh ended with "The account operation was cancelled." The key, binding and SDK client were cleared, and the sign-in window was destroyed.
- **Send after sign-out:** refused with "Sign in to Tinfoil Chat in Account first. No API-key fallback is used."; nothing was sent or exchanged. This profile had no saved developer key; the synthetic checks cover one.

**Run 6, quick run (`203cbbe`, without the wait for expiry):** the sign-in page completed its redirects. No host was refused and no frame redirected outside the list. The binding and the identity read after the exchange matched. The exchange returned 200 in 399 ms with a `Date` header, verification took 4.5 s (17 models), and a send completed. The exposure checks (5 credentials, 30 snapshots, 7 vault writes) and the profile scan were clean, and sign-out during a renewal and the refused send behaved as in run 5.

The released code differs from `203cbbe` only in the Account view's session text and the version number, and the renewal code has not changed since `5134a17`. Every exchange whose timing was logged returned 200 in 176–399 ms, each sign-in exchange carried a `Date` header, and every key whose expiry was logged was valid for 15 minutes.

**Not covered live:** 401, 402, 403 and 429 responses and the hourly-limit code, none of which occurred; an account or session change during a renewal; an inference rejection; Stop during a Chat reply; Manage profile & security; real sleep and resume; additional sign-in methods; and sign-in from the packaged or installed app. The first group rests on the synthetic checks above; the rest remain open in [HANDOFF.md](HANDOFF.md).

### Security findings

- **Fixed in this release.** 0.12.0 accepted a token response without an expiry for 60 seconds, read a zone-less expiry as local time and measured expiry against the local clock. It bound a sign-in to the Clerk user only, so another session for that user, or a change during an exchange, went unnoticed. After a usage limit, the next request exchanged again. An inference 401/403 signed the account out.
- **Widened on purpose.** The page may now open `accounts.youtube.com` and `accounts.<domain>` for the 187 domains in Google's published list, because Google's sign-in moves the page through them at the end of its sign-in. No other host on those domains is allowed. Frame redirects are no longer checked against the host list, only against the partition's HTTPS rule, so a provider's cookie check cannot stall the page. Frames still have no bridge, and any navigation of the page itself is checked against the list.
- **Unchanged boundaries.** The sign-in window keeps a nonpersistent partition, no preload or Node, the sandbox, and denied permissions and downloads. Credentials stayed in the main process in every live run. No failure falls back to free access or to a developer key, and generation retries stay at zero.
- **Residual risks.** The token endpoint is taken from Tinfoil's open-source web and iOS clients, not from public API documentation ([ACCOUNT.md](../../ACCOUNT.md#source-contracts-inspected)). The adapter depends on Clerk's public page API on Tinfoil's site. Google or another provider may refuse sign-in in an embedded browser; Workbench does not change its user agent. Whether Tinfoil revokes keys already issued when the Clerk session ends was not tested; Workbench discards them locally.

## Windows

| Check | Result |
|---|---|
| `npm test` (strict build + Node tests) | At the build commit `0fea4c0`: **340 passed**, 0 failed, 0 skipped: the 313 tests of 0.12.0 plus 27 account tests. With the two tests of `397a64e`: **342 passed**. Python-runner cases ran against a real interpreter. |
| `npm run dist:win` | Passed its doctor (27/27), test and native smoke gates (`DESKTOP_SMOKE_OK: encrypted storage, bridge, native PDF print and PDF.js canvas`); built the x64 NSIS installer and portable executable (unsigned) |
| Packaged app `release\win-unpacked\Tinfoil Workbench.exe --smoke-test` | `DESKTOP_SMOKE_OK`; file version 0.12.1 |
| Silent per-user install (`/S /D=…`) → installed-app smoke → silent uninstall | Installed with an uninstall entry for 0.12.1 plus Start-menu and desktop shortcuts; the installed app printed `DESKTOP_SMOKE_OK`; uninstall removed the program files, the uninstall entry and both shortcuts |

The ten production-renderer browser suites passed **437 checks**, the same as 0.12.0, with no JavaScript errors and no external requests: ui-smoke 33, ui-artifacts 21, ui-inline 20, ui-seamless 17, ui-editing 21, ui-responsive 90, ui-spacing 112, ui-activity 32, ui-account 66 and ui-handoff 25.

## Android

Android has no Chat sign-in in this release and connects with a developer API key. A supported Android Google (OAuth) sign-in needs a provider contract that Tinfoil does not publish: a registered public client with PKCE, its redirect URIs, whether the token endpoint accepts OAuth access tokens, a scope for Chat access, a specification of the token endpoint, session lifetimes and revocation, and permission for third-party clients. [ANDROID.md](../../ANDROID.md#tinfoil-chat-sign-in) gives the details.

`tests/android-device.py` ran against the final APKs:

| Device image | Android System WebView | `--debug --live` | `--release` |
|---|---|---|---|
| Android 16 (API 36), Pixel 7 profile | 133.0.6943.137 | **33/33** | **13/13** |
| Android 14 (API 34), Pixel 6 profile | 113.0.5672.136 | **33/33** | **13/13** |

The 0.12.0 checks all still pass. That includes live enclave verification from the worker, where all five steps succeeded on both images and a deliberately invalid key was rejected with "API authentication was rejected". The debug build adds three checks:

- `account.login`, `account.refresh`, `account.signout` and a switch to Chat mode are refused with "Tinfoil Chat sign-in is not available in the Android app. Use a developer API key." The connection stays on the API key, and the account stays signed out.
- Back at the root sends the app to the background. Starting it again resumes the same process, page and unsent draft.
- After resuming, the host worker still reaches Tinfoil.

**Upgrade in place (Android 16).** The published, signed 0.12.0 APK was installed; a starter was chosen and a draft typed through the on-screen keyboard. `adb install -r` then installed the signed 0.12.1 APK, which reported versionName 0.12.1. The draft and the starter choice written by 0.12.0 opened, and both persisted across a force-stop.

Android 11 (API 30) was not rerun. In 0.12.0 the app refused its stock WebView as designed, and nothing that affects that check has changed.

## Not executed

- **Sign-in:** Apple, email-code, passkey, GitHub and Microsoft sign-in; sign-in from the packaged or installed app; another Windows machine or account.
- **Live failure paths:** provider 401, 402, 403 and 429 responses, the hourly-limit code, an inference rejection and an account change during a renewal ran only as synthetic checks.
- **Other account checks:** Manage profile & security, Stop during a Chat reply, delegation with a Chat account, and real system sleep and resume.
- **Windows hardware and configuration:** a clean, standard-user Windows machine (install, run and uninstall ran on the build machine); display scaling, high contrast, IME and the other manual items in [HANDOFF.md](HANDOFF.md); ARM64 Windows; code signing (not configured).
- **Android hardware and configuration:** Chat sign-in (Google needs a provider contract; Tinfoil's direct methods were not investigated for this release); physical Android devices, ARM hardware, tablets and foldables, TalkBack, non-English system pickers, OEM WebViews; a downgrade install from 0.12.1 to 0.12.0.
- **iOS** is not supported.

## Release artifacts

The release files were built from commit `0fea4c0`. The tag commit adds only two tests (`397a64e`), this record, the updated handoff checklist, refreshed screenshots and check records, none of which is packaged. The packaging, smoke, install and device checks above ran on these exact files; the live account runs used the source at the commits named.

| File | Bytes | SHA-256 |
|---|---:|---|
| `Tinfoil-Workbench-0.12.1-x64-Setup.exe` | 139,399,440 | `b1a262d871cb01a0781af239c6ce1e912d040cbc0c650193573df809f135d7fb` |
| `Tinfoil-Workbench-0.12.1-x64-Portable.exe` | 139,174,581 | `a4705194965ae8b77096129ceea8e9f1c3fc65bc76611b4d4c532d88d821f043` |
| `Tinfoil-Workbench-0.12.1-android.apk` | 4,239,797 | `c9a128d6f32eed33d5f2ab7297951d878b79559aafc6430d888e0183e191c65e` |

The Windows files are not code-signed. The APK is signed with APK Signature Scheme v2, with the same release key as 0.12.0, and verified with `apksigner`. The signer's certificate SHA-256 is `6395ead797a520c632156abcd9ee2731869c64ed0ee510ad5b52e887185494cb`. The APK has versionName 0.12.1 and versionCode 12001, targets SDK 36 with minimum SDK 24, and requests the same two permissions as 0.12.0.

GitHub Actions passed all three workflows on commit `0fea4c0`, in the pull request runs 36447865162 (Windows client), 36447865183 (Android client) and 36447865218 (renderer UI suites).
