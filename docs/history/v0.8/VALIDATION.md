# Tinfoil Workbench 0.8 — validation record

Prepared 28 September 2026. This is source plus a bundled offline preview, not a verified Windows installer or a live-provider acceptance result.

## Executed

Strict TypeScript compilation and JavaScript syntax checks passed. Node ran **217 tests: 217 passed, zero failed, zero skipped**. The 32 new tests cover marker parsing across every two-chunk boundary, malformed/unknown/oversized markers, inert provider data and argument redaction, safe links, batch grouping/statuses/persistence, native call/result pairing, individual approvals, disabled permissions, queue cancellation, delegated request construction, no inherited history/tools, child tool rejection/stream abort, child timeout, per-child/parent cancellation, partial completions, separate usage, two-request budget shared across comparison lanes, and Markdown export. The injected provider and vault interfaces do not establish live Tinfoil availability.

Eight production-renderer browser suites passed **323 checks**:

| Suite | Passed |
| --- | ---: |
| ui-smoke.py | 22 |
| ui-artifacts.py | 21 |
| ui-inline.py | 20 |
| ui-seamless.py | 17 |
| ui-editing.py | 19 |
| ui-responsive.py | 89 |
| ui-spacing.py | 103 |
| ui-activity.py | 32 |

The activity suite uses the actual bundled renderer with in-memory synthetic snapshots. It checks staged batches, approvals visible with hidden reasoning, accurate mixed outcomes, lazy child output, separately rendered child Markdown/math/reasoning/usage, retained open disclosures, source navigation guarding, default-off settings and save-on-Apply. Genuine pointer/tap tests cover 320×740, 390×844, 820×1180 and 1280×900; existing suites retain their wider geometry and rotation matrix. No JavaScript errors or unintended external requests were observed in the new suite. These are Chromium emulation tests, not physical phones/tablets, Safari, Android Chrome or real on-screen keyboards.

The three-run rendering comparison against supplied 0.7 processed the same 4,395 Markdown characters and zero artifact remounts. Template input decreased from 275,176 to 186,237 characters (32.32%) because closed tool details are deferred. See RENDERING.md and render-cost.json. This is not a whole-app speed, hardware power or model billing measurement.

## Earlier attempts and an inherited stress case

The original no-settle smoke flow repeatedly missed a Run Python pointer click immediately after rapid focus/sidebar toggles. This same class of issue was already documented in 0.7. A fresh-page direct click worked. The normal smoke script now explicitly waits for the visible sidebar, scrolls the actual button into view and allows 250 ms for the queued layout commit before issuing a genuine pointer click. Two final full runs passed. This is **not** presented as a universal fix for the rapid/no-settle browser hit-test condition; that stress behavior remains open. No programmatic click or fabricated execution result is used to make the smoke test pass.

A first spacing run caught excess separation introduced by placing tool activity outside the existing context row. Returning it to that row and preserving full-width active/expanded groups restored the established 103 geometry checks. Initial runner invocations passed an unsupported --no-sandbox argument to two older scripts; correct invocations were rerun and those initial failures are not counted as successes. An initial activity fixture referenced a transformed import by its source name; the test hook was corrected to load the actual bundled module. It does not alter the shipped preview.

## Not exercised

No real user credential, live attestation, hosted MCP call, delegated inference or provider billing was exercised. No arbitrary MCP server or native hosted sub-agent endpoint is claimed. Native Windows Electron, DPAPI, exact-task native dialogs, actual PDF.js/printing, packaging, signing, ARM64 and remote CI remain untested in this environment. No repository was created or pushed. API-key authentication is unchanged; browser/subscription-backed authentication has not been added.

No new PDF-layout execution is claimed. Existing source adapters and historical PDF records are retained separately. Dependency downloads or a lockfile were not fabricated. The bundled preview was exercised through Playwright page.set_content; direct file:// navigation was previously blocked by the environment's browser policy and is not asserted newly verified.

## Reproduce

```text
npm run bootstrap
npm run preview:build
npm test
python tests/ui-smoke.py --chromium <chromium>
python tests/ui-artifacts.py --chromium <chromium>
python tests/ui-inline.py --chromium <chromium>
python tests/ui-seamless.py --chromium <chromium>
python tests/ui-editing.py --chromium <chromium>
python tests/ui-responsive.py --chromium <chromium>
python tests/ui-spacing.py --chromium <chromium>
python tests/ui-activity.py --chromium <chromium>
python tests/render-cost.py --baseline <supplied-v0.7-preview.html> --runs 3 --chromium <chromium>
```

Python UI scripts require Playwright; some retained checks use Pillow. Root-owned isolated containers pass test-only Chromium no-sandbox flags (some older scripts already include it). Production Electron remains sandboxed. Before Windows release, run `npm run smoke:desktop`, review exact-task approvals/cancellation, validate real model tool calling/search with nonsensitive input and explicit usage limits, then package. Back up the encrypted workspace before upgrading.
