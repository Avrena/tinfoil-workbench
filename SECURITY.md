# Security boundaries — 0.10

This is an unofficial source implementation, not an independently audited security product. Keep the repository and real conversation data private. Do not report vulnerabilities with credentials or private transcripts attached.

## Inference and credentials

Live inference uses the official Tinfoil SDK with EHBP and an explicitly successful verification result. There is no unverified fallback. Developer API credentials stay in the main process and encrypted vault; Chat session/inference credentials stay only in main-process memory. Renderer snapshots omit all credentials. The optional public model-catalog request sends no credential or conversation data and cannot change provider destinations or tool permissions. Catalog parameters are whitelisted.

Workspace storage uses authenticated encryption and OS-protected key material. Windows DPAPI behavior has not been validated in this environment. Restored vaults that cannot decrypt are not silently replaced. At-rest encryption does not protect data from malware running as the same user, renderer memory inspection, screenshots, unlocked-session access, plaintext exports or backups. Delete is not secure erasure.

## Model content and artifact previews

The transcript escapes HTML. Markdown links require a confirmed external-browser action; remote images are not fetched. KaTeX trust is disabled and mathematical rendering is bounded. Original content remains available through source view. Deferred reasoning is a presentation optimization, not removal from storage or model context. Math/code caches are bounded and cleared on thread changes; they remain ordinary process memory rather than additional at-rest protection.

Typed visualizations accept bounded data, escape labels and use host-owned rendering. They have no Python/native execution, network or automatic file-save capability. Model-generated HTML/SVG stays in an opaque sandboxed iframe. Static preview removes scripts/navigation. The user may enable inline JavaScript for one HTML preview; same-origin privileges, preload/bridge, workers, popups, permissions and remote resources remain unavailable. Frame CSP and Electron session request filtering are independent controls. There is no message-to-IPC forwarding mechanism.

Interactive JavaScript can still consume CPU/memory and process text entered into that iframe. Stop interaction removes it; leaving an interactive inline Preview tab or collapsing that preview also removes it. Scrolling it out of view does not stop it. A busy renderer may need restarting. Do not describe browser isolation as an unlimited safe execution environment. Raw HTML/SVG saved and opened in another browser does not retain these restrictions; the save flow warns about that difference.

PDF creation occurs in a separate no-preload, JavaScript-disabled window with network/file destinations denied and bounded output. PDF.js renders pages as canvas/text with eval, XFA and interactive actions disabled. Password-protected files are unsupported. Keep Electron/PDF.js current after dependency review; malformed files and renderer bugs remain relevant attack surfaces. Actual Windows PDF execution requires the supplied smoke test and manual review.

## Python is not a sandbox

Native Python has the user's account permissions and can access files/network. Isolated mode, a reduced environment, temporary cwd, no shell interpolation, time/output limits and best-effort tree termination do not provide OS containment. Only explicitly approved code should run. No generic terminal or silent package installer is exposed.

Each native run requires a pending service proposal plus a fresh native exact-code/interpreter confirmation, rechecked after the dialog. No always-allow option exists. Rendering, loading history, importing or startup cannot authorize execution. Manual code runs derive from a stored completed block rather than renderer-supplied replacement source, and their outputs are excluded from model context by default. A Python process can create output beyond what the collector retains; artifact collection limits do not contain the process.

## Scope and native actions

The main process checks the exact owning window/frame and known app URL on every IPC. Local preview files are selected with a native dialog, bounded to regular files, and not added to model-visible artifact history. Model `read_artifact` is scoped to selected conversation history/current response, not arbitrary paths or other conversations. Tool names/arguments and returned artifact records are validated independently of the UI.

Saving/exporting requires an explicit destination. Saved artifacts/PDFs/JSON are unencrypted. The app has no automatic updates, telemetry, cloud sync, unattended execution, regular-browser cookie import or unattended account discovery.

## Before distribution

Bootstrap real dependencies, review the lockfile/licenses, run dependency audits, execute native Windows/DPAPI/PDF/approval/installer tests, then validate live attestation/tool calling with non-sensitive inputs. Signing and independent review remain necessary release work. Preserve distinctions between mock tests, Linux-native Python tests, browser tests and Windows results. Never claim a PDF canvas, live model call, remote CI run or executable was verified unless it actually ran.

## Provider events and delegated inference (0.8)

