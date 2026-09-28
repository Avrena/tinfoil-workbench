# Working on Tinfoil Workbench

Keep this project private. The repository is the private `Avrena/tinfoil-workbench`; never push to upstream or a different owner. Do not commit credentials, vaults, real transcripts, generated private files or signing keys (Windows or Android). `scripts/Publish-PrivateRepo.ps1` only creates new repositories and is not needed for this one. Do not fabricate repository, release, CI, dependency or live-provider results.

Maintain separation between the vanilla TypeScript renderer, fixed data-only preload, guarded native commands, provider/tool service and encrypted vault. No generic IPC, shell, filesystem or arbitrary URL-fetch bridges. Preserve SDK attestation/EHBP, renderer network denial and exact sender checks. API keys are not Tinfoil Chat subscription sessions.

Default to progressive disclosure. Reasoning/metadata/advanced controls stay unobtrusive; inline artifact and side-panel state must survive token updates. Prefer inline insertion; the workspace is optional. Do not replace the whole transcript when a new token or turn arrives. Keep real tool insertion offsets and avoid duplicating pre-tool narration in future API messages. Respect reduced-motion settings and do not recolor document/image content. Reading visibility does not change model reasoning or stored content. Preserve actual provider reasoning as the original; never fabricate missing thinking. Clearly distinguish optional user-edited local thinking annotations from provider output and from protocol reasoning. Keep selected comparison histories and branch/edit/retry non-destructive.

Model capabilities are per-model and per-endpoint. Prefer sanitized provider metadata over narrow bundled profiles. Unknown means provider default, not invented sliders. Effort and on/off thinking are separate. Clear overrides on model changes and keep comparison lanes independent. Catalog metadata must not change endpoints, credentials, messages or tool permissions.

Visualization tools are a validated registry with paired call IDs and bounded rounds. Charts/tables/diagrams are typed host-rendered data. Artifact edits are immutable revisions; scoped read returns source, not claimed screenshot vision. Local previews/manual outputs are not automatically shared with models. Preserve artifact IDs across import inside thread scope.

HTML is static by default. Interaction is explicit per-preview, opaque-origin, inline-script only, no network/bridge/workers/popups/native permissions. Do not add allow-same-origin, raw Markdown HTML, trusted KaTeX or remote imports. Model-created PDF generation is JavaScript-disabled/no-preload and independent of the chat window. PDF.js must be locally packaged; no CDN or fake missing-library success. Do not distribute font binaries.

Python is native account-permission execution, NOT an OS sandbox. Every run needs single-use approval and native exact-code confirmation. No execution on render/import/startup, no always-allow mode, terminal or implicit package installation. Manual code must derive from stored blocks and remain out of provider context. Preserve limits and honest cancellation/error states.

Keep host visual surfaces transparent/neutral, without outer cards. Preserve authored colors and light-page PDF readability. Keep math/code caches bounded, dirty rendering isolated, hidden reasoning lazy and final/approval updates immediate. Do not reparse unchanged rich text or remount static views on every token. Deferred initial mounting is not full virtualization; opaque HTML scripts are not suspended merely by scrolling.

Edits must preserve the original and create an explicit branch; never regenerate or execute on save. Keep reply edit provenance, historyRewritten behavior, paired tool messages and conflict checks. Projects are organizational only; deleting a project must keep its threads.

Run npm test for core/service changes; rebuild preview and run all ten UI scripts (ui-smoke.py, ui-artifacts.py, ui-inline.py, ui-seamless.py, ui-editing.py, ui-responsive.py, ui-spacing.py, ui-activity.py, ui-account.py, ui-handoff.py) for UI changes. Run tests/render-cost.py against an authentic baseline when changing renderer work and report workload scope, not generalized speedup claims. Use tests/pdf-layout.py only for shared print styling; it does not validate native PDF.js. npm run smoke:desktop checks native storage/bridge and actual PDF printing/viewing after dependency installation. Record test scopes separately and complete Windows/live-provider validation before release.

