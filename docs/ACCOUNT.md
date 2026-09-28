# Account access and optional instructions

The custom system prompt is optional and not required. Leave it blank for ordinary chat without an application-supplied custom system message. Provider-side defaults still apply. The existing, separately approved text-only delegate retains its narrow worker-protocol instruction; that does not make the user's custom prompt mandatory.

## What is implemented

Account & connection is available in the sidebar, conversation menu, command palette and Settings. It separates **Tinfoil Chat account** from **developer API key** access. There is no automatic fallback between these modes. Installing the client, opening Account or restoring a workspace does not sign in, copy browser cookies, request a token or generate a response.

**Sign in to Tinfoil Chat** opens Tinfoil's own sign-in page, `https://chat.tinfoil.sh/signin`, in a separate Electron window. The site handles Google, Apple and email sign-in and the account's second factor; Workbench shows no password or code field and injects no sign-in script. After a social sign-in redirect, the site's `/sso-callback` page continues a sign-in that still needs the second factor at `/signin?resume=1`. (Clerk's generic sign-in modal, which earlier versions opened, did not continue that step.) The window has no native preload, no Node integration, no filesystem/IPC bridge and a separate temporary browser partition. Web permissions and downloads are denied. There is no invented desktop OAuth callback, client ID, device-code flow or pasted-session-token form.

The page itself may navigate, redirect or open a popup only to an explicit HTTPS host list:

- Tinfoil: `chat.tinfoil.sh`, `clerk.tinfoil.sh`, `accounts.tinfoil.sh`.
- Google: `accounts.google.com`, `accounts.youtube.com`, and `accounts.<domain>` for each of the 187 domains in Google's published list of its own domains (`https://www.google.com/supported_domains`, embedded as retrieved on 28 September 2026). At the end of its sign-in, Google moves the page through `accounts.youtube.com` and the account host of the user's country domain (for example `accounts.google.co.uk`) to set its account cookies. No other host under those domains is allowed.
- Apple, GitHub and Microsoft sign-in: `appleid.apple.com`, `github.com`, `login.microsoftonline.com`, `login.live.com`.

Frames inside those pages (provider cookie checks, CAPTCHAs) are limited to HTTPS by the partition's request filter, not by this host list; the list is not an allowlist for every network destination. When the page tries to open a host outside the list, the navigation is refused and the Account view names the host ("The sign-in page tried to open …"), instead of leaving the page stalled.

Workbench accepts a sign-in only when two reads of the site's Clerk session, a second apart, report the same user and session, so the redirects that follow a provider sign-in have settled. It then binds both the Clerk user ID and the Clerk session ID. Through the session's public `getToken` API it obtains an identity token and exchanges it at `GET https://api.tinfoil.sh/api/chat/token`, the endpoint Tinfoil's own web and iOS clients use. The returned inference credential is passed to the official Tinfoil SDK; inference still requires attestation and EHBP. Authentication and token calls are HTTPS control-plane calls: they carry no prompt or attachment and are not described as enclave-attested inference.

