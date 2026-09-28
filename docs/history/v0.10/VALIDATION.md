# Tinfoil Workbench 0.10 — validation record

Prepared 28 September 2026. Source/build-candidate handoff, not a verified Windows executable or live account result. **The custom system prompt is optional and not required.** Blank ordinary-chat instructions remain covered by tests.

## Executed preparation checks

Strict TypeScript compilation passed using TypeScript 5.8.3 on Node.js 22.16.0. Node ran **282 automated tests: 282 passed, zero failed, zero skipped**. Existing suites cover service/core behavior, serialization, accounts, tools, rendering, protected execution and validation. The 30 added handoff tests cover durable draft references, safe migration/branching, ID-bound close coordination and durable-write gating, cancellation/fallback races, source/dependency doctor, bootstrap/CI/packaging contracts and awaited clipboard completion. Actual Python-runner tests used the Linux interpreter; native window and OS storage tests use injected objects, not Electron on Windows.

All desktop/script JavaScript files passed node --check; the per-file result is javascript-syntax-checks.json. This is syntax checking, not execution of native APIs or a dependency install. Source doctor passed 10 checks. Dependency doctor correctly failed because the lockfile, npm dependency tree and Electron executable are absent. That expected readiness failure must become a pass after local bootstrap; it is not counted as a native pass.

Ten production-renderer suites passed **413 browser checks**:

| Suite | Checks |
| --- | ---: |
| ui-smoke.py | 22 |
| ui-artifacts.py | 21 |
| ui-inline.py | 20 |
| ui-seamless.py | 17 |
| ui-editing.py | 19 |
| ui-responsive.py | 89 |
| ui-spacing.py | 103 |
| ui-activity.py | 32 |
| ui-account.py | 66 |
| ui-handoff.py | 24 |

The new handoff suite checks persisted unsent text/references, immediate close flushing, attachment removal, simulated save-failure retention, blocked editor entry after failed flush, independent pending Advanced values, actual field reset on Discard, restored model-specific effort options, blank instructions, cleared unsubmitted credentials, top-layer error feedback and accessible headings. It exercises keep/discard/Escape review over a real editor and active response, plus 320×740, 390×844, 820×1180 and 1024×768 emulated touch close paths. Native close transport is explicitly injected into an in-memory preview copy. The release preview has no test hook or real close authority.

An additional **four shared PDF-layout checks passed**: one A4 page, expected extracted text/table values, inert embedded script and no network requests. The resulting PDF and PNG were generated and the PNG visually inspected. This uses the production printable-document stylesheet and headless Chromium, not Electron printing, the actual installed PDF.js worker or DPAPI.

The three-run rendering comparison against the authentic supplied v0.9 HTML processed exactly **4,395 Markdown characters in 30 calls, 186,237 template-input characters in 62 updates, and zero artifact remounts** during the measured phase in both versions. See render-cost.json and RENDERING.md. Setup, login page, close-time writes and native GPU/latency are excluded; no general speed or power claim follows.

## Environment and limits

Renderer execution used Linux Chromium 144.0.7559.96 via Python Playwright and page.set_content. That browser is not the pinned Electron runtime. Phone/tablet tests are viewport/touch emulation, not physical devices, Safari, Android Chrome or real virtual-keyboard/account tests. The production renderer and synthetic bridge were exercised; no provider access was implied by demo data.

An actual npm registry probe failed with EAI_AGAIN for registry.npmjs.org. No dependency installation, verified transitive lockfile, installed-library native test or registry audit is supplied. The exact direct toolchain pins were checked against official release information but were not installed here. Bootstrap must generate and retain the real lockfile; normal install lifecycle downloads must complete.

Attempts to navigate Chromium directly to both the standalone file:// preview and the local loopback HTTP preview were blocked by this environment with ERR_BLOCKED_BY_ADMINISTRATOR. No browser policy was disabled. Successful renderer tests used in-memory page.set_content instead, so ordinary URL deployment remains a local acceptance check. These navigation failures are not presented as successful file/HTTP preview tests.

## Review findings and attempt history

The review found native close bypassing renderer draft flushing, attachment references held only in UI memory, pending Advanced values lost on thread changes, and floating desktop build dependencies. These were corrected. Later checks caught a cached render signature that let Discard retain old values in the input controls; a field-level regression now verifies actual restoration. The final native close also performs a main-process durable write: an in-memory failure snapshot can no longer make an unsaved draft look safe to close. Explicit plaintext export remains a user-selected recovery route after disk failure.

Initial handoff-test attempts needed correction for the transpiled fixture hook and ambiguous editor controls. Assertions were corrected to target the real edit-dialog element and confirm its existence. They are not counted as passing attempts. A synchronous combined final suite run was stopped by the outer tool timeout after five suites; its child transport logged EPIPE when torn down. The interrupted aggregate was not treated as a successful run. Complete rerun exit codes and per-suite records are retained separately in the final evidence.

Twelve rapid Reading/focus/sidebar cycles with 24 genuine, non-forced checkbox clicks passed without an explicit layout-settle sleep in the new loop. The earlier intermittent hit-test issue did not recur in this test; this is not a claimed conclusive root-cause fix. The inherited ordinary smoke still contains its documented settle wait. Continue the rapid-interaction acceptance check on Windows.

## Not executed

No actual Windows Electron launch, DPAPI operation, native close/force-close dialog, native clipboard action, installed PDF.js/printing round trip, PowerShell build helper, installer creation, signing, ARM64 execution or physical-device test ran here. New lifecycle tests are injected/unit tests; the native smoke is included for local execution and was not replaced by a mock success.

No live Tinfoil sign-in, social/passkey interaction, subscription token exchange, profile mutation, remote session revocation, attestation/inference, hosted MCP/search or child-model request was performed. The website-session adapter remains experimental. A real-account login and a minimal nonsensitive inference test are required on the target machine. Neither a mock profile nor a successful source build establishes account access.

No GitHub repository was created/pushed and no remote CI or release-upload action ran. The locally edited workflow gates packaging behind a reviewed lockfile and tests; it is configuration, not a green run. No executable or credentials are part of the source handoff.

## Local reproduction

```powershell
npm run bootstrap
npm run doctor
npm test
npm run smoke:desktop
npm start
```

Only after the manual acceptance steps in HANDOFF.md should `npm run dist:win` be used for a candidate installer/portable build. It reruns dependency checks, automated tests and native smoke without publishing. Source-only checks are available as `npm run check:source` and intentionally omit native readiness.

For development-only browser reproduction, rebuild the preview with `npm run preview:build` and run the ten tests listed above with `--chromium <executable>`. The inherited smoke and spacing scripts accept an additional test-only `--no-sandbox` for a root-owned Linux test container; this does not disable the application sandbox. Other scripts have the existing Linux launch configuration. Python Playwright and Pillow are required; shared PDF layout also uses PyMuPDF. See RENDERING.md for the authentic-baseline workload command. On Windows without a Python interpreter some native-runner tests skip; report that distinction.

## Build reference checks

Official references inspected on 28 September 2026 for this handoff, not copied application implementations:

- Electron 44.4.3 release: https://releases.electronjs.org/release/v44.4.3
- Electron clipboard Promise contract: https://www.electronjs.org/docs/latest/api/clipboard
- Electron security checklist: https://www.electronjs.org/docs/latest/tutorial/security
- electron-builder published releases (26.17.0 pin): https://github.com/electron-userland/electron-builder/releases

Pinned versions and official documentation do not establish that this uninstalled dependency graph has passed a security audit. Keep the generated lockfile, review install/audit output and record the local Electron/Windows versions with the acceptance results.