Responsive testing is Chromium viewport/touch emulation. Do not describe simulated keyboard height as an actual mobile keyboard or claim iOS/Android compatibility from Chromium alone. Keep chart text readable, editors usable at 320px, desktop preferences intact across rotation, and model thinking effort separate from reading/editing. Record intermittent test failures as well as the final run.

Keep layout spacing in src/renderer/spacing.css, appended by the existing build into dist/style.css. Preserve paired transcript/composer gutters, container-responsive figure controls and a non-scrollable outer #app; inner transcript/editor/panel regions own scrolling. Do not attach per-message observers for spacing or change authored document/PDF styling to match host chrome.

## 0.8 activity invariants

A batch is a native function-call round, not a claim of parallel execution or a billed Batch endpoint. Tinfoil MCP progress is passive provider-reported display data; never execute it locally or invent generic MCP authorization. Search and delegation remain opt-in. Delegation requires exact-task native confirmation, the same model, no implicit history, no child tools, a two-request shared send budget, no retry and independently cancellable transport. Preserve original tool call/result IDs. Do not conflate delegate usage with parent usage or claim native sub-agent support. Keep closed activity detail islands lazy and approvals visible when reasoning is hidden. New tests are activity.test.mjs, activity-service.test.mjs and ui-activity.py. See docs/ACTIVITY.md and the current validation record.


## Account and instructions invariants (0.9)

Always state that a custom system prompt is optional, not required, in delivery notes and relevant UI/documentation. Blank instructions must remain valid and must not add a custom system message to ordinary chat. Do not confuse that with provider defaults or the separately scoped delegate protocol.

Keep website sign-in opt-in, on the exact Tinfoil origin in a temporary no-preload/no-Node window. No copied regular-browser cookies, pasted session tokens, fake OAuth flows, hidden login or invented profile/billing endpoints. Do not put identity or inference credentials in vaults, renderer snapshots, exports or logs. Local thread owner bindings are not credentials and are removed from exports/import approvals. Session tokens must match the expected current user before and after every async identity read. Auth errors cannot downgrade to free or developer access. Generation retries stay off.

The website adapter has been tested natively on Windows; additional sign-in methods require separate validation, and mock-Electron tests cannot establish native correctness. Profile edits belong to the provider UI, not a fabricated local success. Keep sign-out local cleanup unconditional and remote revocation best-effort. Cloud sync and per-account encrypted workspaces are not implemented. Account-only profile data must not be silently placed in prompts. Preserve extra approval before existing history crosses a Chat identity or Chat/API mode; approval alone never sends.


## 0.10 handoff invariants

Draft text and selected attachment contents must persist atomically in the encrypted workspace. Old workspaces default to an empty draftAttachments array. Never execute or send an attachment on reopen. Block destructive navigation/edit/import continuations when draft flushing fails. Explicit plaintext export remains a recovery route and never implicitly closes the application. Pending Advanced values are session-only per-thread UI drafts; apply explicitly, restore supported model controls before their selection, and discard the actual inputs as well as their dirty marker.

All ordinary native close paths must go through CloseCoordinator. Ignore stale/duplicate close responses; acknowledgements stop the initial watchdog while a human reads. An unavailable renderer needs a native explicit force-close decision; save errors default to keeping the window open. Keep the exposed bridge narrow and validate request IDs/booleans in the main process. Do not claim crash/power-loss durability from normal-close tests.

Keep exact reviewed direct pins and genuine lockfile requirements. Doctor is read-only, source-only mode is not installation success, and packaging must run real native smoke after installation. Do not substitute mocks or missing-library output for the PDF.js or DPAPI acceptance check. No force upgrades, automatic publication or user credentials in tests. Follow docs/HANDOFF.md before describing a release as Windows-validated.


## 0.11 Android invariants

The Android app reuses the renderer and `desktop/service.mjs` unchanged. Keep Android-specific behavior behind the optional `platform: 'android'` snapshot field and `onAppEvent` bridge callback so that desktop behavior stays identical. `mobile/commands.mjs` mirrors the command switch in `desktop/main.mjs`: change both together, including native confirmations, stale-approval rechecks and file limits. Unsupported features (Chat sign-in, Python, HTML-to-PDF) must fail with an explicit Android message, never silently.

