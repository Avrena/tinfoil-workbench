# Tinfoil Workbench

An unofficial, private client for [Tinfoil](https://tinfoil.sh) confidential AI on **Windows 11 (Electron)** and **Android (Capacitor)**. Workbench is not affiliated with or endorsed by Tinfoil. Every connection verifies the Tinfoil enclave before a request is sent, and there is no unverified fallback.

Chat supports model-aware thinking controls, comparison, editing, versions, branching, projects and inline visual artifacts, in an encrypted local workspace. On Windows, a workspace agent can work in a folder with your approval, and Tinfoil cloud chats sync both ways, pictures included. Both platforms take pictures and PDFs as attachments and offer themes and a chat background. See the [changelog](CHANGELOG.md) for what changed in each release.

[Install](#install) · [Platforms](#platforms) · [Build from source](#build-from-source) · [Known limitations](#known-limitations) · [Verification](#verification)

![Windows renderer with synthetic demonstration data](docs/preview.png)

## Install

Download the latest release from this private repository's **Releases** page. Compare each download's SHA-256 checksum with the release's `SHA256SUMS` before running it.

| File | Platform | Notes |
|---|---|---|
| `Tinfoil-Workbench-<version>-x64-Setup.exe` | Windows 11 x64 | Per-user installer; no administrator rights needed |
| `Tinfoil-Workbench-<version>-x64-Portable.exe` | Windows 11 x64 | Runs without installing |
| `Tinfoil-Workbench-<version>-android.apk` | Android 7.0+ | Install manually using Android's “install unknown apps” permission; needs a current Android System WebView |

The Windows builds are **unsigned**, so SmartScreen warns when you first run them. The Android APK uses the project's release signing certificate:

```text
SHA-256: 63:95:EA:D7:97:A5:20:C6:32:15:6A:BC:D9:EE:27:31:86:9C:64:ED:0E:E5:10:AD:5B:52:E8:87:18:54:94:CB
```

Android updates must use the same signing key to install over the existing app. Export conversations before upgrading and keep original attachments separately. Do not open an updated workspace in an older build; see [data and backups](#data-and-backups).

On first launch, choose **Set up connection**. Use a developer API key or a Tinfoil Chat account. Android Chat sign-in uses email and password; Google and Apple sign-in are unavailable there. See [accounts](docs/ACCOUNT.md) and [Android sign-in](docs/ANDROID-ACCOUNT.md).

## Platforms

“Yes” describes an implemented feature, not the scope of release testing. See [verification](#verification) for what was exercised.

| Feature | Windows 11 (Electron) | Android (Capacitor) |
|---|---|---|
| Attested chat, reasoning controls and comparison | Yes | Yes |
| Editing, versions, branching and local projects | Yes | Yes |
| System instructions picker, saved library and starters | Yes | Yes |
| Inline visual artifacts and HTML previews | Yes | Yes |
| Local PDF viewing | Yes | WebView 125 or newer |
| Attach with the picker: text, code, pictures and PDF text | Yes | Yes |
| Drop files on the window; paste files or screenshots | Yes | Not checked |
| Attach a folder as a path for the agent | Yes, by drop or paste | No |
| Workspace agent | Yes | No |
| Model-requested Python and automatic interpreter discovery | Yes | No |
| Tinfoil cloud chats, including pictures in both directions | Yes | No |
| System, Light and Dark themes; Workbench and 29 Codex presets | Yes | Yes |
| Chat texture or picture background; blur, greyscale and dim | Yes | Yes |
| Tinfoil web search and text-only delegation | Yes | Yes |
| Developer API key | Yes | Yes |
| Tinfoil Chat website-session connection | Yes | Email and password; requires a supported WebView |
| Export artifacts as PDF | Yes | Save existing PDFs only |
| Encrypted workspace key protection | Windows user protection (DPAPI) | Android Keystore |

See [Android requirements and differences](docs/ANDROID.md).

<img src="docs/android-start.png" alt="Android start screen" width="270"> <img src="docs/android-instructions.png" alt="Android system instructions picker" width="270"> <img src="docs/android-attachment.png" alt="Android composer with an attached file" width="270">

## Accounts, responses and tools

### Connections and cloud chats

**Account & connection** keeps the Tinfoil Chat website-session connection separate from developer API-key access. Both use the verified inference adapter; neither silently falls back to the other. Workbench verifies the enclave and loads the model list by itself at launch, when a sign-in completes or is restored, and after you switch the connection; **Verify & refresh models** checks again on demand. Chat sign-in opens Tinfoil's own sign-in page with no bridge to Workbench. With **Stay signed in** (on by default), the website session is saved encrypted on the device, for the Windows user on a PC and with an Android Keystore key on a phone, so restarts and updates keep you signed in; signing out ends it and deletes it. Changing the account or connection mode requires approval before existing history can be sent through it; that approval does not send a message. See [account behaviour](docs/ACCOUNT.md).

On Windows, connecting a chat key under **Tinfoil cloud chats** lets Workbench read and update Tinfoil Chat's cloud conversations, including fetching their pictures when you continue them. Pictures attached in Workbench are uploaded through the attested sync enclave before the cloud chat is written, so Tinfoil Chat can show them too; conversations that exist only in Workbench stay local ([cloud chats](docs/CLOUD.md)).

### Instructions, responses and versions

**A custom system prompt is optional and not required.** **None** is the default and sends no instructions of yours; it does not remove provider defaults or Workbench's guide for enabled tools. The instructions picker beside the model selects saved instructions or a starter to customise. Selecting an entry copies it into the conversation, so later library edits do not alter that conversation. Instruction names are display-only. See [system instructions](docs/ARCHITECTURE.md#system-instructions-selection-012).

The model picker shows the available models and their reported capabilities. Thinking controls follow those capabilities rather than offering unsupported settings. Markdown, LaTeX, source text and provider-returned reasoning have separate reading controls.

Editing a message or answer, editing thinking text, and Retry create versions inside the conversation. The version arrows choose the path used for later messages; **Branch** copies that path into a new conversation. Edited thinking is a local annotation, not model reasoning. **Advanced → Editing** can add assistant and system messages without asking a model (not in Tinfoil cloud chats). Local projects organise conversations but add no shared instructions or memory. See [editing and versions](docs/EDITING-AND-MOBILE.md).

### Attachments

Use **Attach** for text and code files, pictures or a PDF's extracted text on either platform; Windows also accepts files dropped anywhere on the window or pasted, including screenshots. A folder dropped or pasted on Windows is attached as its path, not uploaded, and the enabled workspace agent can read inside it without a separate approval ([attachment changes](CHANGELOG.md), [folder access](docs/WORKSPACE-AGENT.md#tools)).

| Attachment | What the model receives |
|---|---|
| Text and code | File text; other file types are accepted when they contain UTF-8 text |
| PNG, JPEG, GIF, WebP or BMP | A redrawn picture for an image-capable model; the conversation shows a thumbnail |
| PDF | Text extracted page by page with bundled PDF.js, not the original page layout |
| Folder, Windows only | Its path; the agent's read tools can access files inside it |

A model whose catalogue entry says it cannot read pictures cannot receive a newly attached picture. Earlier pictures become notes when continuing with such a model. Scanned PDFs without text are refused; attach their pages as pictures instead. Word, PowerPoint and Excel files must first be saved as PDF or text. Opening a file only for local preview does not send it to a model.

### Workspace agent

On Windows, turn on **Advanced → Workspace agent** (off by default, per conversation) and choose once where new conversation folders are made, or select an existing project folder. The agent reads, lists and searches within the permitted folders without asking, and can propose file changes and run Windows PowerShell or Git Bash commands ([workspace agent](docs/WORKSPACE-AGENT.md#the-mode)).

| Approval level | File-tool changes inside the workspace folder | Commands |
|---|---|---|
| **Ask** — default | Ask for each change | Ask for each command |
| **Auto-edit** | Apply without asking | Ask for each command |
| **Auto-run** | Apply without asking | Run without asking unless the command triggers an approval check |

At **Auto-run**, a command still asks when the text checks identify an outside path, deletion, Git history or remote operations, system changes or elevation, network transfers, or package installation. These checks inspect words, not effects; they do not prove that another command is safe. Raising the level needs confirmation. New conversations and branches start at Ask, and turning the agent off resets the level. Automatically approved calls are marked as such.

When a call needs approval, Workbench opens a separate approval window showing the exact command or Python code, or the file diff. The main process owns this window; the conversation page cannot answer it, and closing it declines. File-tool changes are written only if the file has not changed since the proposal. See [approval and execution](docs/WORKSPACE-AGENT.md#approval-and-execution).

**The workspace agent is not a sandbox. An approved command runs with your Windows permissions and is not confined to the workspace folder.** It can read, change or send anything your account can access. Confinement applies to the file tools, not commands; attached folders extend read access, not the file tools' write scope. See [security](SECURITY.md).

### Python

On Windows, **Advanced → Model-requested Python** finds installed interpreters automatically, preferring those on `PATH`, and shows the selected interpreter and version. Choose another from the list or use the native picker; discovery does not run Python ([Python execution](SECURITY.md#python-is-not-a-sandbox)).

Python runs with your Windows file and network permissions, **not in a sandbox**. Model-requested runs need exact-code approval in Workbench's approval window, except when the conversation's workspace agent is at Auto-run, where enabled Python runs without asking.

### Visual tools and activity

Visual tools put charts, tables, diagrams, timelines, stat cards and versioned documents inside answers. HTML previews are static by default. Interaction must be enabled for each preview and stays in a network-restricted frame without native privileges. See [architecture](docs/ARCHITECTURE.md) and [security](SECURITY.md).

Tool batches run sequentially. Tinfoil-managed MCP entries display provider-reported activity; they cannot invoke local tools. Hosted search and text-only delegation are opt-in, and delegation asks before sending a separate task. See [activity and tools](docs/ACTIVITY.md).

### Themes and chat background

**Settings → Appearance** offers System, Light and Dark modes, Workbench's own look and 29 Codex app presets, with colour and contrast controls. Not every preset has both light and dark variants ([themes](docs/ARCHITECTURE.md#themes-13)).

**Settings → Chat background** adds a grid, dots, grain or your own picture, with texture strength or picture blur, greyscale and dim controls. The picture stays in the encrypted workspace and is not sent to a model ([background settings](docs/ARCHITECTURE.md#themes-13)).

### Keyboard shortcuts (Windows)

Ctrl+N new thread · Ctrl+K commands · Ctrl+F search the conversation · Ctrl+B sidebar · Ctrl+Shift+F focus · Ctrl+Shift+A artifacts · Ctrl+, Settings. Enter sends and Shift+Enter inserts a newline; on touch layouts Enter inserts a newline and Send submits.

## Data and backups

The encrypted local workspace holds conversations, drafts and attachments. Windows cloud chats also have remote copies when cloud sync is connected; signing in alone does not enable sync or hide local conversations.

| Platform | Storage and removal |
|---|---|
| Windows | The workspace key is protected for the Windows user. Copying `workspace.vault` alone is not a portable backup. Uninstalling keeps the workspace in `%APPDATA%\Tinfoil Workbench`; delete that folder to remove it. |
| Android | The data key is protected by Android Keystore. Android backup and device transfer are disabled. Uninstalling deletes local conversations. |

**Export** creates an unencrypted copy. Keep exports private and retain original attached files separately. Conversation exports do not include the full stored attachment pictures. Agent work folders are separate from the encrypted conversation store, and Workbench does not delete them.

Do not open a workspace in an older version after an update. For example, 1.2.0 drops pictures and cannot open workspaces containing agent replies beyond its older tool-history limits. See [compatibility](docs/WORKSPACE-AGENT.md#compatibility) and the [changelog](CHANGELOG.md).

Encryption does not protect an open workspace or its files from software running with your account's permissions. Deleting a conversation is not secure erasure. See [security boundaries](SECURITY.md).

## Build from source

Both platforms build from the same checkout with **Node.js 22.12 or newer**. Run these commands from the folder containing `package.json`. Read [AGENTS.md](AGENTS.md) before changing the source, and keep the pinned dependencies and reviewed lockfile.

### Windows

```powershell
npm run bootstrap      # Install from the reviewed lockfile and verify the Electron download
npm run doctor         # Every entry must pass
npm test               # Strict TypeScript build and Node tests
npm run smoke:desktop  # Native storage, bridge, PDF print and PDF.js checks
npm start
npm run dist:win       # Repeat doctor, tests and smoke; build unsigned x64 files in release\
```

A successful native smoke test prints `DESKTOP_SMOKE_OK`. It uses a temporary profile and does not sign in or call a model. Packaging does not publish a release.

In the VS Code integrated terminal, clear `ELECTRON_RUN_AS_NODE` before starting Electron:

```powershell
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
```

If PowerShell blocks `npm.ps1`, use `npm.cmd` in place of `npm`; the build does not require changing your execution policy. Do not replace dependency pins with `latest` or run `npm audit fix --force`.

### Android

Install **JDK 21** and an Android SDK with `platforms;android-36` and `build-tools;36.0.0`:

```powershell
$env:JAVA_HOME = '<JDK 21>'
$env:ANDROID_HOME = '<Android SDK>'
npm run bootstrap
npm test
npm run android:apk    # Release APK in release\; signed when signing is configured
```

Set `TINFOIL_ANDROID_SIGNING` to the signing properties file before building a signed APK. Without signing configuration, the release APK is unsigned and Android will not install it. Keep signing keys outside the repository. See [Android build and signing](docs/ANDROID.md#build) and [releasing](docs/RELEASING.md).

For a renderer-only demonstration:

```powershell
npm run preview:build
```

The generated `preview/index.html` uses labelled synthetic responses and cannot authenticate. It is not a native acceptance test.

## Known limitations

| Area | Limitation |
|---|---|
| Platforms | Published Windows builds are x64. `dist:arm64` exists but is unvalidated. There are no iOS, macOS or Linux builds. |
| Android | No workspace agent, folder attachments, Python or Tinfoil cloud chats. PDF export can only save an existing PDF. PDF viewing needs WebView 125 or newer. |
| Sign-in | Not every sign-in method that Tinfoil offers has been tried with Workbench. On Android, Google and Apple refuse sign-in in an embedded view, so only email and password work there. |
| Android backgrounding | Android can stop an in-progress reply when the app leaves the screen. Interrupted replies are marked; use Retry to ask again. |
| Local execution | Neither the agent nor Python is a sandbox. Agent commands are not folder-confined. Interactive programs and long-running servers are unsupported; Stop and timeout termination are best effort. |
| Agent conversations | A conversation that has used the agent stays on this computer and cannot move to Tinfoil cloud chats. |
| Cloud chats | The list is limited to the 300 most recent chats. Folder attachments are refused. Cloud projects are managed in Tinfoil Chat. |
| Cloud pictures and widgets | A picture Tinfoil no longer has reaches the model as a note; other fetch failures can block sending. Charts, timelines and stat cards are rendered; other Tinfoil widgets are listed as not displayed. Workbench visuals are not written back, so Tinfoil Chat shows those answers as text. |
| Models | Models may ignore the tool guide. Recognised visual calls written as text can be displayed and labelled as such; other calls remain text. |
| Security assurance | Workbench is not an independently audited security product. Local encryption and enclave verification do not make local execution safe. |

## Verification

The [1.3.0 validation record](docs/VALIDATION.md), recorded on 1 October 2026, is the source for these results. It separates automated checks, review builds, installed-release checks and work that was not run.

| Recorded scope | Result |
|---|---|
| Strict build and Node tests | 561 passed, 0 failed, 1 skipped |
| Production-renderer browser tests | 526 checks across 12 suites passed |
| Windows build and native smoke | Packaging gates passed; source, packaged and installed-app checks covered native storage, PDF handling, the agent runner and the approval window |
| Packaged and installed Windows app | Live inference and sync enclave verification passed; installation over an existing review build was checked |
| Live agent checks | Small-project tasks with three models, plus greeting checks with two models |
| Cloud pictures | Manual checks fetched a web chat's picture into Workbench and showed a Workbench upload in Tinfoil Chat |
| Android | Debug/live and release checks on Android 14 and 16 emulators; an in-place update from 1.2.0 preserved a draft |
| Physical Android hardware | Only preservation of a saved session across the update was checked for 1.3.0 |

The record also documents failed checks and their fixes. Drop and paste were checked with scratch scripts and manual runs, not a committed browser test. Browser viewport and touch emulation do not establish native-device support.

**Not checked for this release:** a repeated clean Windows installation, a standard-user Windows account, running the portable executable, Android picture/PDF picking on a device, long agent tasks, Git Bash or approval levels with a real model, and the updated live cloud test script. A real model's answer about a fetched cloud picture and missing-picture or unfetched-copy cases also remain unverified. Earlier open checks remain open unless the record says otherwise; see [not executed](docs/VALIDATION.md#not-executed).

The [manual acceptance checklist](docs/HANDOFF.md) covers work beyond automated tests. [Rendering measurements](docs/RENDERING.md) describe a synthetic workload, not general performance claims. Earlier records are in [docs/history](docs/history).

## Documentation

- **Using Workbench:** [Accounts](docs/ACCOUNT.md) · [Cloud chats](docs/CLOUD.md) · [Workspace agent](docs/WORKSPACE-AGENT.md) · [Activity and tools](docs/ACTIVITY.md) · [Editing and mobile layout](docs/EDITING-AND-MOBILE.md)
- **Platforms and builds:** [Android](docs/ANDROID.md) · [Android sign-in](docs/ANDROID-ACCOUNT.md) · [Releasing](docs/RELEASING.md) · [Validation](docs/VALIDATION.md) · [Manual acceptance](docs/HANDOFF.md)
- **Design and changes:** [Architecture](docs/ARCHITECTURE.md) · [Security](SECURITY.md) · [Spacing](docs/SPACING.md) · [Rendering](docs/RENDERING.md) · [Changelog](CHANGELOG.md) · [Notices](NOTICE.md)

Original application code is private and UNLICENSED. Third-party notices are in [NOTICE.md](NOTICE.md).
