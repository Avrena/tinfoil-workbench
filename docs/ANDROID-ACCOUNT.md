# Android Chat account access: investigation and design

**Status: released in 0.13.0.** Route A below is implemented, with email-and-password sign-in on Tinfoil's own page ([Implementation](#implementation)). It has been checked with a real account on one phone, and on emulators ([Checks](#checks)). This document also records the investigation behind that choice.

Google OAuth requires a supported native/browser integration and cannot use an embedded website adapter. Tinfoil's direct account methods are a separate candidate. Whether a given account can use them, how to isolate the authentication view, how to store its session and how to deliver credentials from native code to the host worker have not been validated.

## Status by method

| Method | Status | Basis |
|---|---|---|
| Google sign-in (OAuth) | Not available in any embedded view. It needs a supported native/browser integration, such as a Custom Tab or the system browser with a callback registered for Workbench, which Tinfoil does not publish ([ANDROID.md](ANDROID.md#tinfoil-chat-sign-in)). | Google forbids its OAuth authorization in "an embedded user-agent under the developer's control" and has blocked Android WebViews since 30 September 2021 with `disallowed_useragent`. |
| Apple sign-in (OAuth) | Not proposed for the embedded view, which would refuse its hosts. No Apple policy on embedded views was checked; it would need its own investigation. | — |
| Email and password | Implemented. The instance has password sign-in enabled. Whether an account has a password is account-specific: one created with Google has none until the user sets one in Tinfoil's profile page. | Tinfoil's page calls `signIn.password({ identifier, password })`; its password field is always shown on the email step. |
| Email code | Not offered for an existing account. The instance lists `email_code` as a first factor, but Tinfoil's email form always asks for a password; its first-step emailed code appears only when resuming a Google or Apple sign-in. | `signIn.emailCode.sendCode()` only in the social-sign-in resume path. |
| Second factor | Handled entirely by Tinfoil's page. The instance offers TOTP and backup codes as second factors. The page's second step, which handles both `needs_second_factor` and `needs_client_trust`, also has an emailed-code path. | `signIn.mfa.verifyTOTP`, `verifyBackupCode`, `sendEmailCode` / `verifyEmailCode`. |
| Passkeys, phone | Not enabled on Tinfoil's instance. | Instance configuration. |
| Key renewal | Implemented: `AccountSession` runs unchanged in the host worker. | Windows implementation; `tests/android-account.test.mjs`. |
| Session storage | Implemented as proposed below: a fresh profile per sign-in, deleted at the next launch (checked on the emulator). Since 1.2.0, staying signed in keeps a sealed copy of the session between launches ([Staying signed in](#staying-signed-in-120)). | AndroidX WebKit sources; `tests/android-device.py`. |
| Credential delivery | Implemented as proposed below; the port handover works on WebView 133 (Android 16 emulator). | `mobile/bridge.mjs`, `mobile/account.mjs`, `WorkbenchAccount.java`. |

The instance facts come from Tinfoil's public Clerk configuration (`https://clerk.tinfoil.sh/v1/environment`, which every browser loads for the sign-in page), retrieved 28 September 2026: password and `email_code` first factors, `totp` and `backup_code` second factors, Google and Apple enabled, passkeys and phone numbers disabled, no second factor required by the instance, and no CAPTCHA configured.

## Route A: Tinfoil's page in a separate authentication view

A separate Activity, not `BridgeActivity`, owns its own WebView and shows the real `https://chat.tinfoil.sh/signin`. The Workbench page, its WebView and its network limits stay as they are.

- **No bridge.** The authentication WebView has no JavaScript interface, web-message listener or document-start script; file and content access, downloads, multiple windows, permissions and geolocation are off. WebView debugging is process-wide, so it stays enabled only in debug builds. The Activity is not exported.
- **Navigation.** The page itself may load only Tinfoil's sign-in hosts (`chat.tinfoil.sh`, `clerk.tinfoil.sh`, `accounts.tinfoil.sh`). Google and Apple buttons lead to hosts that are refused, with a message that those methods are not available in the Android app. Sub-resources are HTTPS only.
- **Scripts.** Only fixed, host-initiated scripts run: the session read, the identity read and sign-out from `desktop/account-window.mjs`, with the exact-origin check before and after, and user, session and generation checks. The user types a password or code only into Tinfoil's page; Workbench never reads form fields, and no password, MFA code or recovery code appears in Workbench code or logs.
- **Sign-in completes** after two agreeing session reads, as on Windows.

### Session storage

Facts (AndroidX WebKit 1.14 sources, retrieved 28 September 2026):

- Android WebView has no in-memory profile. Named profiles (`ProfileStore.getOrCreateProfile`, `WebViewCompat.setProfile`, feature `MULTI_PROFILE`) each keep their own cookies and web storage, on disk.
- `ProfileStore.deleteProfile` throws while any WebView uses the profile, and also for a profile already loaded in the current process with `getOrCreateProfile` or `getProfile`. Some data may be deleted only after it returns. A profile can therefore be deleted only at the next process start, before it is loaded.
- A separate process with its own data directory (`ProcessGlobalConfig.setDataDirectorySuffix`) is the other isolation mechanism. Its storage is also on disk, and it needs inter-process messaging to reach the main process.
- The app already disables backup and device transfer (`allowBackup="false"`, `fullBackupContent="false"` and data-extraction rules).

Policy, accepted by the maintainer on 28 September 2026:

- Each sign-in uses a fresh profile name. At app start, before any profile is loaded, every non-default profile is deleted, so a sign-in is not remembered across launches, as on Windows.
- Sign-out ends the Clerk session (best-effort), clears the profile's cookies and web storage, and destroys the WebView; the profile itself is deleted at the next launch.
- If `MULTI_PROFILE` is unsupported, Chat sign-in is unavailable and the app stays on API keys.

This is weaker than the Windows partition, which never writes the website session to disk. On Android, the Tinfoil website session, including Clerk's client cookie, is in app-private storage while signed in, and after a crash or force-stop it stays there until the next launch. Accepting that, or not offering Android account access, is the decision to make. Still to measure: what the profile writes, whether clearing and deleting removes all of it, and behavior when the process dies during sign-in.

### Credential delivery

Facts:

- `mobile/bridge.mjs` `runNative()` receives every plugin result in the main document and then posts it to the worker. A Chat key or Clerk session token returned by a plugin method would be readable in the renderer's realm. (The vault data key from `keyUnwrap` and a typed API key already pass through the main document once.)
- The key endpoint answers a CORS preflight from `https://localhost` with `Access-Control-Allow-Origin: *` and allows `Authorization`, so the worker could call it. Its responses expose only `X-Format-Version`, `Ehbp-Response-Nonce` and two `X-Backoffice-*` headers, so the worker could not read `Date` or `Retry-After`, which are not CORS-safelisted. The renewal rules depend on them for clock skew and usage-limit waits.

Proposed design:

- **A private channel.** At page start, native code creates a message channel (`WebViewCompat.createWebMessageChannel`, feature `CREATE_WEB_MESSAGE_CHANNEL`) and posts one port to the main frame with target origin `https://localhost` (`postWebMessage`, feature `POST_WEB_MESSAGE`). `mobile/bridge.mjs`, which runs before the renderer, transfers that port to the worker without reading from it; afterwards the main document no longer holds it. Native code issues one port per page load, ignores further requests, and invalidates it when the page reloads.
- **Fixed operations only** over that port: `login`, `readSession`, `identity`, `clear`, and a fixed key exchange. For the exchange, native code sends `GET https://api.tinfoil.sh/api/chat/token` with the bearer it is given, without following redirects, with a 15-second timeout and a 64 KiB limit, and returns the status, `Date`, `Retry-After` and body. There is no general URL fetch and no general script evaluation.
- **The worker runs `AccountSession` unchanged**, with an adapter and fetcher backed by the port. That keeps the user and Clerk-session binding, the identity read after each exchange, UTC expiry measured on the server clock, the 60-second margin and one-hour cap, the shared exchange, cooldowns and stale-result cancellation. The Clerk session token and the Chat key exist only in native memory and in the worker; the renderer receives snapshots only.
- **`runNative()` never carries account credentials.** A `getChatToken()`-style plugin method is ruled out.

Needs a device experiment, on WebView 133 (emulator) and 153 (phone): that a port posted by native code can be transferred to a dedicated worker and still works; its timing relative to the start of `bridge.mjs`; and behavior after reload and process death. If the main document were compromised before the handover, it could keep the port. The handover happens before any conversation content is rendered, which limits but does not remove that risk.

### Lifecycle

On resume without process death, the worker would call `AccountSession.resume()` from the app's resume event, which drops an expiring key. After process death the in-memory key is gone and, under the storage policy above, the next launch deletes the profile, so the user signs in again, unless the sign-in was saved (next section).

### Staying signed in (1.2.0)

Signing in again after every update or restart was the main cost of the policy above. Keeping a sealed copy of the website session between launches was accepted by the maintainer on 30 September 2026, since Tinfoil's website keeps a browser signed in the same way. *Stay signed in on this phone* (Account → Session & local workspace) is on by default, as on Windows.

- **What is saved.** `AccountSession` runs unchanged with a store (`nativeAccountStore` in `mobile/account.mjs`). After sign-in, after each session read (WebView reports no cookie changes, and Clerk may rotate its client cookie while issuing a token) and when the app is paused, it saves the persistent cookies of `chat.tinfoil.sh`, `clerk.tinfoil.sh` and `accounts.tinfoil.sh`, with their attributes as `CookieManagerCompat.getCookieInfo` reports them, and the user and Clerk session IDs they belong to. Session cookies, account tokens and inference keys are never saved. The worker validates the record in both directions (`savedSignIn`); anything unexpected discards all of it.
- **How it is sealed.** The record crosses the private port only. Native code seals it with AES-GCM under a 256-bit key that Android Keystore generates and never releases (`tinfoil-workbench-account-v1`, randomized encryption required), and writes it to `no_backup/account-session.bin` through a temporary file; plaintext never reaches storage, and backup and device transfer stay off. A file that fails to decrypt or validate is deleted.
- **Restore.** At launch, earlier sign-in profiles are still deleted before any is loaded. The worker then asks for the sealed record, and native code opens Tinfoil's page hidden, in a fresh profile holding the saved cookies (only for the three hosts above, and only printable cookie strings). The session is used only if it belongs to the saved user and Clerk session; an ended or changed one deletes the saved sign-in and closes the page without ending that Clerk session. If Tinfoil cannot be reached, the record is kept and the restore is tried again, as on Windows.
- **Ending it.** Signing out ends the Clerk session and deletes the record; turning the option off deletes it. While a sign-in is saved, a page reload closes the page without ending its Clerk session, as a force-stop or an update always did, so the next launch can restore it.
- **Exposure.** While the app runs, the session is in the profile's private storage as before. Between launches, only the sealed record remains: it can be read by this app on this phone while its Keystore key exists, not from a copy of the file alone. Uninstalling the app deletes both.
- **Needs WebView support** for `GET_COOKIE_INFO`; without it nothing is saved and the app signs in again after a restart.

## Implementation

- **`WorkbenchAccount.java`** adds Tinfoil's page as a separate WebView over the app, not a `BridgeActivity`: Back and a native Cancel close it, and it stays alive, hidden, after sign-in, so the page's Clerk session keeps issuing identity tokens. It has no JavaScript interface, web-message listener or document-start script, and each sign-in gets a fresh `account-…` profile. `MainActivity` deletes earlier profiles at start-up, before any is loaded, and a reload of the Workbench page closes the channel and clears the website session.
- **Fixed page scripts.** They are Java text blocks that mirror `desktop/account-window.mjs`. `tests/android-account.test.mjs` checks that they match the desktop scripts and runs them against a stand-in Clerk page. `evaluateJavascript` does not await promises, so the asynchronous scripts leave their result in a one-time page global that a fixed collect script takes; the page already holds that data.
- **The channel.** `mobile/bridge.mjs` calls `Workbench.accountChannel()` at start, after registering its Back, pause and resume listeners: a Back press is dropped until its listener is registered, and requesting the channel first made that window long enough to lose a Back press right after launch on a slow device. Native code posts one port with `postWebMessage` to `https://localhost`. The bridge accepts only a message with no source window, stops its propagation and transfers the port to the host worker, which waits at most 5 seconds and ignores later account messages. AndroidX wraps a port in a new object for every callback, so the native side identifies the channel by number.
- **The worker.** `mobile/account.mjs` provides the channel, `NativeAccountWindow` (the `AccountSession` adapter) and `nativeFetcher`, which turns the native exchange result into a `Response`. `mobile/commands.mjs` runs the desktop account commands, and the snapshot's `chatAvailable` tells the renderer whether this WebView supports sign-in.
- **The exchange** uses `HttpsURLConnection` with no redirects, 15-second timeouts and at most 64 KiB + 1 byte read, and returns the status, `Date`, `Retry-After`, `Content-Length` and body.

## Checks

Recorded 28 September 2026 with the debug build of this code.

**Real account, one phone** (Android 15, arm64, Android System WebView 153), a Tinfoil account, signed in on Tinfoil's page. A harness drove the app over DevTools and logged only statuses, UTC times, counts and booleans:

- Sign-in completed 56 seconds after the page opened. Chat access was active, the sign-in screen closed by itself, and enclave verification passed all five steps (17 models).
- A message completed in 1.2 seconds.
- **Renewal after expiry:** the key in use expired at 19:10:17Z. A message sent after that got a new key, expiring at 19:25:37Z, and completed in 3.9 seconds, with no sign-in screen and no interactive sign-in.
- **Background and resume:** the same process resumed in the foreground, and a message completed.
- **Exposure:** no JWT-shaped string in the Workbench page (DOM, localStorage, sessionStorage, window property names), in snapshots, or in the Workbench page's storage and app files (32 files). The sign-in profile existed while signed in.
- **Sign-out:** the native confirmation appeared and was confirmed on the phone; the account was signed out, and a message afterwards was refused with no API-key fallback.
- **Restart:** the sign-in profile was gone.

**Release-signed builds, same phone (0.17.1 and 0.17.2):** a sign-in with the signed 0.17.1 APK and one with a signed 0.17.2 test build were each followed by the automatic enclave check, with nothing chosen, and by messages with tool calls ([the 0.17.2 record](history/v0.17.2/VALIDATION.md#model-test-on-a-phone)). After each in-place update the app was signed out, as after any restart. The same phone signed in the same way with the release-signed 0.18.0 and 0.18.1 APKs, again without a renewal or sign-out. With the release-signed 1.0.0 APK it signed in, sent a message after the key had expired and renewed, without signing in again, and signed out.

**Emulators, without credentials:** Android 16 (WebView 133) passed the debug device checks, including the five sign-in checks (Tinfoil's page on its own screen and profile, Google refused with the reason shown and reported, Cancel, no port or JWT-shaped string in the Workbench page, profile deleted at the next launch), and the release checks. Android 14 (WebView 113) lacks the needed WebView features: the app refused sign-in with the "newer Android System WebView" message and kept the API key, as designed.

**Not covered:** sign-out while a key exchange is in flight, account or session changes, 401/402/403/429 responses and inference rejection on Android (the shared `AccountSession` tests cover them); other phones and WebViews; renewal after expiry, background and resume, and sign-out in a release-signed build; additional sign-in methods.

## Route B: Clerk's Android SDK

Clerk's Android SDK supports password, email-code, TOTP and backup-code sign-in without an OAuth callback. OAuth needs a registered callback. The SDK requires the instance's Native API, which "opens a public request pathway that bypasses browser-based CAPTCHA challenges", and production instances use the app's registered namespace and package name to validate hosted-flow callbacks.

Using it would make Workbench a native client of Tinfoil's Clerk instance, with Tinfoil's publishable key and outside Tinfoil's page. Unknown: whether Tinfoil's instance enables the Native API for clients other than its own apps, whether Tinfoil permits a third-party native client, how the SDK persists sessions, and whether sessions created that way are accepted by the key endpoint. Tinfoil's iOS app uses Clerk's native SDK; that does not establish that Workbench's Android app is supported. This route is not pursued without Tinfoil's agreement.

## Next steps

1. **Account check.** In Tinfoil's own sign-in page, see which direct methods the existing account offers (a password, an email code, and which second factor). Do not create another account or reset the password for this.
2. **Storage decision.** Accept or reject the storage policy above.
3. **Prototype in a debug build.** Authentication Activity, profile handling and the port handover, with tests of the refused hosts, the port boundary and cleanup.
4. **Acceptance with a real account.** One exchange, attested inference, a request after the first key expires, background and resume, sign-out while a renewal is pending, and scans of the main document and of storage for credentials. Record results by method; untested methods stay labelled untested.

## Sources

Retrieved 28 September 2026.

- Google OAuth 2.0 policies, "Use secure browsers": https://developers.google.com/identity/protocols/oauth2/policies
- Google Developers Blog, OAuth in embedded webviews: https://developers.googleblog.com/upcoming-security-changes-to-googles-oauth-20-authorization-endpoint-in-embedded-webviews/
- Tinfoil sign-in page: https://github.com/tinfoilsh/tinfoil-webapp/blob/6869354445d9e273b090bbf5fcd1c711e901bc2d/src/pages/signin.tsx
- AndroidX WebKit `Profile`, `ProfileStore`, `ProcessGlobalConfig`, `WebViewCompat`: https://github.com/androidx/androidx/tree/androidx-main/webkit/webkit/src/main/java/androidx/webkit and https://developer.android.com/reference/androidx/webkit/ProfileStore
- Android guidance on WebView native bridges: https://developer.android.com/privacy-and-security/risks/insecure-webview-native-bridges
- Clerk Android quickstart and authentication: https://clerk.com/docs/android/getting-started/quickstart and https://clerk.com/docs/android/reference/native-mobile/auth
- Fetch standard, CORS-safelisted response headers: https://fetch.spec.whatwg.org/#cors-safelisted-response-header-name
