# Architecture — 0.5

The renderer remains vanilla TypeScript; Electron main owns native dialogs, state, credential use, the Tinfoil adapter and encrypted persistence. The preload exposes a fixed data-only bridge. No arbitrary filesystem, terminal, network-fetch or execute-JavaScript IPC exists.

## Presentation and artifact lifetime

`src/renderer/app.ts` owns chat presentation and progressive disclosure. `dom.ts` performs keyed updates and treats managed replies and artifact hosts as DOM islands. `inline-artifacts.ts` owns one figure per revision root. `artifact-surface.ts` is shared by inline and workspace previews; no chart/HTML/PDF state is remounted just because answer text changes. `reply-layout.ts` inserts figures at safe UTF-16 offsets, groups revisions and provides a legacy end-of-answer fallback. `artifact-panel.ts` owns an independent DOM tree so streamed transcript updates do not reset an iframe, chart selection, revision or PDF page. Automatic workspace opening is optional and defaults off; manual closing suppresses reopening until a new turn. Thread switches reset panel scope. Temporary local/code-block previews are separate from persisted model artifacts.

`artifacts.ts` has two paths: static sanitized HTML/SVG and explicitly selected interactive HTML. Both use an opaque srcdoc frame. Only interaction adds `allow-scripts`; it does not add same-origin privileges. Inline script nodes receive a constrained nonce after external-script/unsafe-element removal. Event attributes are not executed. CSS and embedded raster images are permitted only within the restrictive frame policy. No parent bridge or network is available.

Typed charts/tables/diagrams use host-owned rendering from validated data, not model-generated JavaScript. Table operations, series visibility, data views and version selection do not call a provider. Source view never executes content.

`pdf-viewer.ts` loads the local PDF.js module and worker after dependency bootstrap. It receives only bytes, renders canvas/text, bounds rendered pixel count, disables eval/XFA/actions, and destroys the task when leaving the artifact. Zoom/page state is not replaced by transcript updates. Loading failures are visible; missing-library behavior is not a fake PDF preview.

## Registered tool execution

`src/core/visual-tools.ts` defines schemas, bounds and structured renderers. `desktop/visual-runtime.mjs` implements six tools: chart, table, diagram, artifact create, immutable update and bounded source read. Its PDF renderer is injected so service tests do not pretend to exercise Electron.

`desktop/service.mjs` offers visual tools and Python independently. Known `toolCalling:false` suppresses all schemas. Calls are assembled from streamed fragments, matched to the offered registry, bounded by round/call limits, and returned as paired assistant/tool history. Unknown tools never reach a native executor. Visual tools have no approval step because they do not perform native arbitrary code execution or unsolicited disk writes. Python retains its separate single-use approval path and native exact-code dialog.

Every created artifact returns ID, kind and revision metadata. Updates retain the original and generate a new ID with root/parent/version references. `read_artifact` sees only selected ancestor replies and artifacts in the current reply; it excludes other conversations, unselected comparison replies and manual runs. This is source access, not rendered image inspection. PNG/PDF without textual source return metadata only. Generated binary bytes are not automatically resent to the model.

The service retains narration across tool rounds in `reply.content`. `ToolRun.contentOffset` anchors an inline artifact at the tool boundary. `Reply.finalContentOffset` marks the final assistant round: `buildHistory` sends earlier narration through its existing tool messages and only the final slice as the final assistant message. `Reply.phase` follows real waiting/reasoning/content events, independently of model-specific generation controls. These fields are additive, validated, and never accepted as model-executable markup.

The service uses independently constructed request histories/capabilities for comparison lanes. Provider-supplied reasoning attached to tool calls is retained where the existing tool protocol needs it. It does not synthesize reasoning or silently retry provider calls. Usage sums provider-reported values, not inferred token counts.

## PDF and native actions

