# Tinfoil Workbench 0.7 — validation record

Prepared 28 September 2026 against the delivered source. The package is source plus an offline synthetic preview, not a verified Windows installer.

## Executed against this revision

Strict TypeScript compilation passed. Node ran **185 tests: 185 passed, zero failed, zero skipped**. This includes five new chart/diagram spacing-geometry tests and the retained core, service, editing/project, tool, vault, rendering and Linux Python-runner tests. Synthetic provider adapters do not establish live API compatibility.

The final seven production-renderer Chromium suites passed **291 checks**:

| Suite | Passed |
| --- | ---: |
| ui-smoke.py | 22 |
| ui-artifacts.py | 21 |
| ui-inline.py | 20 |
| ui-seamless.py | 17 |
| ui-editing.py | 19 |
| ui-responsive.py | 89 |
| ui-spacing.py | 103 |

No unhandled JavaScript or ResizeObserver-loop errors were reported in the final spacing suite. The original renderer/security suites retain checks for inert model HTML, sandboxed previews, refused credentials/execution in offline mode, transparency, interaction persistence, tool approvals, model-specific effort controls and no unintended external requests.

A separate attempt to navigate directly to the standalone HTML through `file://` was blocked by this environment's Chromium administrator policy (`ERR_BLOCKED_BY_ADMINISTRATOR`). That navigation was not executed or counted as a pass. The seven renderer suites test the actual bundled HTML through Playwright `page.set_content`.

## Spacing and responsive scope

The new matrix covers 1440×1000 and 1280×800 mouse layouts; 820×1180, 768×1024 and 1024×768 tablet layouts; and 390×844, 320×740, 360×800 and 430×932 phone layouts. Existing responsive tests additionally cover 1280×800 touch. Additional checks cover a narrow desktop split workspace and simulated keyboard-height/rotation views at 390×420 and 844×390.

The spacing suite measures matched transcript/composer edges, bounded message/header gaps, empty and multiline composer heights, Latest positioning, effort/model/Stop/Send collisions, editor insets and action visibility, workspace wrapping and advanced-field containment. It identified and regressed a programmatic outer-app scroll after compact drawer focus restoration. The final matrix asserts the outer app and document remain unscrolled while inner regions remain scrollable. Actual-renderer screenshots in this package use clearly synthetic data, and desktop, phone, tablet, editor and split-workspace captures were visually inspected.

These are Linux Chromium viewport/touch tests. They are not physical phone/tablet tests, actual on-screen-keyboard tests, Safari/WebKit, Android Chrome, native Windows touch, safe-area hardware validation or formal accessibility certification.

## Rendering regression

Three runs per version compare the supplied 0.6 preview with the rebuilt 0.7 preview. In the measured synthetic streaming phase, both process 4,395 Markdown characters and 275,176 template characters with zero artifact remounts. The spacing update does not increase these work counters. This is not an overall speed, GPU/power, token-cost or live-inference benchmark. Individual runs and the baseline SHA-256 are retained in render-cost.json; see RENDERING.md.

## Earlier-run observations and corrections

One earlier smoke run missed a Run Python click immediately after rapid focus/sidebar shortcuts. An instrumented rerun and subsequent unchanged smoke-test runs passed. It is not claimed as a conclusively fixed browser hit-test issue. The earlier 0.6 rapid-modal checkbox issue remains historical context rather than an asserted universal fix; its original record is under history/v0.6/.

The shell-scroll bug is separate: diagnostics measured #app scrolling by 10px on a tablet and 40px on a phone while document scroll remained zero. A non-scrollable outer app fixed the observed layout, and explicit post-transition assertions now cover it.

Initial attempts to launch two suites without the system Chromium path found no bundled Playwright browser; explicit `/usr/bin/chromium` resolved the test environment. A label assertion was updated from “Provider default” to the intentionally shorter quick-picker “Default” while adding a check that its value remains `default`. A combined long test invocation was interrupted by a tool timeout and rerun as individual suites. None of those incomplete attempts are counted as passed executions.

## Not executed

Native Windows Electron, DPAPI, actual PDF.js/native printing, installers, signing, ARM64, live Tinfoil credentials/attestation/inference, subscription-backed authentication and remote GitHub actions were not exercised. No repository was created or pushed. Dependency downloads and a dependency lockfile were not fabricated.

No new PDF print-layout execution is claimed. Historical 0.5 PDF test artifacts remain under history/v0.5/. New unit tests assert the tight chart option does not change headed/print chart output. This does not replace native PDF integration testing.

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
python tests/ui-spacing.py --chromium <chromium>
python tests/render-cost.py --baseline <supplied-v0.6-preview.html> --runs 3 --chromium <chromium>
```

Python UI scripts require Playwright; some transparency checks also require Pillow. Root-owned isolated test containers used test-only Chromium `--no-sandbox` flags. The production Electron sandbox remains enabled. Before releasing on Windows, bootstrap dependencies, run the native smoke test and live-provider checks, then package. Back up the encrypted workspace before upgrading.
