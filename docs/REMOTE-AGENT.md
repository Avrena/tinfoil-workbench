# Remote agent worker

The optional `remote/` entry point runs a Workbench-based agent independently of
the Windows app. SSH submits a durable systemd job and can disconnect immediately.
Closing Workbench or the SSH client does not stop that job. The Windows
composer's **Remote** execution mode and `scripts/remote-agent.mjs` operate the same controller.
It does not alter the existing local agent or enable agents in Tinfoil synced chats.

The worker reuses Workbench's `createProvider` (attestation, EHBP, zero generation
retries), tool definitions, argument validation, tool-call accumulator, context
compaction, file readers, searches and conflict-checked edit implementation.
The headless loop has bounded rounds, calls, duration, output and context. A tool
batch is fully validated before execution and tool/result IDs remain paired.
Partial output and tool state are saved atomically between actions and during
streaming. Worker/host interruption preserves records and is never silently
resumed: resubmit deliberately after checking the filesystem for partial changes.

## Trust and authorization

Submitting requires a native **Start remote job** confirmation in the Windows
app, or the explicit `--workspace-auto` CLI option. It authorizes
unattended commands and changes inside this job's container workspace. There are
no interactive approval windows on the server. The desktop agent's approval
levels remain unchanged. This is a new opt-in execution
entry point, not an exception applied to local agent calls.

Inference uses a **Tinfoil Chat subscription** and an exact tool-capable model ID,
with no developer API fallback. A dedicated native Electron helper opens a fresh
Tinfoil sign-in and asks before transferring that session through SSH stdin.
It does not read the installed app's account store or a regular browser profile.
Only persistent Tinfoil-domain cookies and their bound user/session IDs are
transferred. The server seals them with AES-256-GCM; the root-only encryption key
reaches the worker through systemd credentials. The native helper closes its
fresh browser partition without ending the newly enrolled remote session.

On the VPS a sandboxed headless Chromium page restores only that bound session
and runs the same fixed `sessionScript`/`identityScript` as Workbench. The existing
`AccountSession` performs identity checks, expiry validation, refresh margins,
quota handling and token exchange. Every inference round obtains a current
subscription credential; a changed credential gets a newly attested SDK client.
Inference keys stay in memory. A rejected session or quota stops the job without
generation retry or a switch to API billing. Expired sign-in requires reenrollment.
Cookie rotations are saved while jobs run and at shutdown. The browser uses an
in-memory context, no exposed debugging port, no model browser tools and no
`--no-sandbox` fallback.

Credentials never enter tool containers, conversation exports, process arguments,
or job records. The VPS controller can decrypt the session and read plaintext
job records; this VPS is not a confidential-computing enclave.
Only the inference connection has Tinfoil's attestation/EHBP guarantees.

The trusted worker runs as `tinfoil-runner`. A root-owned, fixed JSON broker is its
only sudo command. The broker takes validated workspace IDs and tool arguments,
never model-selected image names, host paths, mount options, or Docker flags.
The model runs as UID 1000 inside disposable containers, with no root key, host
filesystem, Docker socket, controller files or provider credential.
Docker containers share the host kernel; use separate VMs for hostile tenants.

## Workspace and tool lifecycle

- Four workspaces maximum, each with a preallocated 2 GiB ext4 filesystem mounted
  with `nosuid,nodev`. Creation preserves 2 GiB of free host disk space.
- Each tool call gets a disposable container with 1 CPU, 768 MiB RAM, no swap,
  128 processes, no capabilities, no-new-privileges, a read-only image and a
  128 MiB temporary filesystem. Files under `/workspace` persist across calls.
- The `dev` profile includes Bash, Python 3/dev headers/pip/venv/pipx, Node.js/npm,
  Git/LFS, ripgrep, curl, wget, jq, zip/unzip, rsync, tree, GCC/G++, Clang, CMake,
  Ninja, pkg-config, GDB, Autoconf/Automake/Libtool and ShellCheck.
  Put user packages and caches under `/workspace`.
- An operator-created `kali` profile uses the official Kali image with the same
  development environment plus Nmap/Ncat, DNS/WHOIS, Netcat/Socat, tcpdump/TShark,
  OpenSSL, SQLmap, Nikto, WhatWeb, ffuf, Gobuster, Hydra and John. It is a selected
  command-line toolkit, not the full headless Kali metapackage. The same non-root,
  capability-free network sandbox applies: raw-packet capture/scans are unavailable;
  Nmap TCP connect scans and offline capture analysis work. Kali repositories are
  confined to that image and never added to the Ubuntu host.
  The image removes Nmap's file capabilities and provides an unprivileged launcher;
  otherwise Kali's capability-bearing binary cannot start with all capabilities dropped.
  Jobs run unattended with public Internet access, so point a Kali workspace only at
  systems you own or are authorized to test; the worker guide tells the model the same.