`desktop/pdf-renderer.mjs` uses `printableDocument` plus a hidden, ephemeral-session BrowserWindow. It has no preload/IPC, JavaScript is disabled, permissions/downloads/navigation are denied, and request filtering permits only the initial data document plus embedded data images. Printing is bounded by time and resulting bytes. No untrusted path is opened.

Model PDF creation stores output in the encrypted workspace. User PDF export first obtains an explicit save path, renders supported source/data (or reuses original PDF bytes), and writes that file. The PDF export is script-free but unencrypted. Saving raw HTML/SVG warns that external applications do not inherit preview restrictions.

Local Open file is a native picker with regular-file and bounded-read checks. The response returns temporary bytes directly to the renderer, not to the model service's artifact scope. Python remains local account-permission execution, not a sandbox. It alone uses the explicit configured interpreter and execution approvals.

## Capability negotiation

`capabilities.ts` distinguishes reasoning presence, effort vocabulary, enable/disable blocks and tool support. `model-catalog.mjs` loads bounded public metadata from one fixed Tinfoil origin without credentials. SDK model discovery continues through the verified adapter. Metadata can add only sanitized endpoint-specific reasoning fields; it cannot override identity, destinations, messages or tool permissions.

Catalog data takes precedence over narrow bundled provider profiles. DeepSeek V4 Pro/Flash has a high/max fallback; Kimi K3's fixed-effort fallback follows the specified requirement. Unknown models get no reasoning overrides. Defaults omit fields, model changes clear old choices, and comparisons never share reasoning settings inadvertently. Catalog failure does not mislabel a model as having verified capabilities; narrow fallbacks or provider default remain.

## Persistence, imports and packaging

The encrypted version-1 workspace gains additive visual settings and artifact metadata. Missing visualization settings migrate off, while new conversations opt in. Pending operations become interrupted/cancelled on recovery. Import regenerates conversation/turn/reply/tool record IDs but preserves artifact IDs scoped to the imported thread, so model references and revision ancestry remain consistent. No import resumes execution.

Snapshots exclude API key, cache secret and Python path. Artifacts and source are private conversation data, encrypted at rest but present in renderer memory while the app is open. Source/JSON export and explicitly saved files are unencrypted copies.

Build compiles TypeScript and copies renderer assets. PDF.js module/worker/license are copied from the declared dependency when installed. No font binaries are copied. The reviewed npm lockfile is committed. Desktop smoke checks actual DPAPI/bridge initialization and a production PDF print→PDF.js canvas round trip on Windows (executed for 0.15.0; see VALIDATION.md). Windows CI packages only after tests/smoke succeed.

## Motion, rendering and theme (0.5)

The transcript is neutral #1e1e1e; inline host figures have transparent SVG/HTML canvases, no outer card frame, and grey labels/rules. Series and focus accents may use restrained editor colors. Matching dark iframe/root color schemes prevent an opaque white default canvas. Explicit supplied HTML/image/PDF styles remain untouched. Generated SVG PDF exports use a distinct light-paper palette.

Rich-text islands are opaque to the outer reconciler. Per-island last-source/options state skips unchanged content; closed reasoning is rendered on opening. Math/code fragment caches are bounded and cleared on conversation changes. Frame scheduling coalesces input and defers background/modal work while preserving immediate underlying snapshots and urgent final states. A shared viewport observer handles initial off-screen figure mounting, and static inline tab surfaces retain control state. The active changed Markdown island is still parsed whole; this is not full text/DOM virtualization.

Only newly mounted visual content receives entry animation. Series toggles do not replay it. Host thinking/streaming animations respond to real state, pause in background, and respect OS/app reduced motion. Arbitrary opted-in HTML scripts cannot be suspended by CSS: leaving Preview/collapsing destroys the frame, while scrolling alone does not stop execution. See [RENDERING.md](RENDERING.md) for precise cache/view limits, implementation trade-offs and measured workload counters.

## Revision editor and project hierarchy (0.6)

