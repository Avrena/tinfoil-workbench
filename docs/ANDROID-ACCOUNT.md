# Android Chat account access: investigation and design

**Status: not implemented.** The Android app connects with a developer API key. This document records what is known about signing in to a Tinfoil Chat account on Android, the candidate routes, and the boundaries an implementation must meet before it ships. Nothing here has been built or tested on a device unless it says so. The custom system prompt is optional and not required on every route.

Google OAuth requires a supported native/browser integration and cannot use an embedded website adapter. Tinfoil's direct account methods are a separate candidate. Whether a given account can use them, how to isolate the authentication view, how to store its session and how to deliver credentials from native code to the host worker have not been validated.

## Status by method

| Method | Status | Basis |
|---|---|---|
| Google sign-in (OAuth) | Not available in any embedded view. It needs a supported native/browser integration, such as a Custom Tab or the system browser with a callback registered for Workbench, which Tinfoil does not publish ([ANDROID.md](ANDROID.md#tinfoil-chat-sign-in)). | Google forbids its OAuth authorization in "an embedded user-agent under the developer's control" and has blocked Android WebViews since 30 September 2021 with `disallowed_useragent`. |
| Apple sign-in (OAuth) | Not proposed for the embedded view, which would refuse its hosts. No Apple policy on embedded views was checked; it would need its own investigation. | — |
| Email and password | Candidate, untested. The instance has password sign-in enabled. Whether a particular account has a password is account-specific: an account created with Google may have none. | Tinfoil's page calls `signIn.password({ identifier, password })`; its password field is always shown on the email step. |
| Email code | Candidate, untested. The instance lists `email_code` as a first factor and Tinfoil's page has an email-code path. When the page offers it for a given account must be seen in the page. | `signIn.emailCode.sendCode()` / `verifyCode()`. |
| Second factor | Candidate, untested, handled entirely by Tinfoil's page. The instance offers TOTP and backup codes as second factors. The page's second step, which handles both `needs_second_factor` and `needs_client_trust`, also has an emailed-code path. | `signIn.mfa.verifyTOTP`, `verifyBackupCode`, `sendEmailCode` / `verifyEmailCode`. |
| Passkeys, phone | Not enabled on Tinfoil's instance. | Instance configuration. |
| Key renewal | Design only: reuse `AccountSession` unchanged (below). | Windows implementation and tests. |
| Session storage | Design only; weaker than Windows (below). | AndroidX WebKit sources. |
| Credential delivery | Design only; needs a device experiment (below). | `mobile/bridge.mjs`, AndroidX WebKit sources. |

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

Proposed policy, for a maintainer decision:

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

On resume without process death, the worker would call `AccountSession.resume()` from the app's resume event, which drops an expiring key. After process death the in-memory key is gone and, under the storage policy above, the next launch deletes the profile, so the user signs in again.

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
