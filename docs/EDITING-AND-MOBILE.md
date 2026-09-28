# Editing, project navigation and mobile layouts — 0.7

Version 0.7 retains these editing semantics and refines shared insets, compact control wrapping and outer-shell focus scrolling. See [SPACING.md](SPACING.md).

## Editing a draft, earlier prompt or response

The expand button beside the composer attachment control opens a larger source editor. Save draft returns text to the composer; it does not send. An earlier user message's Edit action instead creates a branch before that turn with the revised prompt as an unsent draft. Attached text files are retained in that session, not silently submitted. Pending attachments are still session-only and should be rechecked after restarting.

A completed assistant message has Edit beside its reply actions. Write edits the source, Preview renders safe Markdown and mathematical LaTeX, and Changes shows the changed region. Answer and Thinking keep separate buffers when switching tabs. Formatting buttons insert bold, fenced code and display-math syntax; Ctrl/Cmd+Z uses the textarea's native undo history. Ctrl/Cmd+Enter saves, never regenerates. Escape/Cancel offers Keep editing or Discard changes when there are unsaved edits.

Save new branch retains the original thread and its later turns, creates a new thread through the chosen response, and marks the revised response. Future messages in that branch use the edited answer exactly once. Tool calls/results remain paired and their stored outputs are not editable here. Figures retain mapped insertion positions; an anchor inside replaced text follows that replacement. Heavy prose restructuring can therefore warrant a later artifact revision rather than imply semantic re-placement of every chart.

The Thinking tab is available only for reasoning actually returned by the provider. Its edits are local annotations, visibly distinguished from original model thinking. Original protocol reasoning attached to tool calls remains untouched, and edited thinking is not injected into future requests. This also does not alter the selected model's effort/toggle settings. Restore original recovers the earliest saved text. Original generation timing/usage remains historical; editing consumes no model request.

An edit is saved only if the source still matches what was opened. A stale response is rejected with the working copy retained. Active generation must stop first, and incomplete/stopped replies cannot be relabelled as completed merely by editing. This version does not autosave an open modal's unsaved buffers across an application crash; the composer draft and explicitly saved branches use the existing encrypted workspace.

## Project and thread headings

Workspace, Projects and Threads give navigation an explicit hierarchy. Use the Projects plus control to create a project. Its menu renames or removes it; its plus button starts a conversation there. Click a project heading to fold its thread group. Unfiled threads are grouped as Pinned, Today and Earlier. The active thread has a project breadcrumb, a renameable title and a link to its original thread when available.

Moving or renaming a thread does not call a model. Removing a project requires confirmation and moves its threads to Unfiled. Branches inherit project membership. These are local organizational folders, not shared instructions, cross-thread model memory, collaboration or cloud synchronization. Search also matches project names. Existing version-1 workspaces migrate with an empty project list.

## Phones and tablets

At compact widths, navigation and advanced settings are dismissible overlays; the artifact workspace can expand over the conversation and close back to it. Only one compact pane is active at a time, its background is inert and focus returns to the opening control. Closing/rotating a compact layout does not rewrite the desktop sidebar preference.

Phone editors fill the visible viewport, keep Save/Cancel separate from the scrolling text area, and retain buffers through orientation changes. Touch Enter inserts a newline; use Send or Ctrl/Cmd+Enter to submit. IME confirmation is never send. Headers truncate long names rather than widen the page; full names remain in the rename/move controls. Wide tables scroll locally, chart geometry adapts to real width, and figure controls remain visible without hover. The host visualization background stays transparent/grey and seamless.

The standalone preview can be opened in a browser for offline demonstration; it cannot authenticate or call Tinfoil. A hosted browser distribution is not included; the separate Android app is described in [ANDROID.md](ANDROID.md) and was checked on Android emulators with real on-screen keyboards. Eight Chromium touch-emulated viewports plus simulated keyboard-height/rotation checks were executed. Physical devices, real on-screen keyboards, iOS Safari and Android Chrome need separate testing; see VALIDATION.md.

## Browser references used in implementation

- MDN VisualViewport: https://developer.mozilla.org/en-US/docs/Web/API/VisualViewport
- MDN dialog element: https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/dialog
- MDN CSS length units: https://developer.mozilla.org/en-US/docs/Web/CSS/length
- W3C target-size guidance: https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html

These describe browser mechanisms; they do not establish this application's real-device compatibility or accessibility conformance.