`core/editing.ts` validates a complete reply plus expected source before allocating a new branch. Prompt edits branch before the turn and create a draft. Reply edits branch through a chosen reply; descendants remain only in the untouched source thread. `Reply.edit` retains the first original answer/thinking, edit flags/time and a durable `historyRewritten` flag. Once narration has been rewritten, later requests clear narration only from cloned assistant tool records, retain tool calls/results and original protocol reasoning, and send the complete edited answer once. The durable flag prevents restoring original text from accidentally using a stale final-round slice. Thinking-only annotations leave model history unchanged.

`mapEditOffset` uses a linear common-prefix/suffix mapping. Unchanged regions keep their relative anchors; a figure whose anchor was inside replaced text follows the replacement. Arbitrary prose rewriting cannot infer an ideal semantic chart location. This is positional preservation, not editable tool-output fabrication. Imports validate provenance flags and preserve revision records, but clear foreign project/branch links.

`core/projects.ts` stores bounded organizational metadata in the encrypted version-1 workspace. Missing projects migrate to an empty array. Public snapshots include projects but still omit credentials. Project removal unfiles threads; it does not remove content. No shared system prompts, memory or remote collaboration are implied.

`renderer/editor.ts` owns modal source buffers and bounded preview/change surfaces. Saves require explicit user action and optimistic source matching; incoming snapshots do not overwrite the textarea. `renderer/responsive.ts` controls ephemeral small-screen drawers, background inertness, focus return and visible-viewport dimensions without overwriting desktop preferences. Pinch zoom is not counteracted. `renderer/modal.ts` supplies a first-paint pointer guard; close/dirty confirmation is still owned by the editor. Real device/WebKit behavior requires separate validation.

## Spacing layer and shell containment (0.7)

`src/renderer/spacing.css` is appended to the existing stylesheet by `scripts/build.mjs`; no additional network request or UI library is introduced. Semantic spacing tokens and viewport/container queries handle layout. `#app` clips rather than scrolling when focus returns from a modal drawer. Transcript and composer reserve matching scrollbar gutters. One composer ResizeObserver updates its occupied height and resizes the textarea only when width changes. The dynamic height positions Latest above the composer. The chart host opts into tighter margins; standalone/print chart rendering remains byte-identical for the tested fixtures.

## Tool orchestration and provider observations (0.8)

`core/provider-events.ts` transforms only documented, complete Tinfoil markers into passive activity events while preserving normal stream order. `WorkbenchService.recordRouterEvent` scopes provider item IDs to reply/round and never inserts a duplicated router-side tool exchange into model history. `core/activity.ts` defines explicit batch grouping and a bounded delegate schema. The service registers all local calls before execution, uses its existing single-use approval map for protected actions, and retains one matching result per native function call.

`runDelegate` uses the already verified SDK client with isolated task messages. A send-wide counter covers both comparison lanes; individual AbortControllers are linked to the parent. Model-specific reasoning parameters are reused, not guessed from a name. `desktop/main.mjs` differentiates exact-code Python confirmation from exact-task delegated inference confirmation, then rechecks the pending proposal.

`renderer/activity-view.ts` creates compact outer summaries and weakly cached retained detail islands. Only opened details parse arguments/output or run rich-text rendering; child reasoning has its own disclosure. The surrounding transcript layout, visual insertion offsets and project/editor state are unchanged. New provenance/usage fields survive validated persistence and plaintext/JSON export.


## Account access (0.9)

`core/account.ts` defines credential-free display types, strict identity normalization, the observed quota schema and exact navigation origins. `desktop/account-window.mjs` owns a separate temporary unprivileged provider-site window and fixed Clerk scripts. `desktop/account-session.mjs` owns the single-flight token exchange and ephemeral credential state. Neither module writes account credentials into workspace state. The guarded main-process commands own login/cancel/manage/signout and existing-thread native authorization; the renderer cannot authorize by calling the generic service command.

