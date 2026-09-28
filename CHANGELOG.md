# Changelog

## Unreleased

- Android: sign in to Tinfoil Chat with your email and password. Tinfoil's own sign-in page opens on a separate screen, with no bridge to the app and a WebView storage profile of its own, and Chat access renews as on Windows. Google and Apple sign-in are not available in the Android app: Google refuses sign-in in embedded views, and a supported route needs Tinfoil to register the app. While you are signed in, the website session is kept in the app's private storage; it is deleted when the app next starts. Checked with a real account on one phone, including a key renewal after expiry. On a WebView without the needed features, such as Android System WebView 113, the app keeps using a developer API key.
- Android: dialogs no longer sit under the status bar with a current Android System WebView. From WebView 140, the app is drawn under the system bars and has to keep its own content clear of them. The main screen did, but full-screen dialogs (Account & connection, the message editor) and tall ones (System instructions) started under the status bar, where their close buttons could not be tapped, and could reach under a navigation bar. Dialogs, the message editor and short notices now stay clear of the status bar, navigation bar and display cutout. The emulators used for the device tests have WebView 133 and 113, where Capacitor pads the view itself, so the problem first showed on a phone with WebView 153. `tests/ui-responsive.py` now checks every dialog with simulated system-bar insets.

## 0.12.1 — Tinfoil Chat sign-in and token renewal on Windows

- Sign in on Tinfoil's own sign-in page (`chat.tinfoil.sh/signin`) instead of Clerk's generic modal. The page continues pending authentication steps by itself; the generic modal required another action.
- The sign-in window no longer stalls during account-cookie redirects. Afterwards Google moves the page to `accounts.youtube.com` and to the account host of the user's country domain (for example `accounts.google.co.uk`) to set account cookies, and the sign-in window refused both. It now allows `accounts.youtube.com` and the account host of each of the 187 domains Google publishes as its own, and nothing else under them. The host list now applies to the page but not to its frames, whose redirects were also being cancelled. If the page tries to open any other site, the Account view names it instead of leaving the page stalled.
- Chat access renews without another sign-in. A key is renewed when a request needs it and 60 seconds or less would remain, and its lifetime is measured against the server's `Date` header, so a wrong PC clock does not matter. A token response without a valid UTC expiry, already expired or expiring within 30 seconds is refused; a missing expiry used to be accepted for 60 seconds.
- A sign-in is bound to the website's Clerk session as well as its user. If either changes, including during a token exchange, the result is discarded and the account must be reconnected. Signing out during a token exchange discards its late response.
- A usage limit, recognized by HTTP 429 or Tinfoil's hourly-limit code, waits for the reported reset, then `Retry-After`, then 60 seconds, for at most one hour. It is no longer retried on the next request or treated as a rejected session.
- If Tinfoil rejects a Chat key during a reply, only that key is dropped: you stay signed in, partial text is kept, and retrying the turn requests a new key. This used to sign the account out.
- Waking the PC from sleep drops an expired key at once. A failed access check right after sign-in keeps you signed in, so Refresh account can try again.
- Android is unchanged and still connects with a developer API key. Google sign-in there needs a provider integration that Tinfoil does not publish (docs/ANDROID.md); Tinfoil's direct sign-in methods are a separate candidate, not yet investigated at release time (docs/ANDROID-ACCOUNT.md). The device test now also checks that Android refuses Chat sign-in and resumes from the background in the same process.
- Add `tests/account-live.mjs`, a manual check with a real account that logs no credentials, and 29 more tests in `tests/account.test.mjs`.
- Checked on Windows 11, running from source, with a real Tinfoil account, including a key renewal after expiry; see docs/VALIDATION.md. The custom system prompt remains optional and not required.

## 0.12.0 — system instructions selection and reading type

