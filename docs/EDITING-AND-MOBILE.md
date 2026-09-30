# Editing, project navigation and mobile layouts

Editing has kept its semantics since 0.7, which also refined shared insets, compact control wrapping and outer-shell focus scrolling (see [SPACING.md](SPACING.md)). Since 1.2, edits make versions inside the conversation instead of new conversations in the sidebar.

## Versions inside a conversation

An edited message, Retry, and an edited answer or thinking text each make a new version of the turn where they happen. That turn and the turns after it are set aside whole, and ‹ 2/3 › arrows bring them back. Versions with the same message differ only in their replies (Retry, edited answers and thinking), so their arrows sit on the reply. Versions whose messages differ have arrows on the message, and each arrow lands on the latest answer to that message. The conversation shows one path, and only that path is sent to a model, exported as Markdown and written to a Tinfoil cloud chat; the JSON export keeps every version. A conversation keeps up to 50 versions of one point and 2,000 turns with all its versions (`src/core/versions.ts`).

Showing another version sends nothing. It waits while a reply is being written or a message is being edited, and an answer being edited with changes has to be saved or cancelled first. Branch still copies the path shown into a new conversation, without the versions set aside. Conversations branched before 1.2 stay as they are.

## Editing a draft, a message or an answer

The expand button beside the composer attachment control opens a larger source editor. Save draft returns text to the composer; it does not send.

Edit on one of your messages puts it and its attached files in the composer, marked *Editing message N*. Send makes a new version of it, answered from the turns before it; Cancel or Escape ends the edit. Either way the draft that was in the composer comes back; the edit itself is not saved as the draft, so it does not survive a restart.

Edit on a completed answer turns the answer into a field in place of its text; *Edit thinking text* in the Reasoning box turns the thinking into a field there. One is edited at a time, Save and Cancel take the place of the reply's actions, and the composer steps aside until the edit ends. The field grows with its text. Ctrl/Cmd+Enter or *Save as new version* saves; nothing is regenerated. Escape or Cancel closes at once when nothing changed and otherwise asks first. The fields keep their text across redraws and conversation switches. The new version holds only the edited reply; the answer as it was, and the turns after it, stay one arrow away. Future messages use the edited answer exactly once. Tool calls/results remain paired and their stored outputs are not editable here. Figures retain mapped insertion positions; an anchor inside replaced text follows that replacement. Heavy prose restructuring can therefore warrant a later artifact revision rather than imply semantic re-placement of every chart.

Thinking text can be edited only when the provider returned some. Its edits are local annotations, visibly distinguished from original model thinking. Original protocol reasoning attached to tool calls remains untouched, and edited thinking is not injected into future requests. This also does not alter the selected model's effort/toggle settings. The earlier version keeps the text as the model returned it. Original generation timing/usage remains historical; editing consumes no model request.

An edit is saved only if the answer still matches what was opened. A stale answer is rejected with the working copy retained. Active generation must stop first, and incomplete/stopped replies cannot be relabelled as completed merely by editing; Retry asks again instead. Unsaved edits are not kept across an application crash; the composer draft and saved versions use the encrypted workspace.

## Messages in other roles

Advanced → Editing → *Add messages in other roles*, off by default and applying to every conversation, shows a User, Assistant and System tab on the composer's top edge (drawn by Workbench, not the system's select list). With Assistant or System chosen, Send becomes Add: the message joins the conversation as written, no model is asked, and later requests send it in that role at its place in the conversation. After one is added the tab returns to User, for the question that usually follows. Such messages carry no files and can be edited in the composer like your own. Tinfoil cloud chats have no place for them, so only User can be chosen in cloud chats and in conversations that will become one (the other roles say why), and a conversation that holds them does not move to the cloud.

Workbench versions before 1.2 cannot open a workspace that holds messages in other roles, and they drop set-aside versions when they save.

## Project and thread headings

Workspace, Projects and Threads give navigation an explicit hierarchy. Use the Projects plus control to create a project. Its menu renames or removes it; its plus button starts a conversation there. Click a project heading to fold its thread group. Unfiled threads are grouped as Pinned, Today and Earlier. The active thread has a project breadcrumb, a renameable title and a link to its original thread when available.

Moving or renaming a thread does not call a model. Removing a project requires confirmation and moves its threads to Unfiled. Branches inherit project membership. These are local organizational folders, not shared instructions, cross-thread model memory, collaboration or cloud synchronization. Search also matches project names. Existing version-1 workspaces migrate with an empty project list.

## Phones and tablets

At compact widths, navigation and advanced settings are dismissible overlays; the artifact workspace can expand over the conversation and close back to it. Only one compact pane is active at a time, its background is inert and focus returns to the opening control. Closing/rotating a compact layout does not rewrite the desktop sidebar preference.

Phone editors fill the visible viewport, keep Save/Cancel separate from the scrolling text area, and retain buffers through orientation changes. The system instructions editor is a regular dialog; its actions stick to the bottom of the dialog so an on-screen keyboard never hides them. Touch Enter inserts a newline; use Send or Ctrl/Cmd+Enter to submit. IME confirmation is never send. Headers truncate long names rather than widen the page; full names remain in the rename/move controls. Wide tables scroll locally, chart geometry adapts to real width, and figure controls remain visible without hover. The host visualization background stays transparent/grey and seamless.

The standalone preview can be opened in a browser for offline demonstration; it cannot authenticate or call Tinfoil. A hosted browser distribution is not included; the separate Android app is described in [ANDROID.md](ANDROID.md) and was checked on Android emulators with real on-screen keyboards. Eight Chromium touch-emulated viewports plus simulated keyboard-height/rotation checks were executed. Physical devices, real on-screen keyboards, iOS Safari and Android Chrome need separate testing; see VALIDATION.md.

## Browser references used in implementation

- MDN VisualViewport: https://developer.mozilla.org/en-US/docs/Web/API/VisualViewport
- MDN dialog element: https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/dialog
- MDN CSS length units: https://developer.mozilla.org/en-US/docs/Web/CSS/length
- W3C target-size guidance: https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html

These describe browser mechanisms; they do not establish this application's real-device compatibility or accessibility conformance.