**Status: a website-session adapter, tested on Windows.** It is not a registered native OAuth integration; Tinfoil publishes none. The token endpoint comes from Tinfoil's open-source clients, not from public API documentation, and Tinfoil's terms contain no clause that explicitly permits or forbids third-party Chat clients; [ANDROID.md](ANDROID.md#tinfoil-chat-sign-in) lists what the provider does not document. Additional sign-in methods have not been exercised; [VALIDATION.md](VALIDATION.md) records what was. Upstream page or Clerk changes may require adapter updates. Some sign-in methods may not work in an embedded browser; the client does not spoof the browser, bypass provider restrictions, or quietly replace account access with paid API access.

## Profile and usage

The view displays the provider-returned name, primary email and its verification status. It uses local initials instead of fetching an avatar. Subscription status and expiry come from the same Clerk public metadata fields used by Tinfoil's own web app. Unknown fields are shown as Not reported, never a fabricated plan or unlimited quota. A profile's subscription label does not itself grant inference access; only a successful token exchange establishes that state.

**Manage profile & security** opens the provider's own profile component in the isolated website window. Workbench does not invent profile-update, password-reset, billing, subscription-cancellation or account-deletion endpoints. Make any desired change in the provider UI, then choose **Refresh account** to refresh the displayed fields and access check. Account switching is sign out, then sign in; this version has no multi-account switcher.

Subscription & usage starts collapsed. It shows only budgets returned by the provider: input/output limits and remaining amounts, reset times, and request counts when present. These are timestamped snapshots from the last access check, not a live billing meter. Requests and token budgets are different dimensions. Parent and delegated model usage remain separate in the transcript.

After sign-in and a successful account-access check, choose **Verify enclave & load models**, select a chat model and send a message. An API key is not required when this account path works. Account access does not automatically provision hosted Python/code-execution sessions or arbitrary MCP servers.

## Chat access: renewal, expiry and failures

The website browser session, identity token and inference credential stay in memory. They are not written into workspace.vault, renderer snapshots, logs or exports. There is no Remember me option: quitting the app requires signing in again next time. The website window stays hidden while signed in so its Clerk session can refresh on demand; it has the usual resource/network overhead of that page. Workbench polls only during the explicit sign-in attempt and otherwise reads session state on account actions and requests. The remote website can perform its own normal account operations; it cannot read the local Workbench vault.

A Chat inference key is renewed when a request needs one, not by a timer, so system sleep cannot leave an expired key in use:

- Every request, tool round, comparison lane and approved delegated request asks for a key. Before a cached key is reused, the website session is read and must still have the bound user and Clerk session. A cached key is reused only while more than 60 seconds remain, and never for more than an hour.
- Otherwise Workbench gets the session's current identity token and exchanges it. Concurrent callers share one session read and one exchange. The exchange goes to a fixed URL with the identity token only in the Authorization header, rejects redirects, is not cached, times out after 15 seconds and reads at most 64 KiB.
- The response needs a key and an explicit UTC `expires_at`. A missing, malformed or zone-less time (JavaScript reads a zone-less date-time as local time), an expired key, or one with under 30 seconds left is refused. Tinfoil's own web client keeps a key without an expiry indefinitely; Workbench does not. The lifetime is measured against the response's `Date` header, so a wrong local clock neither refuses a valid key nor reuses an expired one. The observed lifetime is 15 minutes, but nothing depends on that value.
- After the exchange, the site's current user and session are read again. If either changed, the result is discarded and the account view asks you to reconnect. Sign-out or a new sign-in discards any exchange still in flight, so a late response cannot restore a key.
- A new key gets a new SDK client, which completes attestation before any content is sent. A response that is already streaming keeps its client; a renewal never restarts or repeats it. Each request checks that its client belongs to the account its send was bound to.
- On resume from sleep, a cached key that has expired or is about to is dropped at once, without a network request.

| Result | Handling |
|---|---|
| Token exchange returns 401 | One forced identity-token refresh and one repeat of that exchange — never of a generation |
| 401 again, or 403 | Credentials are cleared and the account view asks you to sign in again |
| 402 | You stay signed in; the view reports that a Chat subscription is required |
| 429, or the hourly-limit code with any status | A cooldown until the reported reset on the server's clock, else `Retry-After`, else 60 seconds, bounded to between 10 seconds and one hour (the order Tinfoil's own client uses). Requests during it send nothing; **Refresh account** can check again after 30 seconds |
| Network failure, 5xx, malformed or unusable response | Access is reported as unavailable. Nothing is sent with an old key and nothing is retried automatically |
| Inference returns 401 or 403 | That key and its SDK client are dropped and partial output is kept. You stay signed in; retrying the turn requests a new key. Nothing is retried automatically |

No failure switches to anonymous/free access or to a developer API key. Generation retries stay off.

Sign out requires native confirmation, cancels active work and any exchange in flight, clears the in-memory state and destroys the temporary website windows. Ending the remote Clerk session is best-effort; local cleanup is unconditional. Earlier Chat keys are not claimed to be revoked by the server. Regular-browser sessions are not imported or signed out. Quitting stops the main app even when a hidden website window is present.

## Local workspace and cross-account history

Signing in does not upload or synchronize the Workbench workspace. Local conversations remain readable on this Windows user account after signing out; this is not an account-locked chat archive or separate per-account vaults. The original encrypted local vault remains the storage boundary. No model prompt automatically contains profile names, emails or subscription metadata.