- Choose optional system instructions per conversation from a composer button, the conversation menu, the command palette or Advanced. The choices are None (the default), saved instructions, or read-only starters (Concise, Explainer, Editor, Code assistant) that can be customized as a copy. The custom system prompt remains optional and not required; None sends no custom system message.
- Save, edit and delete reusable instructions in the encrypted workspace (up to 50 entries of up to 40,000 characters). Selecting an entry copies its text and name into the conversation, so later library edits or deletion never change an existing conversation. The editor asks before discarding unsaved changes, and close review reports them. On phones its actions stay above the on-screen keyboard.
- Answers no longer have a header row. The model name, the instructions each request was sent with, the Edited label and opt-in timing/usage form a quiet line below the answer, beside its actions. It truncates rather than wraps when action labels appear on hover (the full text is in its tooltip) and takes its own line in narrow replies. Comparison lanes keep a model label above each lane. The name is recorded on each reply at send time, is display-only and is never sent to a model; Markdown exports include it.
- The second click of a double-click that closes a dialog, or that switches the instructions picker between its list and editor, no longer acts on the controls it uncovers.
- Pressing Escape twice no longer discards unsaved text. Chromium lets a page keep a dialog open on Escape only once per user activation, so the second Escape closed the message editor or the instructions editor without the question it had just asked (Electron 44 included). The renderer now handles Escape itself, as Android Back already did, and both act on the dialog on top, such as close review over an unsaved editor, instead of the dialog that comes last in the document. An Escape that ends an IME composition is left to the IME.
- Reading type: answers, prompts, the composer and editor previews use 15px text. Headings have a clearer scale and balanced wrapping, paragraphs avoid single-word last lines, and tables and code blocks are larger.
- Fonts: Windows 11 installs its variable UI font as optical-size families (`Segoe UI Variable Text`, `… Small`, `… Display`). The stylesheet asked for `Segoe UI Variable`, which matches none of them, so text fell back to Segoe UI. It now requests `Segoe UI Variable Text`, and `Segoe UI Variable Display` for large reply headings, with Segoe UI as the fallback; Electron 44 on Windows 11 renders both with Segoe UI Variable. One shared monospace stack replaces the per-rule lists and no longer names Courier New, which Android maps to its serif typewriter face (Cutive Mono); inline code and code blocks now share one sans monospace face on Android.
- Add `tests/instructions.test.mjs`, and extend `ui-smoke.py`, `ui-spacing.py`, `ui-editing.py`, `ui-handoff.py` and `ui-responsive.py` with instruction selection, reply signature, footer/composer geometry, repeated Escape, stacked dialog and keyboard-height checks. `tests/android-device.py` covers the picker with touch, Back and the on-screen keyboard, its persistence across a force-stop, and the fonts used for code.
- The workspace format stays at version 1. Opening it in 0.11.0 keeps conversations and their instruction text, but 0.11.0 drops saved instructions and instruction names the next time it saves; back up before downgrading.
- Verified on Windows 11 and on Android 16 and Android 14 emulators; see docs/VALIDATION.md. The custom system prompt remains optional and not required.

## 0.11.0 — Android app and first verified release build

- Add an Android app (Capacitor 8, Android 7.0+ with a current System WebView):
  - The unchanged renderer runs in the WebView. The shared service, Tinfoil SDK (attestation + EHBP), vault crypto and API key run in a dedicated worker, while the page keeps `connect-src 'self'`.
  - The workspace uses the desktop vault format, with its data key wrapped by a non-exportable Android Keystore key, atomic writes, and backup and device transfer disabled.
  - A fixed nine-operation native plugin provides native dialogs, the system document picker, clipboard and link opening.
  - The WebView network allowlist admits only `https://localhost` and `*.tinfoil.sh`, Capacitor's HTTP, cookie and server-path plugins are disabled, and the app refuses WebViews without an origin-restricted bridge.
  - Backgrounding saves the draft, and Back closes the topmost layer before backgrounding the app.
- Android omits Tinfoil Chat sign-in, Python execution and HTML-to-PDF export, and says so where those controls would appear. Desktop behavior is unchanged: the renderer reacts only to an optional `platform: 'android'` snapshot field and an optional `onAppEvent` bridge callback.
- Fix bootstrap for Electron 44, which no longer downloads its binary from an install hook: `npm run bootstrap` now fetches it and verifies it against the checksums shipped in the pinned package. CI uses bootstrap and Node 24.
- Commit the reviewed lockfile. npm 11's install-script gate records `electron-winstaller` and `esbuild` as explicitly denied; neither script is needed.
- Fix Python output-file collection on Windows when TEMP is an 8.3 short path (for example `C:\Users\RUNNER~1\...`). The containment check compared the long `realpath()` of each file with the short output directory and silently dropped every file. It now compares resolved paths on both sides. Found by the first GitHub Actions Windows run.
- Make the Python browser suites run on stock Windows: they use Playwright's bundled Chromium, read files as UTF-8, and `ui-activity.py` no longer checks too early for a result that renders on the next animation frame.
- Add 18 Node tests for the Android host (vault format and tamper handling, command parity, native-operation allowlist) and `tests/android-device.py` for emulator/device checks. Add Android and renderer CI workflows.
- Verified on Windows 11 and on Android 16 and Android 14 emulators, including a live enclave verification from the Android worker; see docs/VALIDATION.md. The custom system prompt remains optional and not required.

## 0.10.0 — local handoff and recovery

