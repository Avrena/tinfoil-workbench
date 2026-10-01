# Changelog

## Unreleased — conversation tags

- Settings → Tags holds a list of tags, starting with fourteen presets (Coding, Writing, Research, Learning, Creative, Health, Work, Money, Personal, Travel, Legal, Cyber, NSFW and Ambiguous).
  - Each tag has a name, one of nine colours, a hint for the model, and a style: filled, outline, filled with outline, a stripe on its left edge, or a dot before its name.
  - Each tag can have one of eighteen icons; every preset has one. On a phone, the title bar and the sidebar show the icon in place of the name, or the name's first letter when a tag has no icon.
  - Chips have small corners, and every colour follows the theme in light and dark.
  - Tags can be added, renamed and removed (with a confirmation that says how many conversations lose the tag), and **Restore presets** brings back removed presets.
  - Each preset looks like no other, and a new tag gets the first colour and style that no tag has.
- You can tag a conversation yourself, from the tag mark beside its title, **Tags…** in the conversation menu or the tag button on its sidebar row. The tags dialog switches each tag on or off, makes a new tag from a name you type, and **Remove all** clears them.
- **Tag and title new conversations** (off by default) sends one short request after a conversation's first answer.
  - The request goes to the model chosen in Settings → Tags, or to the conversation's own.
  - It contains the first message, the names of its files, the start of the answer and the tag list.
  - The model files the conversation under the tag that fits best, adding up to two more only when the conversation is mainly about them too, and gives it a short title, unless you renamed it.
  - The request offers no tools, turns thinking off where the model allows it and is never retried. Tags you chose are never changed by it.
- **Tag untagged conversations** tags older conversations the same way, one at a time, after a confirmation that states the number of requests and about how many tokens they use. It can be stopped, and Settings shows its progress and the tokens tagging has used since Workbench started.
- The sidebar shows each conversation's tags under its title.
  - A tag row under the search shows only conversations that have every tag you pick.
  - Search also matches tag names, and `#name` finds conversations by tag.
  - The tag button beside Threads groups conversations under their first tag instead of by day.
- Tags are kept in the encrypted workspace, and exports leave them out. A Tinfoil cloud chat also carries its tags in its encrypted cloud data, so Workbench on another device shows them and adds tags its list lacks; a tag change is written on its own, without touching the chat's messages or its place in Tinfoil Chat's list. Tinfoil Chat on the web keeps the tags when it edits the chat but does not show them. A conversation that becomes a cloud chat after its first answer waits briefly for its new title, so Tinfoil Chat gets that title too.
- Workspaces from 1.3.0 get the presets with tagging off. 1.3.0 can open a workspace saved by this version, but it drops the tags and the tag list.

## 1.3.0 — workspace agent, files and pictures, themes