When an existing thread moves between Chat identities or Chat/API modes, a separate native confirmation is required before its existing selected history can be sent through the new connection. The approval records a local owner binding and does not send anything. Press Send again to actually submit. New threads bind on their first send. Branches inherit that binding; JSON export omits it, and import cannot assert an approval. A binding may contain the provider user ID in the encrypted local workspace; the full profile and credentials remain transient. The API-key binding means the currently selected developer mode, not a verified identity lookup for each developer key.

This is accidental-cross-account-send protection, not a defense against a malicious OS user or compromised native application. Switching accounts does not silently move cloud chats. Native Python retains its existing explicit per-run approvals and local account permissions.

## Android

Android Chat access is implemented but not yet released: the app signs in with email and password on Tinfoil's own sign-in page, shown on a separate screen with no bridge and a WebView profile of its own. Google OAuth requires a supported native/browser integration and is refused on that screen. It has been checked with a real account on one phone. On a WebView without profiles or message ports, the app keeps using a developer API key. The same `AccountSession` runs in the Android host worker, so the renewal rules above apply unchanged; the key exchange runs natively. [ANDROID.md](ANDROID.md#tinfoil-chat-sign-in) lists what Google's route would need from Tinfoil, and [ANDROID-ACCOUNT.md](ANDROID-ACCOUNT.md) describes the Android design and its weaker session storage.

## Offline preview and tests

The HTML preview refuses login, credentials, real profile updates and sign-out. Account → Toggle sample profile displays explicitly labelled synthetic identity and usage. That action never represents a real authenticated account. The test hook in ui-account.py exists only in an in-memory copy of the HTML for synthetic error/rotation cases, not in the shipped production renderer.

`tests/account.test.mjs` uses injected test objects and synthetic responses. It covers normalization and wire-shape budgets, exact-origin scripts, user and Clerk-session binding, changes during an exchange, strict UTC expiry, clock skew through the `Date` header, reuse margins, cooldowns, one-refresh authorization, every exchange status, timeouts, cancellation and late responses, account replacement, inference rejection, renewal between tool rounds without replay, the page-versus-frame navigation policy, refused-host reporting, the two-read sign-in rule, service routing and history approvals. It does not run native Electron.

`tests/account-live.mjs` is a manual check with a real account; see its header. It starts the app from source with a temporary profile, waits for a person to sign in, then drives the real renderer: verification, a send, a send after the first key has expired (unless `--quick`), sign-out during a refresh, and a refused send. It logs only statuses, UTC times, counts, booleans and sign-in host names (plus paths on Tinfoil's origin), and compares credentials only in memory. `tests/ui-account.py` exercises the production renderer using synthetic account snapshots and real emulated taps; its viewport checks are not physical-device compatibility tests.

## Source contracts inspected

All retrieved on 28 September 2026; upstream behavior can change. No upstream application code was copied as an authentication implementation.

- Tinfoil web client token exchange, refresh margin, hourly-limit handling and cooldown order: https://github.com/tinfoilsh/tinfoil-webapp/blob/6869354445d9e273b090bbf5fcd1c711e901bc2d/src/services/inference/tinfoil-client.ts (identical at `8621c246b4b6c0c4b854a8a30f7756cce1262b33`).
- Tinfoil's sign-in page and social-sign-in callback: https://github.com/tinfoilsh/tinfoil-webapp/blob/8621c246b4b6c0c4b854a8a30f7756cce1262b33/src/pages/signin.tsx and https://github.com/tinfoilsh/tinfoil-webapp/blob/8621c246b4b6c0c4b854a8a30f7756cce1262b33/src/pages/sso-callback.tsx.
- Tinfoil subscription metadata: https://github.com/tinfoilsh/tinfoil-webapp/blob/8621c246b4b6c0c4b854a8a30f7756cce1262b33/src/hooks/use-subscription-status.ts.
- Tinfoil iOS token request (same endpoint): https://github.com/tinfoilsh/tinfoil-ios/blob/f413f869f1f246b18ef063beb5dae3cc138540a4/TinfoilChat/Services/ChatTokenRequestGate.swift.
- Google's own domains: https://www.google.com/supported_domains.
- Clerk session methods, `getToken` and `skipCache`: https://clerk.com/docs/js-frontend/reference/objects/session and https://clerk.com/docs/guides/sessions/force-token-refresh.
- Electron temporary partition semantics: https://www.electronjs.org/docs/latest/api/session . A partition without the `persist:` prefix is in memory.
- Electron remote-content security checklist: https://www.electronjs.org/docs/latest/tutorial/security .
