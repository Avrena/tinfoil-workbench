# Android app — 0.12

Tinfoil Workbench for Android is the same renderer and conversation service as the Windows app, hosted by a [Capacitor 8](https://capacitorjs.com/docs) shell. It connects with a developer API key, verifies the Tinfoil enclave with the same SDK, and stores conversations in a workspace encrypted with a key held by the Android Keystore.

<img src="android-start.png" alt="Android start screen" width="270"> <img src="android-instructions.png" alt="System instructions picker on Android" width="270">

## Requirements

- Android 7.0 (API 24) or newer, with a current **Android System WebView** (or Chrome providing the WebView). The app requires the WebView features `WEB_MESSAGE_LISTENER` and `DOCUMENT_START_SCRIPT`. When they are missing, it shows *Update Android System WebView* and does not load. The stock WebView 83 of the Android 11 emulator image is refused. WebView 113 (Android 14 image) and WebView 133 (Android 16 image) work.
- A Tinfoil developer API key, or a Tinfoil Chat account with a password ([Tinfoil Chat sign-in](#tinfoil-chat-sign-in)). Google sign-in is not available on Android.
- Network access to `*.tinfoil.sh` over HTTPS.

## What differs from Windows

| Feature | Android |
|---|---|
| Chat, reasoning, comparison, branching, editing, projects, search | Same as Windows |
| Optional system instructions (picker, saved library, starters) | Same as Windows. Back steps from the editor to the list, and the editor's actions stay above the on-screen keyboard |
| Charts, tables, diagrams, timelines, stat cards, documents and HTML previews | Same as Windows (interactive HTML stays opt-in, opaque and network-free) |
| Enclave attestation and encrypted (EHBP) transport | Same SDK and settings as Windows (`desktop/provider.mjs`) |
| Tinfoil web search, text-only delegation | Same; delegation is approved in a native Android dialog |
| Local PDF preview (PDF.js) | Supported |
| Attach text files, import/export conversations, save generated files | Through the Android system document picker |
| Copy, open links | Android clipboard; links open in the browser after a native confirmation |
| Export an artifact **as PDF** | Only for artifacts that already are PDFs. Other artifacts can be saved in their original format. |
| Python execution | Not available. Model-requested Python cannot be set to *Ask*, and code blocks have no Run action. |
| Tinfoil Chat sign-in | Email and password on Tinfoil's own page, asked again after each restart. Google sign-in is not available |
| Window controls and close review | Not applicable. The draft is saved when the app goes to the background. |

## Architecture

```text
┌───────────────────────── WebView page (https://localhost) ─────────────────────────┐
│ renderer (dist/renderer, unchanged)   CSP: connect-src 'self'                      │
│        │ window.tinfoil {snapshot, command, subscribe, onAppEvent}  (frozen)        │
│ mobile/bridge.mjs ── postMessage ──► dedicated worker: mobile/host-worker.mjs      │
│        ▲                              WorkbenchService (desktop/service.mjs)        │
│        │ validated native requests    tinfoil SDK: attestation + EHBP → *.tinfoil.sh│
│        │ (mobile/native-ops.mjs)      MobileVault (AES-256-GCM), API key            │
└────────┼──────────────────────────────────────────────────────────────────────────┘
         ▼
 Workbench plugin (Java): Keystore key wrap/unwrap · atomic vault file · native dialogs ·
 system document picker · clipboard · open link · Back/pause events
```

- **The service runs in a dedicated Web Worker.** It plays the role of the Electron main process: `WorkbenchService`, the Tinfoil SDK, the model catalog loader and the vault run there unchanged from `desktop/`. The renderer document keeps the desktop CSP, including `connect-src 'self'`, so the page itself cannot reach the network. The worker is loaded from the app origin, and in Chromium the page's `<meta>` CSP does not govern it. This was verified on WebView 113 and 133.
- **`mobile/commands.mjs` mirrors the command switch in `desktop/main.mjs`.** Every native confirmation, stale-approval recheck, file limit and type check is repeated there. When one changes, change the other.
- **Native access is a fixed list.** The worker can request only the nine operations in `mobile/native-ops.mjs`. The bridge validates every request's shape before calling the plugin. There is no generic filesystem, network, intent or JavaScript-evaluation operation.
- **Storage.** `workspace.vault` in app-private storage uses the desktop envelope format (`tinfoil-workbench-vault`, version 1, AES-256-GCM, same associated data). The random 256-bit data key is wrapped by a non-exportable AES-GCM key named `tinfoil-workbench-vault-v1` in the Android Keystore. StrongBox is used when available, otherwise the TEE keystore. Writes use `android.util.AtomicFile`. Backup and device transfer are disabled because a restored vault could not be decrypted without the device-bound key.
- **Lifecycle.** Backgrounding the app (`pause`) flushes the composer draft and its attachments immediately. Back first dismisses the keyboard, then the topmost dialog, menu, find bar or drawer, and otherwise moves the app to the background instead of finishing it. A dialog with unsaved text (the message editor, or the instructions editor, which first returns to its list) asks before discarding it.

## Security model

In addition to the invariants in [SECURITY.md](../SECURITY.md):

- **Network allowlist.** `MainActivity` refuses every WebView request except the app's own files (`https://localhost`) and HTTPS to `*.tinfoil.sh`. This applies to the page, the worker and preview frames. Top-level navigation away from the app is blocked; links open only through the confirmed `open.url` command.
- **Capacitor built-ins disabled.** Capacitor registers `CapacitorHttp`, `CapacitorCookies` and `WebView` for every app. Workbench replaces them with stubs that reject every call, so page script has no native HTTP route and cannot switch the web root.
- **Bridge restriction.** The native bridge accepts messages only from the app origin's main frame (`WEB_MESSAGE_LISTENER`). Older WebViews would fall back to an interface visible to every frame, so the app refuses to run on them.
- **Other WebView settings.** File and content URL access, geolocation, pop-up windows, the web file chooser and web permission requests are all disabled. Capacitor logging is off in every build (`loggingBehavior: "none"`). Otherwise debug builds would write plugin arguments, including key material, to logcat.
- **What is weaker than Windows.** Desktop keeps the SDK and credentials in a separate OS process. On Android they live in a separate JavaScript realm (the worker) of the same WebView process. Script running in the app page could call the Workbench plugin, including `keyUnwrap`, because Capacitor cannot distinguish callers within the page. The page is protected by a strict CSP (no inline or remote script), inert Markdown rendering and opaque, bridge-free preview frames, but this is a process-level difference.

## Build

Use the same Node.js (22.12 or newer) checkout as the Windows build, plus JDK 21 and an Android SDK with `platforms;android-36` and `build-tools;36.0.0`.

```powershell
$env:JAVA_HOME = '<path to JDK 21>'
$env:ANDROID_HOME = '<path to the Android SDK>'
npm run bootstrap
npm test
npm run android:apk            # release APK; signed only when signing is configured (below)
node scripts/android-build.mjs --debug   # debuggable build for device tests
```

`npm run android:apk` compiles the renderer and runs `scripts/build-mobile.mjs`, which writes `mobile-dist/` with the bridge and worker bundles and `THIRD-PARTY-NOTICES.txt`. It then runs `cap sync android` and Gradle (`assembleRelease`). A signed APK is verified with `apksigner` and copied to `release/Tinfoil-Workbench-<version>-android.apk` with its SHA-256. The version comes from `package.json`: `0.18.1` gives versionCode `18001`.

Toolchain: Capacitor 8.5.2, Android Gradle Plugin 8.13.0, Gradle 8.14.3, compile and target SDK 36, minimum SDK 24.

### Release signing

The release key never enters the repository. Point `TINFOIL_ANDROID_SIGNING` at a Java properties file:

```properties
storeFile=C:/Users/<you>/.keys/tinfoil-workbench/android-release.p12
storeType=PKCS12
storePassword=…
keyAlias=tinfoil-workbench
keyPassword=…
```

Use forward slashes; Java properties treat backslashes as escapes. Alternatively set `TINFOIL_ANDROID_KEYSTORE`, `TINFOIL_ANDROID_STORE_PASSWORD`, `TINFOIL_ANDROID_KEY_ALIAS` and `TINFOIL_ANDROID_KEY_PASSWORD`. Without either, `assembleRelease` produces an unsigned APK, which Android will not install.

Android only installs updates signed with the same key. Keep an offline backup of the keystore and its password; losing them means users must uninstall (and lose local conversations) to install a build signed with a new key.

## Device tests

`tests/android-device.py` runs on one attached emulator or device (Python 3 with `websocket-client`, `ANDROID_HOME` set, English system locale):

```powershell
python tests/android-device.py --debug --live --apk release/Tinfoil-Workbench-0.18.1-android-debug.apk
python tests/android-device.py --release --apk release/Tinfoil-Workbench-0.18.1-android.apk
```

Installing replaces the app and its local data on that device. The two modes cover:

- **`--debug`**: drives the debuggable build through the WebView DevTools socket. It checks the platform surface, page CSP, worker allowlist, disabled plugins, draft durability across a force-stop, Back order, the native confirmation and keyboard layout. It also drives the system instructions picker with real taps and the real Back key, saves an entry while the on-screen keyboard is open, checks that the entry and the conversation's choice survive a force-stop, and reads the platform fonts DevTools reports for code.
- **`--live`**: adds a real enclave verification with a deliberately invalid key. Verification must pass and the key must then be rejected by the attested endpoint.
- **`--release`**: uses UI Automator on the signed build. It covers start-up, the non-debuggable package, a draft typed through the on-screen keyboard surviving a force-stop, the account view, the instructions picker with Back, and system document picker round trips (export, attach, import).

The emulator images have Android System WebView 133 (Android 16) and 113 (Android 14). Below WebView 140, Capacitor pads the view clear of the system bars itself. From WebView 140, which current phones have, it draws the page under the bars and reports them through the `--safe-area-inset-*` variables, so edge layout needs a device or image with a current WebView as well. `tests/ui-responsive.py` simulates those insets for every dialog.

Results for this release are in [VALIDATION.md](VALIDATION.md).

## Tinfoil Chat sign-in

Android Chat access was released in 0.13.0: the app signs in with email and password on Tinfoil's own sign-in page, shown on a separate screen with no bridge and a WebView profile of its own. Google OAuth requires a supported native/browser integration and is refused on that screen. It has been checked with a real account on one phone, with a debug build for 0.13.0 and with release-signed builds for 0.17.1 and 0.17.2. On a WebView without profiles or message ports, the app keeps using a developer API key. [ANDROID-ACCOUNT.md](ANDROID-ACCOUNT.md) records the design, the implementation and the checks.

The provider's page never loads in the app's WebView beside the privileged Capacitor bridge, and browser cookies are never copied. Tinfoil's page runs in a separate WebView with no bridge (`WorkbenchAccount.java`), and account credentials reach the host worker only over a private message port. That page is still an embedded browser, and Google refuses OAuth there.

**Google and other OAuth sign-in.** A supported Android route would follow [RFC 8252](https://www.rfc-editor.org/rfc/rfc8252): the system browser or a Custom Tab, the authorization-code flow with PKCE, and a registered redirect back to the app. Tinfoil's Clerk instance does advertise OAuth endpoints. Its discovery document (`https://clerk.tinfoil.sh/.well-known/openid-configuration`) lists authorization, token, device-authorization and revocation endpoints, `S256` PKCE, and the authorization-code, refresh-token and device-code grants. That is not a usable integration on its own. As of 28 September 2026, no public Tinfoil documentation provides:

1. A client ID for a third-party app on Tinfoil's Clerk instance, set up as a public client with PKCE. None is published, and the discovery document has no registration endpoint; in Clerk, OAuth applications are created by the instance owner.
2. The redirect URIs allowed for that client (an Android App Link, a reverse-domain scheme or a loopback address).
3. Whether `GET https://api.tinfoil.sh/api/chat/token`, or inference, accepts a Clerk OAuth access token. Tinfoil's own clients send a Clerk session token, and a backend accepts OAuth tokens only when it is configured to.
4. A scope or consent for Chat-subscription access. The discovery document lists only Clerk's built-in scopes.
5. A specification of the token endpoint: its response fields and the meaning of 401, 402, 429, `HOURLY_LIMIT_REACHED`, `resets_at` and `Retry-After`. Workbench follows Tinfoil's open-source web and iOS clients.
6. Session and refresh-token lifetimes and revocation on Tinfoil's instance. Only Clerk's defaults are documented: refresh tokens that never expire, and JWT access tokens that cannot be revoked.
7. Permission for third-party clients. Tinfoil's terms and acceptable-use policy contain no clause that explicitly permits or forbids using a Chat subscription from a third-party client.

There is no Tinfoil Android app or Android SDK to follow. Tinfoil's iOS app signs in with Clerk's native iOS SDK and Tinfoil's own publishable key; that is Tinfoil's registered integration, not one a third party can reuse. Until Tinfoil provides items 1–4, and ideally 5–7, Google and Apple sign-in are unavailable on Android. These items block the OAuth route only; they do not show that Tinfoil's direct sign-in methods need such a registration. Tinfoil's direct sign-in is the Android route until then. `tests/android-device.py` covers the app's foreground, background and resume behavior with that connection.

## Known limitations

- Python and HTML-to-PDF export are not implemented on Android. Chat sign-in uses email and password only: Google sign-in there needs a provider integration that does not exist yet; see [Tinfoil Chat sign-in](#tinfoil-chat-sign-in).
- Tested on Android 16 and Android 14 emulator images (x86_64). Physical devices, ARM hardware, OEM WebView variants, tablets, foldables, TalkBack and non-English system pickers have not been tested.
- A response streams only while Android keeps the app process running. Partial text is saved every 1.5 seconds and on interruption; after the process is stopped, the reply is marked interrupted when the app reopens.
- Updating Android System WebView is outside the app's control. Rejecting an old WebView is deliberate.