Progress markers are provider-reported display data, not execution permissions or cryptographic attestations of tool activity. Only known marker types with bounded IDs/payloads/statuses are interpreted; malformed/unknown/incomplete markers remain inert source. Structured secret-named argument fields are redacted, but arbitrary prose/output cannot be guaranteed free of user-supplied secrets. Provider source URLs are constrained and use native external-navigation confirmation. No event can turn into an executor call.

The optional search switch explicitly enables a provider operation and possible additional usage; passive event subscription is separate. No third-party MCP endpoint, stdio launch or OAuth credential handling is added. Hosted code-execution containers are not provisioned.

Delegation is disabled by default. A model may propose a task, including selected excerpts of conversation content, but a fresh native exact-task/model confirmation is required after the visible approval. There is no silent parent-history/attachment inheritance. The child has no tools, search activation or recursive delegation, and its calls share a strict two-request budget across comparison lanes. Unrequested child tool calls and oversized output fail closed and abort the stream. Child usage is distinct; cancellation does not guarantee zero provider billing. Child text/reasoning is retained in the encrypted workspace and becomes plaintext when exported. Child reasoning is not inserted into the parent's tool result.

The main process rechecks pending proposals after the native dialog, and per-child cancellation validates the owning thread. Restored queued/proposed actions are cancelled rather than resumed. Native dialog behavior and live SDK routing still require Windows and account-level validation.


## Explicit account sign-in (0.9)

Account UI and website-session integration are opt-in. The site uses a separate nonpersistent Electron partition with no preload, Node or native IPC, web security and sandbox enabled, denied permissions/downloads, controlled top-level HTTPS navigation and equally unprivileged popups. Only fixed scripts can read Clerk's public session/profile interface, with the exact Tinfoil origin checked before and after evaluation. Never evaluate arbitrary renderer/model input in the sign-in window. Provider pages still execute their own web code and have normal network behavior; this boundary does not establish that the remote site is trustworthy or that embedded authentication will be accepted.

The main process alone holds session and inference tokens. Token exchange is restricted to the published Tinfoil control-plane path, rejects redirects, limits bodies, applies timeouts and one-refresh authorization, and rechecks identity across asynchronous operations. It does not carry a prompt. Inference remains on the verified SDK/EHBP transport. Clearing, expiry, different-account detection and late-response generations cannot restore a revoked cached credential. No automatic anonymous/free or API-key billing fallback occurs. Token/profile state is transient; a local per-thread owner ID can remain inside the encrypted workspace for cross-identity-send approvals. Do not claim account sign-out hides or deletes local conversations.

No account profile, email or name is automatically used as model context. Existing threads need an explicit native cross-identity/mode confirmation before the next Send; branches preserve that local binding and imports cannot forge it. This is an accidental-send guard, not isolated per-account storage or a defense against a compromised renderer/native process. The saved developer API key represents one mode and is not resolved into a server-side account identity by this feature.

Sign-out cancels active work, clears in-memory credentials and closes temporary site windows. Remote session termination is best-effort. An application-wide quit grace may end before network revocation completes. There is no Remember me, cloud-sync client, automatic billing change or locally implemented account deletion. Account, password and security changes are performed by the user in the provider's UI. This native/website integration has not been exercised live; see ACCOUNT.md and VALIDATION.md before shipping it.

Custom system instructions are optional, not required. Omitting them never loosens native execution, auth or approval boundaries.


## Drafts and native close (0.10)

Unsent attached text is now saved beside draft text in the existing encrypted workspace; it is not transmitted merely by attachment or restart. Raw exports may contain draft/reference content and remain plaintext. Pending message-editor/Advanced buffers are session memory until explicitly saved/applied. A normal close reviews their potential loss rather than silently committing them. This is not protection against forced process termination, power loss or a compromised OS user.

The main-process close coordinator accepts one ID-bound renderer acknowledgement/decision. A stale reply cannot approve a later close; transport failure, missing renderer or unresponsiveness invokes a separate native choice. Failed draft flushing keeps the normal close blocked. Native execution remains a required target-machine check; injected lifecycle tests are not evidence of native window behavior.

Doctor validates source/dependency consistency, not authenticity or transitive safety of every package. Bootstrap needs registry access and normal install lifecycles; review the generated lockfile and dependency audit before distribution. Fixed direct versions are not an independent security audit. No plaintext-storage bypass or automatic code signing is supplied.