Keep the service, SDK, vault key and API key in the host worker; the renderer document keeps `connect-src 'self'`. The worker may request only the operations in `mobile/native-ops.mjs`, validated on the main thread. Do not add generic filesystem, network, intent or evaluation operations. Keep `MainActivity`'s request allowlist (`https://localhost`, HTTPS `*.tinfoil.sh`), navigation lock, WebView feature gate and the stubs replacing Capacitor's HTTP, cookie and server-path plugins. Keep Capacitor logging off: debug logging writes plugin arguments, including key material, to logcat.

The vault stays in the desktop envelope format with a Keystore-wrapped data key; never add a plaintext or exportable-key fallback. Keep backup and device transfer disabled. Never commit the Android release keystore or its properties; releases are signed on the maintainer machine. Run `node --test tests/mobile-*.test.mjs` for host changes and `tests/android-device.py` (debug with `--live`, and release) on an emulator or device before an Android release. Do not claim physical-device, tablet or older-WebView support that was not tested.


## System instructions selection

The custom system prompt stays optional: None is the default and starters are never applied implicitly. `systemPrompt` is the only instruction text sent; `systemPromptName` and `Reply.systemPromptName` are display-only and must never reach a request, tool history or delegated task. Selecting saved or starter instructions copies text and name into the thread; library edits and deletion must not change existing conversations. Record the name on replies at send time and never relabel earlier replies. Show it below the answer with the model name, not above the answer. New tests are instructions.test.mjs plus checks in ui-smoke.py and ui-spacing.py.

Escape and Android Back must go through `cancelTopDialog()` and `topModal()`. Chromium makes a dialog's own cancel event non-cancelable after one prevented close per user activation, and DOM order is not the stacking order. A test of repeated Escape must not query the page between the presses: Playwright evaluates with a user gesture, which grants a new activation and hides the defect. Keep dialog actions reachable with an on-screen keyboard (`ui-responsive.py` keyboard-height checks), and run `tests/android-device.py` for picker or dialog changes.

## Chat account renewal and sign-in

Sign-in starts on `https://chat.tinfoil.sh/signin`, Tinfoil's own page, which resumes a social sign-in's second factor through `/sso-callback`; do not return to Clerk's modal or inject sign-in scripts. Accept a sign-in only after two agreeing session reads, then bind the Clerk user and session ID; every later read, and a read after each token exchange, must match both. A loading page or one on another origin is "not ready", never a sign-out.

The account window's host list governs the page itself (navigation, redirects, popups); frames stay HTTPS-only through the partition filter. Refused hosts are reported through `AccountSession.blocked()`. Google entries are `accounts.youtube.com` and `accounts.<domain>` for the domains in Google's published supported-domains list only; allow no other hosts under them and no wildcard.

Keys need an explicit UTC `expires_at`; never assume a lifetime. Measure it against the response `Date` header, reuse a key only with more than 60 seconds left and never beyond an hour, and renew at request time without depending on timers. Coalesce concurrent callers and discard any result after sign-out or a user or session change. A usage limit (429, or `HOURLY_LIMIT_REACHED` with any status, checked before 401/403) waits for the reset, then `Retry-After`, then 60 seconds, clamped to 10 seconds–1 hour; explicit refreshes are spaced 30 seconds apart. Exchange 401 gets one forced identity refresh; a second 401 or a 403 requires reconnecting; 402 keeps the identity. Inference 401/403 drops only that key and client (`AccountSession.reject`), keeps partial output and is never retried. Every Chat request, tool round and delegated request goes through `service.bound()`.

Add tests to `account.test.mjs`. `tests/account-live.mjs` is the manual live check: it needs a person to sign in and logs no credentials. Record native results with the sign-in method used; one method does not establish the others, and Android stays on API keys until Tinfoil provides the contract listed in docs/ANDROID.md.