The service asks the account manager for a current owner-bound credential in Chat mode, recreates the verified SDK client on token changes and rechecks before additional tool/delegate requests. Developer mode keeps its existing saved API key. Mode changes clear connection/model metadata; neither path falls back. Each new send records a local owner binding. No profile text becomes prompt context, and no cloud synchronization is added. The Account renderer's DOM updates are cached and only built while the panel is open. The separate hidden provider web page still has its own normal resource usage, not covered by transcript benchmarks. See ACCOUNT.md for the exact prototype contract and native validation gaps.

## Android host (0.11)

The Android app is a Capacitor shell around the same compiled renderer. `mobile/bridge.mjs` gives the page the preload's `window.tinfoil` surface and relays it to a dedicated worker. In the worker, `mobile/host-worker.mjs` runs the unchanged `WorkbenchService`, provider factory and model catalog with `mobile/vault.mjs` (the desktop vault format with a Keystore-wrapped key) and `mobile/commands.mjs` (the Android counterpart of the `desktop/main.mjs` command switch). Device access goes through the fixed operations in `mobile/native-ops.mjs`, implemented by `WorkbenchPlugin` in `android/app/src/main/java`. `MainActivity` applies the request allowlist, navigation lock and WebView feature gate. The renderer adapts only through the optional `platform` snapshot field (hiding window controls, Python, PDF export and Chat sign-in) and the optional `onAppEvent` callback (draft flush on pause, layered Back). `scripts/build-mobile.mjs` bundles the bridge and worker with esbuild into `mobile-dist/`; `scripts/android-build.mjs` syncs and builds the APK. See [ANDROID.md](ANDROID.md).

## System instructions selection (0.12)

`GenerationSettings.systemPrompt` remains the only instruction text that is sent: `buildHistory` adds it as the first system message when it is not blank. `systemPromptName` is a display name for that text; validation clears it for blank instructions and rejects multi-line names. `beginTurn` copies the name onto each new reply as `Reply.systemPromptName` (`''` for unnamed text; absent when no custom instructions were sent and on older replies), so changing instructions later never relabels earlier answers. Names never enter request bodies, tool history or delegated tasks.

`core/instructions.ts` holds the read-only starters and the library operations for `Workspace.instructionPresets`, which validation migrates to an empty list. `instructions.save` and `instructions.delete` are ordinary service commands, so the desktop and Android hosts handle them identically without new native operations. Choosing an entry is a `thread.settings` change that copies its text and name. Threads never reference the library, so editing or deleting an entry cannot change an existing conversation or a request in flight.

`renderer/instructions-view.ts` renders the picker list and the composer summary. `app.ts` owns the dialog, its unsaved-edit guard (also reported by close review) and the reply footer. The footer is one row of actions followed by a signature: model, instructions, edit state and opt-in metadata. The signature has a zero flex basis, so it fills the remaining width and truncates (its title holds the full text) when action labels appear on hover, instead of wrapping. The footer is an inline-size container; in narrow replies (phones, comparison lanes, split views) the signature takes its own last line and may wrap there. The picker ignores the second click of a double-click, and a capture-phase guard drops a double-click's second click when the first was inside an open dialog and the second lands outside every dialog at the same point, so neither can act on the controls a view switch or a closing dialog uncovers. Single replies have no header; comparison lanes keep a model label above each lane.

Escape and Android Back both call `cancelTopDialog()`. The dialog on top, `topModal()` (the most recently opened dialog that is still open; `openModal()` records the order), receives a cancelable `cancel` event and closes unless a handler keeps it open. DOM order is not the stacking order: the message editor is appended after every other dialog, so with close review open over an unsaved editor the last dialog in the document is the wrong one. The renderer handles Escape at `keydown` instead of relying on the dialog's own cancel event, because Chromium makes that event non-cancelable once a page has prevented a close since the last user activation; that let a second Escape discard unsaved text. An Escape that ends an IME composition is ignored.