- Each workspace has its own Docker bridge. Public outbound Internet and DNS
  work; host services, other workspaces, private networks and metadata addresses
  are blocked. No inbound application ports are published. IPv6 is not enabled
  on these bridges.
- One job runs at a time to fit a 2 GiB VPS. Default job limits:
  20 rounds, 40 tool calls, 4,096 output tokens per round, 30 minutes. The protocol
  permits explicit lower limits or bounded increases, up to 30/60/16,384/3,600.
  These are execution limits, not a dollar budget.
- File tools preserve the existing relative-path and symlink confinement checks.
  Commands run in Bash with closed stdin. A call ends after at most 600 seconds;
  detached child processes are also removed when its container is removed.
- `stop` stops the systemd worker and removes only its owned tool containers.
  `ExecStopPost` also removes them on worker failure or timeout.
- `cleanup` lists unused workspaces older than seven days; it never deletes.
  `archive` writes a root-only tar.gz without following symlinks. `delete` requires
  the exact ID and refuses active jobs/containers; it unmounts and removes only
  that workspace and its labeled network. Job records are separate and are
  removed only by `delete-job`. Archives remain until an operator removes them.

### Dependency environments and sub-agent workspaces

`workbench-env` is installed in both images. `doctor` reports available tools;
`init NAME` creates `.environments/NAME` with an independent Python venv, private
npm project/prefix, HOME, cache and temporary directory. Run each command with
`workbench-env run NAME -- COMMAND [ARGS]`; activation does not persist between
tool calls. `list` shows managed environments. `cache NAME` previews cache size;
`cache NAME --apply` clears only that environment's cache. `delete NAME --confirm
NAME` removes only the matching managed dependency environment. Source files
elsewhere in the workspace are retained. No packages are downloaded by init.

Dependency environments share a container's resource limits and are not OS
security boundaries. For a sub-agent's separate filesystem and network, an
operator creates another workspace with `tinfoil-workspace create --name NAME
--profile dev` (or `kali`). Select it in Workbench's existing workspace picker.
The profile comes only from root-owned workspace metadata and a fixed image
allowlist; model tool arguments cannot select Docker images or change profiles.
Old workspaces without profile metadata continue using `dev`.

The current worker still runs one model job at a time. This provisions separate
sub-agent environments; it does not add model delegation, concurrent model jobs,
new provider accounts or a developer API fallback.

The root-only `tinfoil-workspace` CLI supports `list`, `create`, `cleanup --days
7`, `archive ID`, `delete ID --confirm ID`, and `run --timeout 120 ID -- COMMAND
[ARGS]`. Cleanup only reports candidates. CLI deletion archives first, then uses
the controller's exact-ID deletion checks. Operator run refuses an active job in
that workspace and uses the same bounded tool container. These administrative
commands are not installed in or granted to model tool containers. Docker,
Compose and Buildx remain host/operator tools; no Docker socket is mounted.

## Windows interface

After installing the remote worker below and configuring a verified OpenSSH
alias, open **Remote agents** in the sidebar to add the host. The **Local / Remote**
switch beside the message input appears only while at least one host is saved;
forgetting the last host hides it again. A disconnected host keeps the switch.
**Local** returns to Chat with its draft, attachments and settings intact. Before
a host is added, setup provides **Back to Chat** instead and keeps the unused task
composer hidden. The sidebar entry stays available for setup. Switching never submits a task,
copies Chat history into a job, or stops a running local or remote agent.

The **Threads** sidebar shows **Cloud / Remote / Local** when both cloud chats
and a remote host are configured. Without cloud chats it shows **Remote / Local**;
without a host it omits Remote. The Remote list shows the selected host's tasks,
grouped by workspace. Select a task to read its transcript, use the heading's
refresh button to update it, or search by task title, prompt or workspace name.
Last-known tasks remain available while a host is offline. Switching back to
Cloud or Local restores Chat without copying or submitting the remote draft.

Remote tasks use the main transcript column and composer. Host and workspace
selectors sit next to the input, with model, system instructions and thinking effort
in its toolbar. The navbar matches Chat's layout: Find, Reading, the conversation
menu, **Jobs** (history icon), and **Advanced** (gear). **New task**, **Refresh**,
and **Manage hosts and workspaces** are in the menu; the host breadcrumb also
opens Manage. The Advanced title identifies Remote settings. **Jobs** opens
previous runs; **Manage** holds workspace, account and host administration.
Closing those dialogs preserves the draft and
open output disclosures. While a job runs, **Stop job** replaces **Review & start**
in the same composer position, including when writing a new task. The start
button returns when the job ends. Chat uses the same placement for Stop and Send.

Find, New task, the expanded message editor and the title editor follow the selected
execution mode. Renaming a remote task saves a display label on this PC; it does not
change its submitted prompt or server records. Advanced edits remain pending until
**Apply**; **Discard** restores the applied values. Pending edits block starting a
task or changing hosts, and survive switching between Local and Remote in the same
session. Only applied settings enter the encrypted remote draft and native review.

1. Add a display name and the SSH alias. The native confirmation identifies
   that alias. Passwords, private keys and custom SSH arguments are not accepted
   by the app; configure them through OpenSSH before connecting.
2. Choose **Connect remote Chat** in the setup prompt and complete the fresh Tinfoil sign-in and
   account-transfer confirmation. An existing remote enrollment can be used
   directly. The local conversation account is separate. Enrollment status does
   not prove current subscription access; the worker checks it when the job starts.
3. Create a named workspace from the setup prompt or **Manage**, or select an
   existing one beside the input. Type a task, select the
   Chat model from the searchable picker (or **Host default** for the host setting), and open **Advanced** for
   temperature, output tokens, supported reasoning controls and execution limits.
   **Review & start** shows the captured task, resolved model, workspace,
   system instructions and settings in a separate native approval window.
   The picker uses Chat's public model names and maker logos, and also accepts an
   exact model ID. Catalog presence does not establish remote subscription access;
   the remote session checks availability when the job starts.
4. Starting a job shows its transcript in the main conversation area. It contains the submitted task,
   assistant replies with Markdown/code formatting, and collapsed tool calls in
   their recorded order. Replies use Chat's reasoning, Markdown and math reading preferences,
   answer actions and one model/instruction footer on the latest assistant answer.
   Each answer keeps Copy and Source; neither action executes code.
   Partial replies remain visible after failure or stopping. An older host without
   ordered records explicitly shows grouped tool activity after the combined answer.
   **Job details** contains captured settings and exact instructions, identifiers,
   timings, usage and record deletion. The view refreshes
   every 15 seconds while visible; **Refresh** requests the latest state.
   **Stop job** stays reachable on narrow windows.
   Stop retains partial output and workspace changes. Operator stop, time limits,
   authentication/quota failure and host interruption are distinguished.
5. In **Manage**, **Archive or delete** can archive an inactive workspace on the host or delete
   its files after exact-workspace confirmation. Archives are not downloaded
   automatically. Job records have a separate delete action. Forgetting a host
   removes only this PC's profile and draft; jobs and remote credentials remain.

System instructions are optional; **None** is the initial choice. A saved or
starter selection copies its text and display name into this remote draft;
editing the text removes that name. These instructions supplement the built-in
workspace guide. Names are display-only and never sent to inference. Blank
temperature and default effort/thinking leave provider behavior unchanged.
Effort and thinking on/off follow the selected model's sanitized catalog
capabilities and reset when the model changes. The trusted worker checks those
capabilities before sending overrides; unsupported or unavailable settings fail
before generation, with no silent fallback. Older hosts can still run defaults,
but must be updated before accepting new generation settings.

Profiles and task drafts use a separate OS-encrypted vault on this PC. Incomplete
numeric edits retain the previous valid settings while saving task text; Start
requires valid settings. Closing the app flushes drafts but does not stop remote
jobs. Job output stays on the host, outside local conversations and cloud sync.
Remote mode does not upload files from drops or the clipboard. Use SSH/SCP for
operator file transfers; never expose the administrative SSH account to an agent.

An SSH interruption leaves last-known state visible. An unconfirmed submission
blocks another start until a later overview checks the request ID. No action is
automatically replayed. A persistent SSH connection carries bounded requests;
Stop uses a separate connection so a slow archive does not block it. SSH and
remote-controller failures do not imply that a job has stopped.

Remote execution is available on Windows only. This does not add an Android remote
executor, concurrent jobs, automatic restart/resume, or model-accessible host
administration. Updating the desktop alone does not install or update the VPS
controller; deploy matching server files when upgrading this protocol.

## Operator CLI

Use a native SSH config alias with a verified host key and key-only authentication.
From this checkout, with Node.js installed:

```text
node scripts/remote-agent.mjs MY_SSH_ALIAS create
node scripts/remote-agent.mjs MY_SSH_ALIAS list
node scripts/remote-agent.mjs MY_SSH_ALIAS submit WORKSPACE_ID MODEL_ID prompt.txt --workspace-auto
node scripts/remote-agent.mjs MY_SSH_ALIAS set-model deepseek-v4-1-flash
node scripts/remote-agent.mjs MY_SSH_ALIAS submit WORKSPACE_ID default prompt.txt --workspace-auto
node scripts/remote-agent.mjs MY_SSH_ALIAS jobs
node scripts/remote-agent.mjs MY_SSH_ALIAS status JOB_ID
node scripts/remote-agent.mjs MY_SSH_ALIAS result JOB_ID
node scripts/remote-agent.mjs MY_SSH_ALIAS stop JOB_ID
node scripts/remote-agent.mjs MY_SSH_ALIAS cleanup
node scripts/remote-agent.mjs MY_SSH_ALIAS archive WORKSPACE_ID
node scripts/remote-agent.mjs MY_SSH_ALIAS delete WORKSPACE_ID --confirm-delete
node scripts/remote-agent.mjs MY_SSH_ALIAS delete-job JOB_ID --confirm-delete
node scripts/remote-agent.mjs MY_SSH_ALIAS auth-status
node scripts/remote-agent.mjs MY_SSH_ALIAS disconnect-chat
```

Enroll from this checkout after `npm run bootstrap`:

```text
node_modules/.bin/electron remote/enroll.mjs MY_SSH_ALIAS
```

On PowerShell use `.\node_modules\.bin\electron.cmd`. The native dialogs identify
the SSH destination and the account being transferred. Complete login on
Tinfoil's own page; do not paste cookies or tokens into chat. `auth-status` reports
enrollment only; it does not claim that subscription access remains valid.
`disconnect-chat` removes the server's saved session after active jobs stop.
Provider-side revocation is separate: end this dedicated session in Tinfoil's
account settings. Previously issued credentials are not claimed to be revoked.

For other clients, the operator command `/usr/local/bin/tinfoil-workbench` accepts
one JSON request on stdin and returns `{ok,result}` or `{ok:false,error}`.
For example, `{"op":"create"}` or
`{"op":"submit","workspace":"32_hex_id","model":"exact_model_id","prompt":"task",
"policy":"workspace-auto","maxRounds":10,"maxCalls":20,"maxTokens":4096,"maxSeconds":900}`.
Additional bounded fields are `systemPrompt` (40,000 UTF-16 units),
`systemPromptName` (80, display-only), `temperature` (null or 0–2),
`reasoningEffort` and `thinkingMode` (`default`, `enabled` or `disabled`).
Omitted fields use provider defaults and no custom system message. The
`overview.features.jobSettings` flag advertises support; `inspect.settings`
returns the captured values, including limits. Reusing a request ID with changed
settings is refused.
Lifecycle methods belong to the human/controller, not the model's offered tools.
The fixed `--serve` mode accepts one bounded JSON request per line and returns
one JSON response per line over a single SSH connection. `overview` combines
enrollment metadata, workspace/job summaries and one selected job detail;
`inspect` returns bounded display data. Neither includes saved session material
or the model request history. The full `result` remains available to the operator
CLI. A client-supplied 32-hex `requestId` identifies a submission without starting
it again when an existing matching record is found.

## Installation and recovery

Build the existing project first with `npm ci` and `npm run build`. Copy
`remote/`, `dist/core/`, `desktop/provider.mjs`, `desktop/agent-tools.mjs`, `desktop/model-catalog.mjs`,
the `desktop/account-{session,store,window}.mjs` modules, `package.json`
and the genuine `package-lock.json` into a root-owned
`/usr/local/lib/tinfoil-workbench`. Build `remote/Dockerfile` as
`tinfoil-workbench-tools:1`. Install the pinned production npm dependencies with
`npm ci --omit=dev --ignore-scripts`. Install a compatible Node 22 executable as
`/usr/local/lib/tinfoil-workbench-node`, then run `bash remote/install.sh` and
`bash remote/install-browser.sh`. `remote/package-lock.json` separately pins the
server-only Playwright runtime; it is not added to the desktop application.
The host requires Docker, sudo, Python 3, ext4/loop support, iptables, systemd and tar.
The base Node image is digest-pinned; Debian packages are resolved at build time.
Retain the built image for reproducible tool environments.

For a fresh Ubuntu operator environment, `bash remote/install-environment.sh`
installs Python development tools, C/C++ toolchains, Git and common CLI tools,
then verifies Docker/Compose/Buildx are already installed. It installs a pinned,
checksum-verified Node 24 distribution under `/opt` with `node`, `npm`, `npx`
symlinks in `/usr/local/bin`; it does not replace the worker's private Node 22
executable. Existing conflicting symlinks/binaries are refused.

To add the Kali workspace profile, build the development image first, then run
`docker build -t tinfoil-workbench-kali:1 -f remote/Dockerfile.kali .`. Its official
base is digest-pinned; Kali packages resolve at build time. Record image IDs and
retain the built images. Deploy the matching broker, controller, worker and CLI;
`remote/install.sh` installs the operator CLI symlink. A missing profile image is
refused before workspace creation. Do not update image tags during an active job.

On Linux, `python3 tests/remote-environments.py` checks environment isolation,
cleanup boundaries, profile selection and operator execution guards. With Docker
operator access, `python3 tests/remote-environment-images.py` exercises both
installed images using temporary synthetic workspaces with external networking
disabled. It compiles and runs C/C++, tests venv/npm and cleanup, and checks Kali
tool startup, a loopback TCP connect scan and offline PCAP parsing. It does not
start model jobs or read provider credentials. `--dev-image`, `--kali-image` and
`--report` select staged image tags and an optional JSON evidence file.

Install does not start a model, enroll a Chat account, open an HTTP listener,
enable a cleanup timer, or automatically resume interrupted jobs. After a host
reboot, submitting a new job mounts its existing workspace before starting the
worker. Status reports old unfinished jobs as interrupted.

The SSH operator account is administrative. Do not expose it or this operator CLI
as an unrestricted model tool. Automatic resumable execution is not implemented.
Subscription renewal is implemented, but live acceptance requires a deliberately
enrolled Chat session.

## Validation

`npm test` includes mocked provider protocol tests in `remote-agent.test.mjs`.
They verify exact instruction/parameter forwarding across rounds, unsupported
controls, attestation failure, paired calls/results, checkpointing, limits,
no automatic retry, and shared file behavior. They do not prove a real provider
run. Linux acceptance additionally needs real Docker, disk quota and symlink
checks, command cancellation, egress tests, archive/delete isolation, sudo
restriction and a detached systemd worker. `remote-chat.test.mjs` tests encrypted
session storage, Chat-only routing, credential renewal, rejection and attestation.
Use a deliberately enrolled Chat session for a live provider check; never
substitute a mock result for live acceptance.

`remote-ui.test.mjs` covers profile and identifier validation, captured native
approval, uncertain submission reconciliation, Stop during another operation,
bounded display data, settings migration, old-host gating, reason codes and persistent SSH without request replay.
`tests/remote-settings.py` checks server validation and request-ID binding.
`tests/ui-remote.py` exercises the real renderer with a synthetic controller,
including isolated drafts, invalid limits, stale connection state, persistent
feedback, output escaping, selection/disclosure preservation and narrow layouts.
The remote UI suite also includes `ui-remote-transcript.py`, `ui-remote-composer.py`,
`ui-remote-availability.py`, `ui-shared-execution.py`, `ui-remote-polish.py`,
`ui-stop-slot.py` and `ui-remote-sidebar.py`.
The polish checks cover toolbar parity, narrow menus and keyboard focus, setup
without a host, duplicate host names, transcript signatures, and conditional
Advanced actions. These fixtures perform no SSH or inference.
`tests/remote-desktop-entry.mjs` requires an
explicit isolated test profile for native integration; it never selects the
installed vault by default. A native live check must additionally create an
isolated workspace, run a real attested Chat task, stop a running command, close
and reopen Workbench during a job, and delete only its own temporary resources.

Chromium uses Playwright's [sandbox launch option](https://playwright.dev/docs/api/class-browsertype#browser-type-launch-option-chromium-sandbox)
and [non-persistent contexts](https://playwright.dev/docs/api/class-browser#browser-new-context).
On Ubuntu, installation adds a per-executable AppArmor user-namespace allowance
for this root-owned browser, following the [Ubuntu release notes](https://documentation.ubuntu.com/release-notes/24.04/).
The system-wide user-namespace restriction remains enabled.
