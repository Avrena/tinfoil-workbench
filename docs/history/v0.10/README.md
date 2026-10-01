# Tinfoil Workbench 0.10 — local-build handoff

An unofficial private Windows 11 client in TypeScript and Electron. The conversation-first interface uses neutral grey surfaces, inline visualizations, versioned artifacts and progressive disclosure. This package is source and a synthetic offline preview, not an installed, signed or live-provider-certified Windows release.

**The custom system prompt is optional and not required.** Leave Advanced instructions blank for ordinary chat. Blank instructions do not inject a custom system message; they do not remove the provider’s own defaults.

![Production renderer with synthetic demonstration data](docs/preview.png)

## Build locally on Windows

Install Node.js 22.12 or newer and extract the entire archive to a writable local folder. Open PowerShell in the folder containing package.json, not its parent. Ordinary chat does not require Python, WSL, Docker or a local GPU.

```powershell
npm run bootstrap
npm run doctor
npm test
npm run smoke:desktop
npm start
```

The first bootstrap uses the declared exact dependency versions and writes a genuine package-lock.json. Review and retain that lockfile. Subsequent bootstrap runs use npm ci. Do not replace dependencies with latest or use npm audit fix --force to work around failures. Network/DNS restrictions prevented dependency installation in the preparation environment; no lockfile or native binaries have been fabricated.

The reviewed direct pins are Electron 44.4.3, electron-builder 26.17.0, TypeScript 5.8.3, Tinfoil 1.2.1 and pdfjs-dist 5.4.149. A pinned version is not a transitive security audit or proof of native compatibility. `doctor` checks the local lockfile, installed versions and native/PDF build inputs without network access, account access or code execution. `check:source` intentionally performs only source-layout checks and is not a substitute.

A successful desktop smoke ends with `DESKTOP_SMOKE_OK`. It uses an isolated temporary workspace to check the encrypted storage/bridge and a real HTML-to-PDF/PDF.js round trip. It does not sign in, invoke a model, or test the full interactive close lifecycle. See [the handoff checklist](docs/HANDOFF.md) for the remaining manual acceptance steps.

When those steps pass:

```powershell
npm run dist:win
```

This command reruns doctor, automated tests and native smoke before building the x64 per-user NSIS installer and portable executable in `release/`. It does not publish. `dist:arm64` exists but has not been validated. Artifacts remain unsigned unless you separately configure signing. Standard end users need neither Node.js nor a separate browser runtime after a working package is built.

Alternatively, `scripts/Local-Build.ps1 -Bootstrap -Package` runs the same sequential local checks and packaging. The PowerShell helper was reviewed but not executed in this Linux environment. Direct npm commands are the reference path.

## Changes in this handoff

Composer text and selected UTF-8 attachment contents now persist together in the encrypted workspace. A normal window close flushes the newest draft; it does not send it. Unsaved message-editor changes, unapplied Advanced settings and active response/tool work receive a close review. Keep working and Escape retain the edits. An unsuccessful write prevents the normal close. The main process performs a final durable write even if a failure snapshot made the renderer appear up to date. A crashed/unresponsive renderer has a separate native force-close decision, not a silent discard.

Advanced edits are kept independently per thread for the current session, with a small Apply/Discard row only when needed. Switching threads restores the pending model and its supported thinking controls. Discard resets the actual input fields as well as the pending flag. Unapplied settings are never sent. Editor, import and branching actions stop when the draft cannot be saved. Explicit plaintext export remains available as a recovery route; it does not close the application. Deleted threads also release their cached UI drafts.

Errors are shown within the active dialog rather than only in a toast behind it. Dismissing Settings clears an unsubmitted API-key field. Dialogs have accessible names; the first desktop workspace offers a direct connection action. Clipboard completion is awaited. Transparent inline figures, retained rendering islands and existing keyboard/touch spacing are preserved.

## Accounts, responses and tools

Open Account & connection to explicitly choose the experimental Tinfoil Chat website-session flow or the separate developer API-key mode. Both feed the official verified SDK/EHBP inference adapter. Neither silently falls back to the other. Successful sign-in should be followed by Verify enclave & load models. The custom system prompt is optional throughout.

Chat sign-in uses a temporary provider-website window with no Workbench preload or Node bridge. Profile/security edits remain in the provider’s UI. Sessions last until sign-out or app exit; there is no Remember me. Signing in does not enable cloud sync or conceal this Windows user’s locally stored conversations. Existing history requires explicit approval before crossing Chat identities or Chat/API modes. [Account behavior and limitations](docs/ACCOUNT.md) describes the experimental integration and required live testing.

Markdown, LaTeX, source viewing and provider-returned reasoning have separate reading controls. Thinking effort is capability-driven; unsupported models do not acquire fake controls. Editing a response or earlier prompt creates an explicit branch, and edited thinking is a local annotation rather than fabricated model reasoning. Projects organize local threads; they do not inject shared instructions or model memory.

Visual tools create charts, tables, diagrams and versioned documents inside the answer. Preview, Source and Data can expand into the artifact workspace. HTML is static by default; explicitly enabled interaction runs in an opaque, network-restricted frame without native privileges. PDF previews require the installed local PDF.js module. Local files opened for preview are not automatically sent to a model. See [architecture](docs/ARCHITECTURE.md), [editing/mobile](docs/EDITING-AND-MOBILE.md) and [security](SECURITY.md).

Tool batches execute sequentially and retain per-action approvals. Tinfoil-managed MCP records show provider-reported activity; they cannot invoke a local tool. Hosted search and text-only client delegation are opt-in. Delegation is an approved same-model extra request with no automatic parent history or child tools, not a claim of a native provider sub-agent API. Arbitrary MCP server setup and hosted code-execution provisioning are not implemented. See [activity](docs/ACTIVITY.md).

Python runs locally with the current user’s file and network permissions: **it is not a security sandbox**. Install/select an interpreter only to use that feature. Each run requires exact-code approval and native confirmation; there is no always-allow option. Rendering a code block does not run it. Timeout/cancellation/output limits do not make approved code trustworthy. Tests skip native-Python cases if no interpreter is available; skipped tests must be recorded rather than counted as passes.

## Preview and evidence

`preview/index.html` is a standalone production-renderer demonstration with labelled synthetic responses, memory-only history, rejected credentials and no Python execution. It cannot authenticate. `npm run preview:build` rebuilds it; `npm run preview` serves the modular demo on loopback. Both are excluded from Windows packaging.

[Validation](docs/VALIDATION.md) records the actual preparation results and environment limits. [Rendering measurements](docs/RENDERING.md) describe a synthetic workload, not overall latency or power claims. Source checks, browser emulation and injected Electron objects are not native Windows, physical-device or live-account tests.

Keyboard shortcuts: Ctrl+N new thread; Ctrl+K commands; Ctrl+F conversation search; Ctrl+B sidebar; Ctrl+Shift+F focus; Ctrl+Shift+A artifacts; Ctrl+, Settings. Desktop Enter sends, Shift+Enter inserts a newline. On touch layouts Enter inserts a newline and Send or Ctrl/Cmd+Enter submits. IME confirmation never intentionally submits. Ctrl/Cmd+Enter in the editor saves without generating.

Back up the encrypted workspace before upgrading. The encryption key is protected for the local OS user; copying workspace.vault alone is not a portable account recovery method. Avoid opening the updated workspace in an older build. Plaintext conversation/artifact exports need private storage.

No GitHub repository was created or pushed, no remote workflow was run, and no executable is included. Do the local checks and review the lockfile before distribution. The application code is licensed under Apache-2.0; third-party notices are in NOTICE.md.