- Workspace agent (Windows): Advanced → Workspace agent turns it on for a conversation. There you choose, once, where new folders are made (for example D:\Work\Tinfoil): a conversation without a folder gets a new, empty one there when it first sends, named after the date and its first message. A project folder can be chosen there instead, in a native picker with a confirmation; the message box has no folder button. The model lists, searches and reads files in the folder without asking. It runs Windows PowerShell 5.1 or Git Bash commands (git included) and changes files only after you approve each one in a native dialog that shows the exact command, or the change as a diff. It is not a sandbox: an approved command runs with your Windows account's permissions. Drive roots, your home folder, AppData, Windows and program folders cannot be chosen, as a folder or as the place for new ones; a conversation's new folder is never reused or deleted by Workbench. A change is written only if the file has not changed since it was proposed. See docs/WORKSPACE-AGENT.md.
- When a command names paths outside the folder, the approval card lists them first and the dialog one to a line. It is a warning, not a limit: an approved command can read a file anywhere you can.
- Commands, file changes and model-requested Python are approved in a window of Workbench's own instead of a Windows message box: the command or code in a fixed-width block with the paths outside the folder marked and listed, a change as a coloured diff (up to 2,000 lines), then where and how it runs and the warnings. Decline has the focus, Esc declines, and Approve can be pressed only after a moment. The main process opens it for one request, from its own origin with its own bridge; the conversation page cannot open, fill or answer it, and closing it declines.
- The plan takes a line of its own instead of the space beside Reasoning; a command is named in the activity row by its first working line, not the output-encoding setup models often begin with (the guide also says output is already UTF-8); and waiting for an approval or a command no longer shows as Thinking.
- The agent's PowerShell reads and writes files as UTF-8 by default; Windows PowerShell 5.1 otherwise reads them in the system code page, which garbles text such as Chinese.
- The agent is told to run npm.cmd, npx.cmd, yarn.cmd or pnpm.cmd in PowerShell: Windows PowerShell's default execution policy blocks npm.ps1 and the like, and models otherwise spent a step and an approval on a blocked `npm test`. Your execution policy is not changed.
- An agent reply may take 30 tool rounds and 60 calls per message and 60 minutes, not counting time spent waiting for your approval. Results older than the last ten go to the model as excerpts.
- Each agent call is shown by kind: a command with its folder, shell and exit code, a change as a coloured diff, and the model's current plan above them, with the step count in the status line. The Markdown export includes the folder and the diffs.
- A reply's tool calls share one row instead of a row per batch and another for single calls. While the reply runs, the row names the call in progress, with its path or command, and each new call rolls up into it over the last; when the reply finishes, it rolls once more into what was done, such as "Read 3 files, ran 2 commands, changed a file". Opened, it lists every call on one line of its own that opens its details, with a batch's calls under one heading. The two calls move together by one line, so they are never drawn over each other; a call that comes while a roll is under way waits for it to end, and the row then goes to the latest call. Approvals, calls queued to ask for approval next, and a running sub-agent stay in view below the row, so between two approvals the next card takes the place of the last. Reduced motion swaps the calls without the roll.
- Streaming flows instead of jumping: text that a model sends in bursts is shown in word-ending steps within about a third of a second, while a word or two still appears at once. The caret is a slim bar that holds still while text flows and breathes while waiting, at the end of a paragraph, list item or heading. Reduced motion shows text as it arrives. In a bursty sample the largest single jump fell from 158 characters to 49, and the largest scroll jump from 186 to 53 pixels.
- Thinking shows how long it has run: "Thinking 1m 05s" beside the label, moving on each second (and in the status line when reasoning is hidden), so a model that keeps thinking is easy to spot; Stop ends it, and the output limit ends each step at the latest. Afterwards the Reasoning label says "Thought for 1m 05s", the total over the reply's steps (`Reply.thinkingMs`; 1.2.0 ignores it).
- Approvals (Advanced → Workspace agent): ask before every command and change (the default); apply changes in the folder without asking; or run commands without asking too, except commands that name a path outside the folder or look like they delete, touch git history or remotes, change system settings or elevate, use the network or install, which still ask and say why. Raising the level is confirmed first; a new conversation or branch asks again, and turning the agent off resets it. At the last level, model-requested Python (when on) runs without asking too, since a command could start Python anyway; elsewhere every Python run still asks. Calls approved this way are marked "approved automatically", and the message box shows the level while it is on.
- Not in Tinfoil cloud chats or on Android; a conversation that used the agent stays on this computer.
- A reply may now hold 128 tool runs and 160 tool-history messages, and one step of the workspace agent may make 16 calls (the other tools stay at four); a model that made more than four at once used to fail the reply with "Unsupported streamed tool call." 1.2.0 cannot open a workspace with a reply over its limits of 96, 24 and four, which only the workspace agent produces.
- AGENTS.md and SECURITY.md allow the workspace agent's approved commands; the page still has no shell or filesystem bridge.
- Python is found by itself, and chosen where it is turned on: with Model-requested Python on, Advanced shows the interpreter under it, with its version, and lists the other installed ones: those on PATH first (the Python a terminal runs, with its packages), then those registered with Windows (python.org, Microsoft Store, Anaconda; the py launcher lists the same ones) and in the usual install folders, newest first. With none chosen, the first one is used when Python is turned on there or first runs (a code block's Run included); another can be picked from the list, or python.exe chosen, for all conversations and without Apply. Settings no longer has an Execution section. No Python is run to find them: Windows PowerShell reads the registry, and the version comes from the file's version resource or the pythonXY.dll beside it. Store shortcuts that open the Store instead of Python are skipped, and so are registrations left behind by an uninstall; a chosen interpreter that has since been removed is replaced by the first one found. When there is none, the message says so and links to python.org. The page can pick only an interpreter the search found.
- Advanced is wider on wide windows (up to 360 px), and its two- and three-way choices are inline buttons, like the sidebar's Cloud/Local tabs, instead of drop-downs: thinking mode, Model-requested Python, text-only sub-agents, and the agent's shell and approvals (Ask, Auto-edit, Auto-run). Several notes are shorter, and the agent's note no longer says that every command asks, which the approval levels made untrue.
- The notices on the message box for Python and the agent are flags on its top edge, where the role tab sits on the left: "Python" or "Python · auto", and "Agent · auto-edit" or "Agent · auto-run", amber when something runs without asking and icons only on a narrow window. Each explains itself on hover and opens Advanced.
- The sidebar's Projects and Threads sections fold to their headings and stay folded (`view.projectsFolded`, `view.threadsFolded`; 1.2.0 ignores them); a search shows everything.
- Search or command, the model picker, Reading & visibility and Move to project close on a click outside them.
- Workbench asks its questions before acting in a window of its own, drawn like the approval window, instead of a Windows message box: opening a link, a delegated request, signing out, allowing a thread for another account, deleting a conversation (with a red Delete), exporting, removing the chat key, saving markup, a folder or a higher approval level for the agent, and closing with an unconfirmed draft. Each is marked with a drawn warning triangle (red for a deletion) or question mark. Cancel has the focus, Esc and closing cancel, and the confirming button works after a moment. Android keeps its system dialogs.
- The workspace agent is told where its folder came from: a folder Workbench made is named after the conversation's first message, and models read that name as the user naming the folder (a greeting was answered as a reference to it). The guide also asks for an ordinary answer, without mentioning the folder or the tools, when a message needs no files or commands, and the approvals line of the agent's environment follows the conversation's level instead of always saying that every command and change is approved.
- Files can be dropped anywhere on the window or pasted, as well as picked with Attach: while a drag with files is over the window, it dims and says what a drop does, and the message box is outlined. Copying a file in Explorer and pasting works, and so does pasting a screenshot.
- Pictures (PNG, JPEG, GIF, WebP, BMP) can be attached for models that read them (Kimi K3, DeepSeek V4.1 Flash, GLM-5.3 Flash and Gemma 4 in Tinfoil's current catalog). Each is redrawn to fit 1536 × 1536, as Tinfoil Chat does, stored once in the encrypted workspace and sent as an image part; the message shows a thumbnail. Sending one to a model whose catalog entry says it cannot read pictures is refused, and a picture earlier in the conversation reaches such a model as a note instead. Workbench 1.2.0 drops pictures from a workspace it opens.
- Pictures in Tinfoil cloud chats, both ways (Windows). A chat from Tinfoil Chat shows its pictures by their thumbnails, and fetches the pictures themselves when you continue it, so the model sees them as it does in Tinfoil Chat. A picture attached in Workbench to a cloud chat, or in a conversation moved to Tinfoil cloud, is stored in Tinfoil's attachment storage first, as Tinfoil Chat stores its own: through the attested sync enclave, which seals each picture with a key of its own that the chat's encrypted messages keep. Tinfoil Chat then shows it on your other devices. Chats opened with an earlier version are read again once. Folders stay local: a cloud chat refuses them, and a conversation with folders attached cannot be moved to the cloud.
- A PDF's text is attached, page by page, read in the app with its bundled PDF.js; a scanned PDF without text is refused with a hint to attach its pages as pictures. Word, PowerPoint and Excel files are refused with a hint to save them as PDF or text; a file of another type is attached when it is UTF-8 text.
- A folder dropped or pasted on the window is attached as its path, not uploaded (Windows). With the workspace agent on, its read tools take full paths inside attached folders without approval; changes and commands there count as outside the folder. Only folders really dropped or pasted, or already in the conversation, are accepted, and the folders refused for the agent are refused here too.
- Themes: Settings → Appearance chooses System, Light or Dark, and for each a preset: Workbench's own look, or one of the Codex app's 29 presets (Absolutely, Catppuccin, Codex, Dracula, GitHub, Nord, Solarized, Tokyo Night, VS Code Plus and the rest; 28 have a dark version and 16 a light one). Each preset's accent, background and foreground can be changed with a colour picker drawn by Workbench, and a contrast slider spreads or narrows the panels, lines and hovers; Reset returns to the preset. With System, Workbench follows Windows, and so do its dialogs. The approval and confirmation windows, charts, diagrams and artifact documents follow the theme; code highlighting uses Dark+ or Light+. Every colour in the stylesheets is now a token of the theme (`view.theme`; 1.2.0 ignores it).
- Chat background (Settings): none, a texture (Tinfoil Chat's fine grid, dots or grain) with a strength slider, or a picture of your own behind the conversation. A picture can be blurred, turned grey and dimmed toward the background; each of these is a switch whose slider shows only while it is on. The picture is stored, at most 2048 pixels wide, in the encrypted workspace (`view.background`; 1.2.0 ignores both).
- Android: Attach also takes pictures and PDFs.
- Android: versionCode 1003000.

## 1.2.0 — versions inside a conversation

- Versions: an edited message, Retry, and an edited answer or thinking text make a new version of that point in the same conversation instead of a new conversation in the sidebar. ‹ 2/3 › arrows on a message switch between its different wordings, each showing its latest answer; arrows on a reply switch between the answers to the same message. Only the version shown is sent to a model, exported as Markdown and written to a Tinfoil cloud chat; the JSON export keeps all of them. Branch still copies the conversation shown into a new one.
- Edit on a message puts it and its files in the composer, marked "Editing message N". Send makes the new version; the draft you had comes back after Send or Cancel.
- Answers and their thinking text are edited where they are shown instead of in a dialog: the answer in place of its text, or the thinking inside its Reasoning box, one at a time, with the composer out of the way. The expanded draft editor stays.
- The reply's actions (Edit, Copy, Source, Retry, Branch) are icons without words, named in their tooltips and for screen readers, and the Branch icon is redrawn; a message's Edit is an icon too.
- The thinking effort panel stands on the composer's top edge, across the whole composer on a phone, slides up out of it and back, and stays there while the keyboard, the window or the message changes size. Its thumb follows a finger or the mouse while dragged and settles on the nearest level when released; the gauge's needle turns to the new level.
- Retry is offered on every finished reply, not only on failed ones.
- Messages in other roles: Advanced → Editing → Add messages in other roles (off by default) shows a User, Assistant and System tab on the composer's top edge, to add an assistant or system message without asking a model; the tab returns to User after one is added. Tinfoil cloud chats have no place for them.
- Android: a phone no longer shows the window title bar; the conversation starts under the status bar.
- Android: Stay signed in on this phone, on by default. The Tinfoil website session is saved sealed with an Android Keystore key and restored at launch, so updates and restarts keep you signed in; signing out or turning it off deletes it.
- Earlier versions cannot open a workspace that holds messages in other roles, and they drop set-aside versions when they save.
- Android: versionCode 1002000.

## 1.1.0 — sidebar like Tinfoil Chat's, thinking gauge, clearer failures

- The arrows of the Reasoning and tool-activity disclosures are drawn at the centre of their labels; the arrow glyph sat lower than the text.
- Sidebar, with Tinfoil cloud chats connected (Windows): a Sync button on the Threads heading, in the column of the Projects + button; Cloud and Local buttons that switch the thread list, remembered as a view preference; a new thread started from the Cloud list becomes a cloud chat after its first reply. Hovering a thread shows Delete and, for a local thread with messages outside projects, Move to Tinfoil cloud; after a touch they stay hidden, so they never cover a title on a phone.
- Composer: thinking effort is a gauge, filled up to the chosen level and highlighted unless the provider default is used. It opens a slider over the model's levels, with a stop for each; the choice applies when the slider is released.
- Advanced no longer has a Model field beside the composer's model picker, which lists Tinfoil's chat models and takes any other model ID; the comparison model field stays.
- Title bar: the search box is centred on the window, 40% of its width. The status bar no longer says "Ready" and "Encrypted on this device"; it shows activity only while there is some.
- Visual calls written as text: when a model writes a chart, table, diagram, timeline or stat-card call into its answer instead of making it (GLM-5.3 Flash did), Workbench draws it in place, marked as written as text, and records it as a real call for later turns. Python and artifacts never run from text.
- Android: a reply cut off because the app left the screen says so, instead of "Tinfoil could not be reached. Check your connection".
- A reply that failed before writing anything no longer adds "No answer text was returned." above its error.
- Settings and NOTICE say that Workbench is unofficial, not affiliated with or endorsed by Tinfoil, with an icon of its own.
- CI: build copies expire after a day and a full artifact storage no longer fails a job; the Android 14 device test retries a dropped Back press.
- Android: versionCode 1001000.

## 1.0.0 — first stable release

- Dependencies: Electron 44.4.5, which backports fixes from upstream Chromium, V8, ANGLE, Dawn and PDFium; PDF.js 6.3.289; TypeScript 7.0.2, the native compiler, which emits the same JavaScript for this source; and current GitHub Actions for CI.
- PDF preview: PDF.js 6 needs Chromium 125 or newer. On an older engine, such as an Android WebView that cannot update, the viewer says that PDF preview needs a newer one instead of failing inside PDF.js. A file PDF.js cannot open now says so instead of pointing to the installation.
- Windows package: PDF.js and its Node-only canvas module, with a native binary, are no longer packed into the app, which never loaded them; the installer is about 16 MB smaller.
- Documentation: the README lists the known limitations of this release; document titles no longer name old versions.
- Tests: the browser preview is built with esbuild instead of TypeScript's JavaScript API, which TypeScript 7 no longer has; `tests/ui-artifacts.py` checks the PDF engine notice.
- Android: versionCode 1000000.

## 0.18.1 — readable model picker and model name on phones

- Phones: on a 360px-wide screen (a 1080px screen at density 480), 0.18.0 kept Send on the composer's row beside a thinking-effort picker but left the model name about 30px, so GLM-5.3 showed as "G…". Up to 600px wide the model button now drops its chevron (it still opens the picker) and uses a smaller maker mark, and the composer's controls sit 2px apart, so the name gets 57px at 360px and the phone shows "GLM-5.3" in full.
- Phones: in *Choose model*, a list longer than the dialog squeezed its rows until their lines overlapped, because touch screens give every button a 44px minimum height that replaced the rows' content height. Rows now keep their full height and the list scrolls.
- The phone composer check in `tests/ui-responsive.py` now runs at 360 and 393px, and a new check opens the model picker at 360 × 560 with a list that scrolls (95 checks).

## 0.18.0 — Tinfoil Chat widgets in synced chats; room for reasoning models

- Windows, Tinfoil cloud chats: charts, timelines and stat cards that Tinfoil Chat's model made now appear in Workbench where Tinfoil Chat shows them, drawn by Workbench's own renderers from the widgets' data, with Data and Source views. Other widgets (images, link previews, maps, clocks, recipe cards, message drafts, sports scores, artifact previews) are listed as not displayed; nothing in them is fetched or run. Chats already opened are read again once at the next sync, unless they hold changes not yet written.
- The default output limit for new conversations is 32,768 tokens, up from 8,192. Reasoning counts against it: GLM-5.3 spent all 8,192 tokens reasoning about a revenue question and wrote no answer. A new conversation copied from one still on 8,192 starts at 32,768; existing conversations keep their own limit. Each chat model in Tinfoil's catalog accepts the new limit.
- When an answer stops at the output limit, the notice names the limit, says when the model spent it all on reasoning, and points to Advanced settings.
- Diagrams: edges both ways between boxes in different rows and columns are bent apart instead of running almost together, each labelled beside its own curve; a label that would cover a box or another label moves by a line.
- Phones: a model with a thinking-effort picker no longer pushes Send onto a second row of the composer.
- Add `tests/cloud-widgets.test.mjs`, tests of the re-read, the notice, the new default and the diagram labels, and browser checks for synced widgets (`ui-cloud.py`, 7 checks) and the phone composer (`ui-responsive.py`, 94 checks).

## 0.17.2 — visuals where they are called; readable diagrams on phones

- The model is told that a visual appears in the answer where its tool is called, and never to stand in for one with HTML, a placeholder or a Mermaid or ASCII drawing, or to repeat it as a table or code block. In a test with a real model, the Visual explainer starter had led it to write placeholders and describe a chart it never made. The starter now says the same.
- Diagrams on phones keep at least 80% of their drawn size and scroll sideways, instead of shrinking their labels to a few pixels.
- Diagrams: edges in both directions between two boxes run side by side with their labels apart; arrows that point up or along a row end at the edge of their box instead of under it; labels are drawn over lines and boxes, and same-row labels sit above the row; empty grid columns and rows are no longer drawn as blank space.
- Add tests of the new guidance, `tests/diagrams.test.mjs` (3 tests) and a phone-width diagram check in `tests/ui-charts.py` (13 checks).

## 0.17.1 — verified at launch; Visual explainer starter

- Workbench now verifies the enclave and loads the model list by itself: at launch when an API key is saved, when a Tinfoil Chat sign-in completes or a saved one is restored, and after switching the connection. It uses only that connection's own credential and never signs in, opens a window or falls back to the other one. *Verify & refresh models* still checks again on demand. Before, the app showed "Not connected" after every launch until it was pressed or a message was sent.
- A new read-only starter, **Visual explainer**, asks for a visual whenever an answer involves numbers, change over time, comparisons, dated events or a process, and names the tool for each job, including the timeline and stat cards.
- Add service and account tests of the automatic check and a test of the starter.

## 0.17.0 — timelines and stat cards; centred bars

- Two new visual tools, with the names and arguments of the Tinfoil Chat widgets of the same name: `render_timeline` shows dated events in order, marking planned, projected or unconfirmed ones as tentative; `render_stat_cards` shows up to eight headline figures, each with its change against a named period, whether that change is good, and a sparkline of recent values. Both have a Data view, and save and export as script-free HTML. The tool guide tells the model when to choose them.
- Bar charts: series that never share a label, such as reported values and a projection, are drawn as whole bars centred on their labels, instead of half-width bars beside an empty slot.
- Saved artifact file names keep dashes and turn other punctuation into spaces, so a title with "2023–2026" is no longer saved as "20232026".
- Add `tests/widgets.test.mjs` (7 tests), a chart test for centred bars, a file-name test, and three checks in `tests/ui-charts.py` (now 12).

## 0.16.0 — the model knows its visual tools; better charts

- The model is now told when and how to use its tools. While visual tools or Python are offered, the system message starts with a short, fixed guide to them, in the XML-section style of Tinfoil Chat's own prompt: create a chart, table or diagram unasked when it shows something better than prose, pick the simplest one, keep a short written reading, revise a visual rather than duplicate it, and never claim one that failed. Your own instructions follow it and take precedence. It costs about 330 tokens per request (400 with Python) and is identical on every request, so the provider's prompt cache covers it. With *Visual tools* off and Python off, nothing is added.
- Charts: pie charts (one total in two to six parts, drawn as a donut with its total), stacked bar and area charts, and units such as $, % or ms on values. Hovering a chart shows every series at that point in one readout, with a crosshair on line and area charts and the whole category on bar charts; with the chart focused, the arrow keys read the same values. Axis ticks are round numbers. Bars have rounded ends and small gaps, and the series colors are a palette checked for color-vision deficiency and contrast on the dark background (the first two colors were hard to tell apart before).
- Cloud project names, instructions and documents are escaped inside `<project_context>`, as Tinfoil Chat does, so a document cannot pose as instructions.
- The instructions picker says that None sends no instructions of yours, rather than no system message.
- Add `tests/prompt.test.mjs` (4 tests), `tests/charts.test.mjs` (9 tests), a service test of the guide, and the browser suite `tests/ui-charts.py` (9 checks).

## 0.15.1 — saved sign-in after a slow start

- Windows: a saved sign-in that cannot reach Tinfoil when Workbench starts, for example after a power cut while the network or a proxy is still coming up, is now tried again automatically: after 15 seconds, 30 seconds, 1 minute, then every 2 minutes, and after the PC wakes. Until then the Account view says the sign-in is kept. Cloud sync resumes once it is restored.
- *Reconnect Tinfoil Chat* now tries the saved sign-in again first. Before, it signed out, which deleted the saved sign-in and asked for a new one even though the session was still valid. A new sign-in is needed only if Tinfoil reports that the saved session has ended.
- Add three tests of the retries and of Reconnect to `tests/account-remember.test.mjs`.

## 0.15.0 — Tinfoil cloud chats and projects on Windows

- Windows: two-way sync with Tinfoil Chat's cloud chats and projects. Add your chat key (the `key_…` string or the key file from Tinfoil Chat) under Account → Tinfoil cloud chats; Workbench checks it against your account's current key and keeps it encrypted. Your 300 most recent cloud chats appear in the sidebar and load their messages when opened; cloud projects appear with their instructions and documents, which are added to requests in their chats as Tinfoil Chat does. Continuing, renaming, editing, moving between cloud projects or deleting a cloud chat changes it in your Tinfoil account; a conversation in a cloud project, or one you move with *Move to Tinfoil cloud*, becomes a cloud chat. Local conversations stay local. Sync runs after sign-in, every ten minutes and on *Sync now*.
- Writes name the version they were made against and change only what Workbench changed; every field Workbench does not use is kept. If a chat changed in Tinfoil meanwhile, the cloud version wins and Workbench's version is kept as "… (Workbench copy)". The key reaches only Tinfoil's attested sync enclave. See `docs/CLOUD.md`.
- Conversations are limited to 800 on a device (was 300), to leave room for cloud chats.
- New cloud chats get IDs in Tinfoil Chat's format (a reverse timestamp and a random UUID), made in Workbench as Tinfoil Chat makes them.
- The packaged-app release check (`scripts/check-packaged-provider.mjs`) also verifies the cloud sync enclave through the packaged cloud client.
- Android is unchanged: the cloud sync modules stay out of its worker bundle, and a test checks the worker's imports.
- Add `tests/cloud.test.mjs` (9 tests), `tests/cloud-sync.test.mjs` (16 tests), the browser suite `tests/ui-cloud.py` and the manual live check `tests/cloud-live.mjs`.

## 0.14.0 — stay signed in on Windows

- Windows: stay signed in to Tinfoil Chat across restarts and updates. While *Stay signed in on this PC* is on (the default, under Account & connection → Session & local workspace), Workbench saves Tinfoil's website session: the persistent cookies of tinfoil.sh and its subdomains, sealed with your Windows account (DPAPI) in `account-session.bin`. At the next launch it restores the session in a hidden window and uses it only if it still belongs to the same user and Clerk session. Quitting no longer ends the session while it is saved. Signing out, turning the option off, or an ended or rejected session deletes the saved copy. Offline at launch, the saved sign-in is kept and retried when Chat access is next needed. Android still asks you to sign in after the app restarts.
- Add `tests/account-remember.test.mjs` (13 tests) and Account view checks for the restoring state and the switch in `tests/ui-account.py`.

## 0.13.2 — Windows connections and maker logos

- Windows: the installed app can now connect. The Windows builds up to 0.13.1 lacked zod, which the attested SDK's AI SDK dependencies import; npm had installed it only as their peer dependency, and electron-builder does not pack such packages. Loading the SDK failed with ERR_MODULE_NOT_FOUND, so every verification failed, with an API key and with Chat sign-in. Runs from source were not affected, and neither is the Android app, whose build bundles its dependencies. zod is now a direct dependency.
- The packaged Windows app is now checked, not only the source: `npm run dist:win` ends with `scripts/check-package.mjs`, which requires every packaged module's dependencies and required peer dependencies to be in `app.asar`; the smoke test loads the attested SDK; and a release gate, `scripts/check-packaged-provider.mjs`, verifies a live enclave through the packaged app. Windows CI runs the package check and the packaged app's smoke test.
- A module that cannot be loaded is reported as such: "Workbench could not load part of its secure connection code (ERR_MODULE_NOT_FOUND). Reinstall or update Workbench." Only socket, DNS and TLS errors now read "Tinfoil could not be reached", and other failures show their error code.
- *Choose model* shows each maker's logo (DeepSeek, Z.ai, Moonshot AI, Google, OpenAI, Meta, Mistral AI, Qwen) in white on the maker's colour, instead of a monogram, and the welcome page shows the logo alone in muted white. Makers without a logo keep the monogram. The logos come from LobeHub Icons (MIT).
- Model rows show the description from Tinfoil's catalog in two lines at most, with the full text as the row's tooltip, and the capability marks keep fixed columns. On narrow screens the marks and the context size take their own line.
- The model button centres its badge, name and arrow. A display rule had turned off its flex layout, which placed the badge above the name.
- Add `tests/packaging.test.mjs` (2 tests) and model picker tests for logos, descriptions, mark columns, the button's alignment and the new messages.

## 0.13.1 — model list and clearer connection errors

- *Choose model* lists Tinfoil's chat models instead of asking for a model ID. Each row shows the maker's badge, the model's name, marks for reasoning, image input and tool calling, and the context size. The list opens in full with the current model marked, search matches names, IDs and makers, and any other ID can still be entered. Speech, embedding, document, tool and safety models are left out.
- The list no longer stays empty until *Verify & refresh models* has run. It comes from Tinfoil's public model catalog, fetched without credentials when the picker opens, and from the verified endpoint after any successful verification. After a failed fetch, the catalog is requested again after a minute at the earliest.
- The welcome page shows the chosen model's maker as a muted-white SVG monogram instead of the Tinfoil mark, and the composer shows the maker's badge and the model's name instead of its ID.
- Connection failures say what failed instead of "The secure request failed": a verification timeout, the verification step that failed (the step results are kept), a Chat session that ended during verification, or a network failure with its error code, such as `ECONNRESET`.
- The system instructions field keeps its Optional tag; the same note is no longer repeated in the account view, the instructions picker and other labels, or in the documentation outside the instructions section.
- Add `tests/model-picker.test.mjs` (17 tests), model picker checks in `tests/ui-smoke.py`, and Android picker and catalog checks in `tests/android-device.py --live`.

## 0.13.0 — Tinfoil Chat sign-in on Android

- Android: sign in to Tinfoil Chat with your email and password. Tinfoil's own sign-in page opens on a separate screen, with no bridge to the app and a WebView storage profile of its own, and Chat access renews as on Windows. Google and Apple sign-in are not available in the Android app: Google refuses sign-in in embedded views, and a supported route needs Tinfoil to register the app. While you are signed in, the website session is kept in the app's private storage; it is deleted when the app next starts. Checked with a real account on one phone, including a key renewal after expiry. On a WebView without the needed features, such as Android System WebView 113, the app keeps using a developer API key.
- Android: dialogs no longer sit under the status bar with a current Android System WebView. From WebView 140, the app is drawn under the system bars and has to keep its own content clear of them. The main screen did, but full-screen dialogs (Account & connection, the message editor) and tall ones (System instructions) started under the status bar, where their close buttons could not be tapped, and could reach under a navigation bar. Dialogs, the message editor and short notices now stay clear of the status bar, navigation bar and display cutout. The emulators used for the device tests have WebView 133 and 113, where Capacitor pads the view itself, so the problem first showed on a phone with WebView 153. `tests/ui-responsive.py` now checks every dialog with simulated system-bar insets.
- Add `tests/android-account.test.mjs` (14 tests) and Android sign-in checks in `tests/android-device.py`, which now matches labels regardless of case, as some devices draw dialog buttons in capitals. The custom system prompt remains optional and not required.

## 0.12.1 — Tinfoil Chat sign-in and token renewal on Windows

- Sign in on Tinfoil's own sign-in page (`chat.tinfoil.sh/signin`) instead of Clerk's generic modal. The page continues pending authentication steps by itself; the generic modal required another action.
- The sign-in window no longer stalls during account-cookie redirects. Afterwards Google moves the page to `accounts.youtube.com` and to the account host of the user's country domain (for example `accounts.google.co.uk`) to set account cookies, and the sign-in window refused both. It now allows `accounts.youtube.com` and the account host of each of the 187 domains Google publishes as its own, and nothing else under them. The host list now applies to the page but not to its frames, whose redirects were also being cancelled. If the page tries to open any other site, the Account view names it instead of leaving the page stalled.
- Chat access renews without another sign-in. A key is renewed when a request needs it and 60 seconds or less would remain, and its lifetime is measured against the server's `Date` header, so a wrong PC clock does not matter. A token response without a valid UTC expiry, already expired or expiring within 30 seconds is refused; a missing expiry used to be accepted for 60 seconds.
- A sign-in is bound to the website's Clerk session as well as its user. If either changes, including during a token exchange, the result is discarded and the account must be reconnected. Signing out during a token exchange discards its late response.
- A usage limit, recognized by HTTP 429 or Tinfoil's hourly-limit code, waits for the reported reset, then `Retry-After`, then 60 seconds, for at most one hour. It is no longer retried on the next request or treated as a rejected session.
- If Tinfoil rejects a Chat key during a reply, only that key is dropped: you stay signed in, partial text is kept, and retrying the turn requests a new key. This used to sign the account out.
- Waking the PC from sleep drops an expired key at once. A failed access check right after sign-in keeps you signed in, so Refresh account can try again.
- Android is unchanged and still connects with a developer API key. Google sign-in there needs a provider integration that Tinfoil does not publish (docs/ANDROID.md); Tinfoil's direct sign-in methods are a separate candidate, not yet investigated at release time (docs/ANDROID-ACCOUNT.md). The device test now also checks that Android refuses Chat sign-in and resumes from the background in the same process.
- Add `tests/account-live.mjs`, a manual check with a real account that logs no credentials, and 29 more tests in `tests/account.test.mjs`.
- Checked on Windows 11, running from source, with a real Tinfoil account, including a key renewal after expiry; see docs/VALIDATION.md. The custom system prompt remains optional and not required.

## 0.12.0 — system instructions selection and reading type

- Choose optional system instructions per conversation from a composer button, the conversation menu, the command palette or Advanced. The choices are None (the default), saved instructions, or read-only starters (Concise, Explainer, Editor, Code assistant) that can be customized as a copy. The custom system prompt remains optional and not required; None sends no custom system message.
- Save, edit and delete reusable instructions in the encrypted workspace (up to 50 entries of up to 40,000 characters). Selecting an entry copies its text and name into the conversation, so later library edits or deletion never change an existing conversation. The editor asks before discarding unsaved changes, and close review reports them. On phones its actions stay above the on-screen keyboard.
- Answers no longer have a header row. The model name, the instructions each request was sent with, the Edited label and opt-in timing/usage form a quiet line below the answer, beside its actions. It truncates rather than wraps when action labels appear on hover (the full text is in its tooltip) and takes its own line in narrow replies. Comparison lanes keep a model label above each lane. The name is recorded on each reply at send time, is display-only and is never sent to a model; Markdown exports include it.
- The second click of a double-click that closes a dialog, or that switches the instructions picker between its list and editor, no longer acts on the controls it uncovers.
- Pressing Escape twice no longer discards unsaved text. Chromium lets a page keep a dialog open on Escape only once per user activation, so the second Escape closed the message editor or the instructions editor without the question it had just asked (Electron 44 included). The renderer now handles Escape itself, as Android Back already did, and both act on the dialog on top, such as close review over an unsaved editor, instead of the dialog that comes last in the document. An Escape that ends an IME composition is left to the IME.
- Reading type: answers, prompts, the composer and editor previews use 15px text. Headings have a clearer scale and balanced wrapping, paragraphs avoid single-word last lines, and tables and code blocks are larger.
- Fonts: Windows 11 installs its variable UI font as optical-size families (`Segoe UI Variable Text`, `… Small`, `… Display`). The stylesheet asked for `Segoe UI Variable`, which matches none of them, so text fell back to Segoe UI. It now requests `Segoe UI Variable Text`, and `Segoe UI Variable Display` for large reply headings, with Segoe UI as the fallback; Electron 44 on Windows 11 renders both with Segoe UI Variable. One shared monospace stack replaces the per-rule lists and no longer names Courier New, which Android maps to its serif typewriter face (Cutive Mono); inline code and code blocks now share one sans monospace face on Android.
- Add `tests/instructions.test.mjs`, and extend `ui-smoke.py`, `ui-spacing.py`, `ui-editing.py`, `ui-handoff.py` and `ui-responsive.py` with instruction selection, reply signature, footer/composer geometry, repeated Escape, stacked dialog and keyboard-height checks. `tests/android-device.py` covers the picker with touch, Back and the on-screen keyboard, its persistence across a force-stop, and the fonts used for code.
- The workspace format stays at version 1. Opening it in 0.11.0 keeps conversations and their instruction text, but 0.11.0 drops saved instructions and instruction names the next time it saves; back up before downgrading.
- Verified on Windows 11 and on Android 16 and Android 14 emulators; see docs/VALIDATION.md. The custom system prompt remains optional and not required.

## 0.11.0 — Android app and first verified release build

- Add an Android app (Capacitor 8, Android 7.0+ with a current System WebView):
  - The unchanged renderer runs in the WebView. The shared service, Tinfoil SDK (attestation + EHBP), vault crypto and API key run in a dedicated worker, while the page keeps `connect-src 'self'`.
  - The workspace uses the desktop vault format, with its data key wrapped by a non-exportable Android Keystore key, atomic writes, and backup and device transfer disabled.
  - A fixed nine-operation native plugin provides native dialogs, the system document picker, clipboard and link opening.
  - The WebView network allowlist admits only `https://localhost` and `*.tinfoil.sh`, Capacitor's HTTP, cookie and server-path plugins are disabled, and the app refuses WebViews without an origin-restricted bridge.
  - Backgrounding saves the draft, and Back closes the topmost layer before backgrounding the app.
- Android omits Tinfoil Chat sign-in, Python execution and HTML-to-PDF export, and says so where those controls would appear. Desktop behavior is unchanged: the renderer reacts only to an optional `platform: 'android'` snapshot field and an optional `onAppEvent` bridge callback.
- Fix bootstrap for Electron 44, which no longer downloads its binary from an install hook: `npm run bootstrap` now fetches it and verifies it against the checksums shipped in the pinned package. CI uses bootstrap and Node 24.
- Commit the reviewed lockfile. npm 11's install-script gate records `electron-winstaller` and `esbuild` as explicitly denied; neither script is needed.
- Fix Python output-file collection on Windows when TEMP is an 8.3 short path (for example `C:\Users\RUNNER~1\...`). The containment check compared the long `realpath()` of each file with the short output directory and silently dropped every file. It now compares resolved paths on both sides. Found by the first GitHub Actions Windows run.
- Make the Python browser suites run on stock Windows: they use Playwright's bundled Chromium, read files as UTF-8, and `ui-activity.py` no longer checks too early for a result that renders on the next animation frame.
- Add 18 Node tests for the Android host (vault format and tamper handling, command parity, native-operation allowlist) and `tests/android-device.py` for emulator/device checks. Add Android and renderer CI workflows.
- Verified on Windows 11 and on Android 16 and Android 14 emulators, including a live enclave verification from the Android worker; see docs/VALIDATION.md. The custom system prompt remains optional and not required.

## 0.10.0 — local handoff and recovery

- Persist composer drafts and selected text-file contents together in the encrypted workspace; clear only the sent draft, retain branch references, and migrate older workspaces additively.
- Route native close through a single acknowledged review, protect pending editor/settings/active work, flush the composer before normal exit, and provide an explicit native fallback for an unavailable renderer.
- Retain unapplied Advanced values per thread, restore model-dependent effort controls, make Apply/Discard reachable without reopening the inspector, and clear deleted-thread UI caches.
- Stop edit/navigation/import paths after failed draft saves while retaining explicit plaintext export for recovery; show errors within top-layer dialogs, add accessible names, clear unsubmitted key fields on dismiss, and await clipboard completion.
- Pin Electron 44.4.3 and electron-builder 26.17.0; add read-only source/dependency doctor, sequential local build helper, packaging gates and CI lockfile validation before cache setup.
- Add source/recovery/browser checks, preserve synthetic streaming work counters, and document Windows/live-account acceptance rather than claiming an executed native release. The custom system prompt remains optional and not required.

## 0.9.0 — optional instructions, account profile and isolated sign-in

- Label the custom system prompt optional/not required; preserve blank-input omission in ordinary chat.
- Add an experimental, explicit Tinfoil website sign-in adapter with temporary no-preload browser isolation, exact-origin/current-user checks, published subscription token exchange, memory-only credentials, bounded refresh/cancellation and no automatic fallback to free or developer billing.
- Add a neutral Account view, profile/security management through the provider UI, collapsed reported quotas, explicit connection-mode choice, sign-out/reconnect and viewport-safe phone/tablet presentation.
- Bind existing history to explicitly approved Chat identities/modes, preserve branches, remove bindings on export/import, and keep sign-in separate from local workspace/cloud sync.
- Keep account credential handling out of the renderer/vault/export. Preserve all existing tool approvals, model capabilities, editor/visualization behavior and measured streaming work.
- Live website/social/passkey authentication, native Windows and actual provider access remain untested. The included preview refuses real authentication and labels its synthetic account samples.

## 0.8.0 — grouped actions, provider MCP events and text-only delegation

- Register entire function-call rounds before sequential execution; preserve batch identity, queue positions, per-action approvals and exact tool-result pairing.
- Parse documented Tinfoil provider progress markers with bounded chunk-tolerant buffering, secret-key redaction, safe source links and honest incomplete/blocked states; never execute a marker locally.
- Add explicit opt-in hosted web-search options. No arbitrary MCP server configuration or hosted code-execution credentials are supplied.
- Add disabled-by-default `delegate_task`: native-confirmed same-model task-only request, two-request send-wide budget, no inherited history/tools/recursion, separate child reasoning/usage, individual cancellation and transport cleanup.
- Add neutral inline batch/provider/child activity with lazy retained detail islands, accessibility and compact touch layout. Markdown exports include activity provenance and child reasoning/usage.
- Keep model-aware reasoning, editing, projects and visual tools unchanged. Tests distinguish synthetic adapters from untested native/live integrations.

## 0.7.0 — aligned spacing and bounded responsive controls

- Added a shared spacing stylesheet, bundled into the existing CSS request. Align the reading column, inline figures and composer; tighten message groups while retaining clear turn separation and neutral, borderless figures.
- Align project/search rows and two-line thread headers. Let visualization controls respond to their own width, including split desktop views. Remove unused chart/diagram heading space without shrinking chart data plots or changing headed/print chart exports.
- Reduce idle composer height, grow multiline drafts, and anchor Latest to one observed composer region. Keep model/effort/action controls inside narrow widths. Shorten only the compact provider-default display label.
- Unify editor/header/body/footer insets and wrapping. Fix app-shell focus scrolling after compact drawers by making the outer app a clipped, non-scrollable container; preserve inner scroll regions.
- Strict build and 185 Node tests passed. Seven Chromium suites passed 291 checks, including 103 spacing checks. Phone/tablet coverage is emulation, not physical-device or native Windows testing.
- Three synthetic streaming runs per version against the supplied 0.6 preview: unchanged Markdown/template input counts, zero measured-phase artifact remounts.

## 0.6.0 — revision editors, project hierarchy and responsive touch layouts

- Added a common retained editor for composer drafts, earlier prompts, completed answers and existing returned thinking. Includes Write/Preview/Changes, source formatting, native undo, independent buffers, original restoration, explicit save and a dirty-close guard.
- Prompt changes create unsent branches; answer/thinking changes create continuation branches. Preserve originals, tool call/result pairs and visualization positions, detect stale edits, and clearly label thinking revisions as local annotations. Restoring original narration retains correct subsequent model context.
- Added project organization, thread grouping, active project/thread headings, rename/move/create actions and original-branch navigation. Migrate older workspaces without losing threads; project removal keeps conversations.
- Added phone fullscreen editors, touch controls, ephemeral navigation/advanced/artifact drawers, visual-viewport sizing, keyboard-height/rotation handling, readable adaptive chart geometry and local table overflow. Touch Enter inserts a newline; IME confirmation is not submission.
- Strict build and 180 Node tests passed. Six Chromium suites passed 188 checks, including 19 editing checks and 89 touch/viewport checks across eight sizes. Device/keyboard tests are emulation, not physical phones, native Windows or live-provider tests. The validation record also documents an intermittent rapid-modal checkbox hit-test issue from stress reruns.
- Compared authentic 0.5 and current previews in three synthetic runs: identical Markdown input work; 0.26% more template input. No measured-phase visualization remounts.

## 0.5.0 — seamless neutral visualizations and lower-overhead rendering

- Removed navy visualization surfaces, enclosing card borders/shadows and the second header strip. Kept the inline text–figure–text layout, compact controls, neutral axes/table rules and optional expanded workspace.
- Made host SVG and HTML surfaces transparent. Matched iframe/root color schemes to prevent Chromium's white default canvas. Supplied document styles are not recolored; generated SVG labels/series get a high-contrast print palette for white PDF pages.
- Separated rich-text islands from reply chrome. Skip unchanged segments and all closed reasoning, retain code-block offsets, and use bounded math/code LRU caches instead of repeated typesetting.
- Added coalesced frame scheduling, hidden-window deferral and immediate final/approval updates. Pause transcript work while a modal is open; preserve input controls above lazy frames.
- Lazily mount off-screen figures near the viewport. Retain at most three static tab surfaces per selected inline revision; preserve chart series and table filters across tabs/collapse. Reconcile SVG series nodes, debounce table search and avoid redundant dense line/area point markers without dropping samples.
- Stop an interactive HTML frame on leaving Preview/collapsing, rather than falsely describing a hidden frame as suspended. Scrolling alone does not terminate opted-in JavaScript.
- Strict build and 149 Node tests passed. Four browser suites passed 80 checks; the shared Chromium print-layout suite passed four checks. Added a three-run v0.4/v0.5 synthetic render-work comparison and actual-composited iframe background test. No live provider, native Windows/Electron/PDF.js or installer validation is claimed.


## 0.4.0 — 27 September 2026

Inline visualizations and motion.

- Render charts, tables, diagrams, HTML and existing supported document/image artifacts inside responses. Keep the workspace for explicit expansion; new workspace defaults no longer auto-open it.
- Preserve pre-tool narration; record insertion offsets and a final-round offset so the model sees each assistant round only once.
- Reconcile keyed DOM islands instead of rebuilding streamed replies or all previous turns. Keep chart selection, filters and inline HTML state stable.
- Group artifact revisions in one card; provide inline Preview/Data/Source, eight-row table paging, Collapse and keyboard tab navigation.
- Add a dark-blue visual palette, restrained entry effects, chart stroke/bar animations, live thinking waves and a streaming cursor. Support OS and in-app reduced motion.
- Add an inline demo and 15 core/service plus 20 browser layout/motion checks. Native Windows and live-provider validation remain outstanding.

## 0.3.0 — 27 September 2026

Added six model-callable visual tools: chart, table, diagram, artifact creation, immutable revision and bounded source reading. Visualization is independent of Python, with provider-call results and artifact IDs returned through the real tool loop. New conversations enable visual tools; existing workspaces migrate with them off.

Added a collapsible/expandable artifact side panel with revision selection, Preview/Source/Data, searchable and sortable table data, series visibility, local preview, explicit save/PDF export and stable state during streaming. HTML interaction is an explicit per-preview opaque sandbox; ordinary previews remain static. PDF creation uses isolated JavaScript-disabled Electron printing, and viewing uses locally packaged PDF.js pages/text/zoom. Native PDF integration is implemented but not executed in preparation.

Added provider-metadata-driven reasoning controls, narrow Tinfoil DeepSeek V4 high/max and requested Kimi K3 fixed-effort fallbacks, unknown-model defaults, model-change reset and separate comparison capabilities. Removed the old preview modal. Preserved reasoning/Markdown/LaTeX, branches, Python approvals and encrypted persistence.

Validation: 121 Node tests, 43 browser checks across two suites, and a separate four-check Chromium print-layout fixture. Live API, actual PDF.js, Electron/Windows/DPAPI and installer execution remain unverified. Native smoke and CI now require a real PDF print/view round trip.

## 0.2.0

Progressive disclosure; provider reasoning display; offline Markdown, syntax highlighting and mathematical LaTeX; reading controls; in-conversation search; explicit native Python tool loop and generated files; static previews. Tested with 79 Node tests and 22 browser checks at that revision.

## 0.1.0

Initial TypeScript/Electron client, attested Tinfoil API adapter, encrypted local workspace, streamed conversations, model comparison, branching and Windows packaging configuration. No GitHub repository was created.
