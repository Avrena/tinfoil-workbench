# Working on Tinfoil Workbench

Keep this project private. Never push to upstream or a different owner. Do not commit credentials, vaults, real transcripts, generated private files or signing keys. The private-publishing helper has not been run. Do not fabricate repository, release, CI, dependency or live-provider results.

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

The website adapter is experimental until native Windows and real provider authentication are tested; mock-Electron tests cannot establish native correctness. Profile edits belong to the provider UI, not a fabricated local success. Keep sign-out local cleanup unconditional and remote revocation best-effort. Cloud sync and per-account encrypted workspaces are not implemented. Account-only profile data must not be silently placed in prompts. Preserve extra approval before existing history crosses a Chat identity or Chat/API mode; approval alone never sends.


## 0.10 handoff invariants

Draft text and selected attachment contents must persist atomically in the encrypted workspace. Old workspaces default to an empty draftAttachments array. Never execute or send an attachment on reopen. Block destructive navigation/edit/import continuations when draft flushing fails. Explicit plaintext export remains a recovery route and never implicitly closes the application. Pending Advanced values are session-only per-thread UI drafts; apply explicitly, restore supported model controls before their selection, and discard the actual inputs as well as their dirty marker.

All ordinary native close paths must go through CloseCoordinator. Ignore stale/duplicate close responses; acknowledgements stop the initial watchdog while a human reads. An unavailable renderer needs a native explicit force-close decision; save errors default to keeping the window open. Keep the exposed bridge narrow and validate request IDs/booleans in the main process. Do not claim crash/power-loss durability from normal-close tests.

Keep exact reviewed direct pins and genuine lockfile requirements. Doctor is read-only, source-only mode is not installation success, and packaging must run real native smoke after installation. Do not substitute mocks or missing-library output for the PDF.js or DPAPI acceptance check. No force upgrades, automatic publication or user credentials in tests. Follow docs/HANDOFF.md before describing a release as Windows-validated.
