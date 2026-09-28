# Tinfoil Workbench 0.9 — validation record

Prepared 28 September 2026. Source and an offline preview, not a verified Windows release or an authenticated live-account result. The custom system prompt is optional and not required; blank ordinary-chat instructions are explicitly tested.

## Executed

Strict TypeScript compilation passed. JavaScript syntax checks passed for desktop and script modules. Node ran **252 tests: 252 passed, zero failed, zero skipped**. The 35 account tests added to the prior 217 cover identity/usage normalization against the observed flat wire format, exact-origin fixed scripts, identity/session agreement before and after async token reads, cached-key identity checks, single-flight minting, expiry, one-refresh 401 behavior, subscription/usage distinctions, bounded malformed responses, opaque errors, cancellation, sign-out/reconnect cleanup sequencing, no secret snapshots/vault/export, service account/API routing and cross-identity history approvals. Account-window behavior uses injected fake Electron objects; those tests are not native Electron execution.

Nine production-renderer browser suites passed **389 checks**:

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
| ui-account.py | 66 |

The new Account suite checks sidebar/menu/settings access, dialog dismissal and focus return, actual preview refusals, explicit synthetic-profile labeling, collapsed and retained usage disclosure, absence of fabricated quota/expiry values, subscription-required/rate-limited/expired/signing-in states, busy-state controls, explicit billing-mode selection, the API key's save-only behavior in Chat mode, blank instructions, escaped profile HTML, and no remote avatar fetch. It uses real emulated taps at 320×740, 390×844, 600×850, 820×1180, 1024×768 and 1280×800, including rotation, long-name/email wrapping, inner scrolling, close-button reachability and optional-instructions reachability. No JavaScript errors or external requests were observed in that suite.

Browser execution used Linux Chromium through Playwright. Device dimensions/touch are emulation, not physical phones, tablets, Safari, Android Chrome, or actual mobile authentication/keyboard tests. Main and account screenshots are explicitly synthetic. Test hooks for error states exist only in an instrumented in-memory copy, not the shipped renderer. Tests used `page.set_content` rather than establishing a newly verified file:// preview deployment.

The three-run comparison against the authentic supplied 0.8 HTML processed **4,395 Markdown characters**, **186,237 template-input characters**, **30 Markdown calls**, **62 template updates**, and **zero artifact remounts** during the measured phase in both versions. See RENDERING.md and render-cost.json. It excludes setup, the real provider website window, network/authentication, account-open changes, Windows GPU/power, model latency and billing. It establishes no general speed or energy result.

## Attempt history

An initial smoke invocation without the explicit system Chromium path failed because Playwright's cached browser binary was absent. Correct invocations with `/usr/bin/chromium` passed. A combined inherited-suite runner reached its outer execution timeout during the responsive test, after four earlier suites passed; responsive was then rerun individually and passed, followed by spacing and activity. This interrupted aggregate was not counted as a passing run.

Early screenshots exposed the browser's default max-width on the phone Account dialog, leaving a right-hand gap. Explicit viewport sizing removed it; the account suite checks full-width 320/390/600 layouts. Review also found the inherited API-key form would still say Save & verify while Chat mode was active. It now says Save key only and never verifies or switches billing implicitly; the UI suite covers empty-key handling and the service tests cover credential separation.

The pre-existing rapid/no-settle Reading/focus/sidebar hit-test issue remains an open stress case. The ordinary smoke test retains its previously documented layout-settle wait and passes; this revision does not claim to have conclusively fixed that separate intermittent behavior. See history/v0.8/VALIDATION.md for previous attempts.

## Not exercised

No real Tinfoil credentials, actual website sign-in, live subscription token exchange, profile change, remote session revocation, account billing, attestation, MCP call or delegated request was performed. The new website-session adapter is experimental. Its exact page integration, allowed social redirects, enabled sign-in factors, passkeys, browser policy compatibility, native window lifecycle and user/session refresh must be checked on Windows with a real account. Unsupported or changing website behavior must fail clearly; an API fallback is not a substitute for that test.

Native Windows Electron, DPAPI, the existing exact-task/history-approval dialogs, actual PDF.js/printing, installer generation, signing, ARM64, physical mobile devices and remote CI remain untested here. No GitHub repository was created or pushed. No new PDF-layout result is claimed; historical shared print records are retained separately. Dependency installation/downloads and a lockfile were not fabricated. The source build warns that installed PDF.js is absent; use bootstrap before the native PDF smoke check.

The app implements no Remember me, cloud-sync client, provider account deletion, direct billing mutations or arbitrary MCP setup. Account data is transient except a local encrypted per-thread owner binding. Signing out does not delete/hide the local workspace. The UI uses a synthetic sample profile.

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
python tests/ui-account.py --chromium <chromium>
python tests/render-cost.py --baseline <supplied-v0.8-preview.html> --runs 3 --chromium <chromium>
```

The browser tests require Python Playwright; retained image checks also use Pillow. Root-owned test containers need test-only no-sandbox flags; ui-smoke.py and ui-spacing.py accept `--no-sandbox`, and the remaining scripts include the flag in their Linux test launch. This does not disable the production Electron sandbox. Review and adapt the test runner for other environments.

Before release: bootstrap genuine dependencies and review the lockfile; run `npm run smoke:desktop`; verify the entire live sign-in/profile/refresh/sign-out cycle, optional blank-prompt chat and model discovery using nonsensitive inputs; test same/different-account thread approvals and sign-out during active requests; then validate native tools and package. A native smoke pass does not itself exercise real account login. Back up the encrypted workspace before upgrading.
