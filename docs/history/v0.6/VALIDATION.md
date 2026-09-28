# Tinfoil Workbench 0.6 — validation record

Prepared on 27 September 2026 against the delivered source. This is not a verified Windows installer or native mobile app.

## Executed

The strict TypeScript build passed. Node ran **180 tests: 180 passed, zero failed, zero skipped**. This includes the original 149 tests plus 31 editing/project/history/geometry/service tests. Core tests cover non-destructive revision branches, unsent prompt drafts, conflict detection, local-only thinking annotations, restoration after tool narration rewrites, paired tool history, project migration/removal, credential-redacted snapshots and adaptive chart geometry. Existing Linux Python execution and fake-provider service tests remain covered. Fake-provider tests are not live API evidence.

The final six production-renderer Chromium suites passed **188 checks**:

| Suite | Passed |
| --- | ---: |
| ui-smoke.py | 22 |
| ui-artifacts.py | 21 |
| ui-inline.py | 20 |
| ui-seamless.py | 17 |
| ui-editing.py | 19 |
| ui-responsive.py | 89 |

The 19 editing checks exercise actual editor controls, Markdown/math preview, inert HTML, answer/thinking buffers, Changes view, unsaved guards, stale conflicts, prompt attachments, draft expansion, native textarea undo, project creation/rename/move/removal, busy-thread editing and IME confirmation. Saves use the synthetic preview bridge; native Windows IPC/vault encryption was not exercised by those browser checks.

## Phone and tablet matrix

Chromium touch/viewport emulation used **320×740, 360×800, 390×844, 430×932, 768×1024, 820×1180, 1024×768 and 1280×800 CSS-pixel viewports**. Additional checks shrink a 390px-wide viewport to 420px high and rotate it to 844×390 while an editor is open. This simulates occupied keyboard space; it is not an actual software keyboard test.

The responsive suite uses actual emulated tap events, including drawer close and backdrop dismissal. Checks cover no page-wide overflow, readable chart label geometry (at least nine effective CSS pixels), chart tabs/series controls, local table scrolling, editor text and reachable Save, modal navigation/background inertness, advanced settings, artifact expansion, long project/thread/model names, visible Stop, touch newline behavior, unsent draft retention and preservation of desktop sidebar preferences. Screenshots in this package are captured from the actual responsive renderer with clearly synthetic fixture data. Phone, tablet, desktop and phone-editor captures were visually inspected.

This is Linux Chromium, not WebKit, iOS Safari, Android Chrome, a physical phone/tablet or a native touch Windows device. No WCAG conformance audit, screen-reader certification, safe-area hardware verification, battery or mobile-GPU benchmark is claimed. Most interactive touch controls are 40–44px; some compact secondary/status controls are smaller. The native Electron minimum is now 360×420, while browser previews are tested down to 320px wide.

## Rendering regression

Three runs per version compared the authentic supplied 0.5 preview against the rebuilt 0.6 preview. Both processed 4,395 Markdown characters in the measured streaming phase. Template input changed from 274,474 to 275,176 characters (+0.26%). Both had zero artifact remounts during measured appends. See RENDERING.md and raw render-cost.json for fixture, timing caveats and baseline checksum. This is not an overall speedup or billing reduction.

## Intermittent issue retained for follow-up

Repeated stress runs intermittently missed a direct checkbox click when the Reading dialog was closed and immediately reopened above embedded content. Instrumentation saw no pointer event delivered to the main document for the missed click even though DOM hit-testing reported the checkbox. The exact Chromium/compositor cause is unproven. Modal surfaces now use a flat scrim, explicit compositor isolation, first-paint pointer gating and hide underlying iframe surfaces without destroying their browsing context. The final six suites passed, but earlier misses are not erased or claimed conclusively fixed. Re-test rapid mouse/touch reopening and keyboard toggles on target Windows/browser builds before release.

## Not executed in this revision

No native Windows executable, Electron DPAPI, actual native PDF print/PDF.js integration, code signing, installer, ARM64 build, live Tinfoil credentials/attestation/inference, subscription-backed login or remote CI run was exercised. No GitHub repository was created or pushed. Runtime dependency downloads were not performed and a lockfile was not fabricated. Bootstrap and review dependencies on the target machine before packaging.

The four-check PDF print-layout record from 0.5 is retained separately under history/v0.5/ and is **not** counted as a 0.6 execution. PDF source paths were not changed by this update. Ordinary preview does not execute Python, accept credentials, write real files or generate model replies.

## Reproduce

```text
npm run preview:build
npm test
python tests/ui-smoke.py --chromium <chromium>
python tests/ui-artifacts.py --chromium <chromium>
python tests/ui-inline.py --chromium <chromium>
python tests/ui-seamless.py --chromium <chromium>
python tests/ui-editing.py --chromium <chromium>
python tests/ui-responsive.py --chromium <chromium>
python tests/render-cost.py --baseline <authentic-v0.5-preview.html> --runs 3 --chromium <chromium>
```

Tests require Python Playwright; some retained image checks also use Pillow. The root-owned test container used `--no-sandbox` for Chromium only; the production Electron renderer remains sandboxed. Before release on Windows: bootstrap dependencies, run `npm test`, `npm run smoke:desktop`, actual live-provider checks, then `npm run dist:win`. Back up the encrypted workspace before upgrading.