- Persist composer drafts and selected text-file contents together in the encrypted workspace; clear only the sent draft, retain branch references, and migrate older workspaces additively.
- Route native close through a single acknowledged review, protect pending editor/settings/active work, flush the composer before normal exit, and provide an explicit native fallback for an unavailable renderer.
- Retain unapplied Advanced values per thread, restore model-dependent effort controls, make Apply/Discard reachable without reopening the inspector, and clear deleted-thread UI caches.
- Stop edit/navigation/import paths after failed draft saves while retaining explicit plaintext export for recovery; show errors within top-layer dialogs, add accessible names, clear unsubmitted key fields on dismiss, and await clipboard completion.
- Pin Electron 44.4.3 and electron-builder 26.17.0; add read-only source/dependency doctor, sequential local build helper, packaging gates and CI lockfile validation before cache setup.
- Add source/recovery/browser checks, preserve synthetic streaming work counters, and document Windows/live-account acceptance rather than claiming an executed native release. The custom system prompt remains optional and not required.

## 0.9.0 — optional instructions, account profile and isolated sign-in

- Label the custom system prompt optional/not required; preserve blank-input omission in ordinary chat.
- Add an experimental, explicit Tinfoil website sign-in adapter with temporary no-preload browser isolation, exact-origin/current-user checks, published subscription token exchange, memory-only credentials, bounded refresh/cancellation and no automatic fallback to free or developer billing.
- Add a neutral Account view, profile/security management through the provider UI, collapsed reported quotas, explicit connection-mode choice, sign-out/reconnect and viewport-safe phone/tablet presentation.
- Bind existing history to explicitly approved Chat identities/modes, preserve branches, remove bindings on export/import, and keep sign-in separate from local workspace/cloud sync.
- Keep account credential handling out of the renderer/vault/export. Preserve all existing tool approvals, model capabilities, editor/visualization behavior and measured streaming work.
- Live website/social/passkey authentication, native Windows and actual provider access remain untested. The included preview refuses real authentication and labels its synthetic account samples.

## 0.8.0 — grouped actions, provider MCP events and text-only delegation

- Register entire function-call rounds before sequential execution; preserve batch identity, queue positions, per-action approvals and exact tool-result pairing.
- Parse documented Tinfoil provider progress markers with bounded chunk-tolerant buffering, secret-key redaction, safe source links and honest incomplete/blocked states; never execute a marker locally.
- Add explicit opt-in hosted web-search options. No arbitrary MCP server configuration or hosted code-execution credentials are supplied.
- Add disabled-by-default `delegate_task`: native-confirmed same-model task-only request, two-request send-wide budget, no inherited history/tools/recursion, separate child reasoning/usage, individual cancellation and transport cleanup.
- Add neutral inline batch/provider/child activity with lazy retained detail islands, accessibility and compact touch layout. Markdown exports include activity provenance and child reasoning/usage.
- Keep model-aware reasoning, editing, projects and visual tools unchanged. Tests distinguish synthetic adapters from untested native/live integrations.

## 0.7.0 — aligned spacing and bounded responsive controls

- Added a shared spacing stylesheet, bundled into the existing CSS request. Align the reading column, inline figures and composer; tighten message groups while retaining clear turn separation and neutral, borderless figures.
- Align project/search rows and two-line thread headers. Let visualization controls respond to their own width, including split desktop views. Remove unused chart/diagram heading space without shrinking chart data plots or changing headed/print chart exports.
- Reduce idle composer height, grow multiline drafts, and anchor Latest to one observed composer region. Keep model/effort/action controls inside narrow widths. Shorten only the compact provider-default display label.
- Unify editor/header/body/footer insets and wrapping. Fix app-shell focus scrolling after compact drawers by making the outer app a clipped, non-scrollable container; preserve inner scroll regions.
- Strict build and 185 Node tests passed. Seven Chromium suites passed 291 checks, including 103 spacing checks. Phone/tablet coverage is emulation, not physical-device or native Windows testing.
- Three synthetic streaming runs per version against the supplied 0.6 preview: unchanged Markdown/template input counts, zero measured-phase artifact remounts.

## 0.6.0 — revision editors, project hierarchy and responsive touch layouts

- Added a common retained editor for composer drafts, earlier prompts, completed answers and existing returned thinking. Includes Write/Preview/Changes, source formatting, native undo, independent buffers, original restoration, explicit save and a dirty-close guard.
- Prompt changes create unsent branches; answer/thinking changes create continuation branches. Preserve originals, tool call/result pairs and visualization positions, detect stale edits, and clearly label thinking revisions as local annotations. Restoring original narration retains correct subsequent model context.
- Added project organization, thread grouping, active project/thread headings, rename/move/create actions and original-branch navigation. Migrate older workspaces without losing threads; project removal keeps conversations.
- Added phone fullscreen editors, touch controls, ephemeral navigation/advanced/artifact drawers, visual-viewport sizing, keyboard-height/rotation handling, readable adaptive chart geometry and local table overflow. Touch Enter inserts a newline; IME confirmation is not submission.
- Strict build and 180 Node tests passed. Six Chromium suites passed 188 checks, including 19 editing checks and 89 touch/viewport checks across eight sizes. Device/keyboard tests are emulation, not physical phones, native Windows or live-provider tests. The validation record also documents an intermittent rapid-modal checkbox hit-test issue from stress reruns.
- Compared authentic 0.5 and current previews in three synthetic runs: identical Markdown input work; 0.26% more template input. No measured-phase visualization remounts.

