# Account access and optional instructions — 0.9

The custom system prompt is optional and not required. Leave it blank for ordinary chat without an application-supplied custom system message. Provider-side defaults still apply. The existing, separately approved text-only delegate retains its narrow worker-protocol instruction; that does not make the user's custom prompt mandatory.

## What is implemented

Account & connection is available in the sidebar, conversation menu, command palette and Settings. It separates **Tinfoil Chat account** from **developer API key** access. There is no automatic fallback between these modes. Installing the client, opening Account or restoring a workspace does not sign in, copy browser cookies, request a token or generate a response.

**Sign in to Tinfoil Chat** opens the official `https://chat.tinfoil.sh/` site in a separate Electron window. Workbench asks the site's loaded Clerk instance to open its normal sign-in component. The provider handles credentials and any enabled authentication factors. The window has no native preload, no Node integration, no filesystem/IPC bridge and a separate temporary browser partition. Top-level navigation and popups are restricted to an explicit HTTPS account/provider host list; web permissions and downloads are denied. There is no invented desktop OAuth callback, client ID, device-code flow or pasted-session-token form.

Once the site's current user and current session agree, the main-process adapter requests the current Clerk session token through its public `getToken` API. It exchanges that token at Tinfoil's published web-client `GET /api/chat/token` endpoint. The returned inference credential is passed to the official Tinfoil SDK; inference still requires attestation and EHBP. Authentication/control-plane HTTPS calls do not carry prompts or attachments and are not described as enclave-attested inference.

**This is an experimental website-session adapter, not a verified native desktop login integration.** The exact-origin scripts and token state machine have been exercised with injected test objects and synthetic responses. The actual production website, sign-in factors, social redirects, native Electron, Windows and live inference have not been exercised. Upstream page/Clerk changes may require adapter updates. Some sign-in methods may not work in an embedded browser; the client does not spoof the browser, bypass provider restrictions, or quietly replace account access with paid API access. An official native OAuth/PKCE integration, if available, should replace this adapter after its contract is verified.

## Profile and usage

The view displays the provider-returned name, primary email and its verification status. It uses local initials instead of fetching an avatar. Subscription status and expiry come from the same Clerk public metadata fields used by Tinfoil's own web app. Unknown fields are shown as Not reported, never a fabricated plan or unlimited quota. A profile's subscription label does not itself grant inference access; only a successful token exchange establishes that state.

**Manage profile & security** opens the provider's own profile component in the isolated website window. Workbench does not invent profile-update, password-reset, billing, subscription-cancellation or account-deletion endpoints. Make any desired change in the provider UI, then choose **Refresh account** to refresh the displayed fields and access check. Account switching is sign out, then sign in; this version has no multi-account switcher.

Subscription & usage starts collapsed. It shows only budgets returned by the provider: input/output limits and remaining amounts, reset times, and request counts when present. These are timestamped snapshots from the last access check, not a live billing meter. Requests and token budgets are different dimensions. Parent and delegated model usage remain separate in the transcript.

After sign-in and a successful account-access check, choose **Verify enclave & load models**, select a chat model and send a message. An API key is not required when this account path works. Account access does not automatically provision hosted Python/code-execution sessions or arbitrary MCP servers.

## Lifetime, expiry and failure handling

The website browser session, identity token and inference credential stay in memory. They are not written into workspace.vault, renderer snapshots, logs or exports. There is no Remember me option: quitting the app requires signing in again next time. The website window remains hidden while signed in so its normal Clerk session can refresh on demand; it has the usual resource/network overhead of that page. Workbench only polls during the explicit sign-in attempt and otherwise reads session state on account actions and requests. The remote website can perform its own normal account operations; it cannot read the local Workbench vault.

Token exchange is single-flight, size-bounded and timed out, rejects redirects, and checks the current identity before reusing a cached inference token. A 401 during exchange causes at most one identity refresh and one repeat of that exchange—not a generation retry. 401/403 session rejection asks for reconnection; 402 keeps the signed-in identity but reports subscription required; 429 preserves a reported cooldown. A failed or unavailable session never becomes an anonymous/free-tier key or a separately billed developer request. Inference authorization failures also clear the cached connection and show an account-specific error, with partial text preserved.

Sign out requires native confirmation, cancels active work, clears the in-memory state and destroys the temporary website windows. Ending the remote Clerk session is best-effort; local cleanup is unconditional. Regular-browser sessions are not imported or signed out. Quitting stops the main app even when a hidden website window is present.

## Local workspace and cross-account history

Signing in does not upload or synchronize the Workbench workspace. Local conversations remain readable on this Windows user account after signing out; this is not an account-locked chat archive or separate per-account vaults. The original encrypted local vault remains the storage boundary. No model prompt automatically contains profile names, emails or subscription metadata.

When an existing thread moves between Chat identities or Chat/API modes, a separate native confirmation is required before its existing selected history can be sent through the new connection. The approval records a local owner binding and does not send anything. Press Send again to actually submit. New threads bind on their first send. Branches inherit that binding; JSON export omits it, and import cannot assert an approval. A binding may contain the provider user ID in the encrypted local workspace; the full profile and credentials remain transient. The API-key binding means the currently selected developer mode, not a verified identity lookup for each developer key.

This is accidental-cross-account-send protection, not a defense against a malicious OS user or compromised native application. Switching accounts does not silently move cloud chats. Native Python retains its existing explicit per-run approvals and local account permissions.

## Offline preview and tests

The HTML preview refuses login, credentials, real profile updates and sign-out. Account → Toggle sample profile displays explicitly labelled synthetic identity and usage. That action never represents a real authenticated account. The test hook in ui-account.py exists only in an in-memory copy of the HTML for synthetic error/rotation cases, not in the shipped production renderer.

`tests/account.test.mjs` checks normalization, actual wire-shape budgets, exact-origin scripts, identity races, token expiry, one-refresh authorization, subscription/usage errors, cancellation, no secret serialization, fake-Electron window boundaries, service routing and history approvals. It does not test native Electron. `tests/ui-account.py` exercises the production renderer using synthetic account snapshots and real emulated taps; its viewport checks are not physical-device compatibility tests.

## Source contracts inspected

All retrieved on 28 September 2026; upstream behavior can change. No upstream application code was copied as an authentication implementation.

- Tinfoil web client token exchange and real flat quota fields: https://github.com/tinfoilsh/tinfoil-webapp/blob/8621c246b4b6c0c4b854a8a30f7756cce1262b33/src/services/inference/tinfoil-client.ts (fetched blob `c5b6df1ab3562eab2d2a948a6d66df65f4d934ab`).
- Tinfoil subscription metadata: https://github.com/tinfoilsh/tinfoil-webapp/blob/8621c246b4b6c0c4b854a8a30f7756cce1262b33/src/hooks/use-subscription-status.ts (fetched blob `974a43230ccaeb0d701ae5968c279ea36ced6082`).
- Clerk public session methods and identity: https://clerk.com/docs/js-frontend/reference/objects/session .
- Clerk sign-in and profile components: https://clerk.com/docs/js-frontend/reference/objects/clerk and https://clerk.com/docs/js-frontend/reference/components/authentication/sign-in . Modern forceRedirectUrl/signUpForceRedirectUrl keep the return destination on the exact Tinfoil origin.
- Electron temporary partition semantics: https://www.electronjs.org/docs/latest/api/session . A partition without the `persist:` prefix is in memory.
- Electron remote-content security checklist: https://www.electronjs.org/docs/latest/tutorial/security .