## 0.5.0 — seamless neutral visualizations and lower-overhead rendering

- Removed navy visualization surfaces, enclosing card borders/shadows and the second header strip. Kept the inline text–figure–text layout, compact controls, neutral axes/table rules and optional expanded workspace.
- Made host SVG and HTML surfaces transparent. Matched iframe/root color schemes to prevent Chromium's white default canvas. Supplied document styles are not recolored; generated SVG labels/series get a high-contrast print palette for white PDF pages.
- Separated rich-text islands from reply chrome. Skip unchanged segments and all closed reasoning, retain code-block offsets, and use bounded math/code LRU caches instead of repeated typesetting.
- Added coalesced frame scheduling, hidden-window deferral and immediate final/approval updates. Pause transcript work while a modal is open; preserve input controls above lazy frames.
- Lazily mount off-screen figures near the viewport. Retain at most three static tab surfaces per selected inline revision; preserve chart series and table filters across tabs/collapse. Reconcile SVG series nodes, debounce table search and avoid redundant dense line/area point markers without dropping samples.
- Stop an interactive HTML frame on leaving Preview/collapsing, rather than falsely describing a hidden frame as suspended. Scrolling alone does not terminate opted-in JavaScript.
- Strict build and 149 Node tests passed. Four browser suites passed 80 checks; the shared Chromium print-layout suite passed four checks. Added a three-run v0.4/v0.5 synthetic render-work comparison and actual-composited iframe background test. No live provider, native Windows/Electron/PDF.js or installer validation is claimed.


## 0.4.0 — 27 September 2026

Inline visualizations and motion.

- Render charts, tables, diagrams, HTML and existing supported document/image artifacts inside responses. Keep the workspace for explicit expansion; new workspace defaults no longer auto-open it.
- Preserve pre-tool narration; record insertion offsets and a final-round offset so the model sees each assistant round only once.
- Reconcile keyed DOM islands instead of rebuilding streamed replies or all previous turns. Keep chart selection, filters and inline HTML state stable.
- Group artifact revisions in one card; provide inline Preview/Data/Source, eight-row table paging, Collapse and keyboard tab navigation.
- Add a dark-blue visual palette, restrained entry effects, chart stroke/bar animations, live thinking waves and a streaming cursor. Support OS and in-app reduced motion.
- Add an inline demo and 15 core/service plus 20 browser layout/motion checks. Native Windows and live-provider validation remain outstanding.

## 0.3.0 — 27 September 2026

Added six model-callable visual tools: chart, table, diagram, artifact creation, immutable revision and bounded source reading. Visualization is independent of Python, with provider-call results and artifact IDs returned through the real tool loop. New conversations enable visual tools; existing workspaces migrate with them off.

Added a collapsible/expandable artifact side panel with revision selection, Preview/Source/Data, searchable and sortable table data, series visibility, local preview, explicit save/PDF export and stable state during streaming. HTML interaction is an explicit per-preview opaque sandbox; ordinary previews remain static. PDF creation uses isolated JavaScript-disabled Electron printing, and viewing uses locally packaged PDF.js pages/text/zoom. Native PDF integration is implemented but not executed in preparation.

Added provider-metadata-driven reasoning controls, narrow Tinfoil DeepSeek V4 high/max and requested Kimi K3 fixed-effort fallbacks, unknown-model defaults, model-change reset and separate comparison capabilities. Removed the old preview modal. Preserved reasoning/Markdown/LaTeX, branches, Python approvals and encrypted persistence.

Validation: 121 Node tests, 43 browser checks across two suites, and a separate four-check Chromium print-layout fixture. Live API, actual PDF.js, Electron/Windows/DPAPI and installer execution remain unverified. Native smoke and CI now require a real PDF print/view round trip.

## 0.2.0

Progressive disclosure; provider reasoning display; offline Markdown, syntax highlighting and mathematical LaTeX; reading controls; in-conversation search; explicit native Python tool loop and generated files; static previews. Tested with 79 Node tests and 22 browser checks at that revision.

## 0.1.0

Initial TypeScript/Electron client, attested Tinfoil API adapter, encrypted local workspace, streamed conversations, model comparison, branching and Windows packaging configuration. No GitHub repository was created.
