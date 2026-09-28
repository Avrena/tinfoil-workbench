# Spacing and responsive geometry — 0.7

This revision changes layout and component spacing, not conversation semantics, model capabilities, tool permissions or theme colors.

## Reading flow

Prose, inline figures and the composer use one 800px maximum reading column. Both scroll/composer regions reserve the same scrollbar gutters. Measured left-edge and width differences were zero in the nine-size spacing matrix. Desktop gutters are 32px, medium/tablet gutters 24px, phone gutters 16px, and the narrowest tested screens use 12px.

Spacing tokens follow a 4px scale, with 8/12px gaps inside control groups, 16/20/24px between related blocks, and 28/32px between conversation turns. This is not uniform padding on every element. A two-line project/thread header stays grouped rather than allocating a full control row to each text line. Sidebar search content has a real inner inset; project actions and nested threads align.

Visualization surfaces remain transparent/neutral and borderless. At narrow container widths, title/revision/expand controls occupy the first row and view/actions the next. This also works when a desktop window is wide but the chat is narrowed by the artifact workspace. Controls do not depend on a phone-specific viewport breakpoint alone.

The chart host removes empty heading/axis-title bands but preserves the data plotting height and actual values. An x-axis title retains its line. Headed and print chart outputs remain identical with or without the new tight flag in unit fixtures. Unheaded diagrams no longer reserve a blank title region and an unnecessary trailing row. User-authored HTML, PDFs and images are not restyled.

## Composer, editing and focus

An empty composer uses a 48px text field and grows with multiline content. The measured empty composer shell was 94px in mouse-mode desktop contexts and 102–106px in the tested touch contexts. These are component heights, not the whole bottom region. The latter also holds margins and shortcut text. Narrow control groups wrap within their container; a compact “Default” effort label maps to the unchanged `default` wire value.

One composer-region ResizeObserver updates the occupied height and reacts to width changes. The Latest button stays 12px above that region, including when a long draft or wrapped controls make it taller. No per-message observers or new per-token markup passes are introduced.

Editor heading, tabs, toolbar, note, field and footer use a shared inset: 24px on larger layouts and 16px on phones. The field and footer remain independently laid out; narrow action groups can wrap instead of overlapping status text. The original edit/branch/annotation behavior is unchanged.

A spacing test found that focus restoration after a compact drawer could scroll `#app` by 10–40px even though the document itself had not scrolled. This hid part of the title bar and left a blank strip below the status bar. The outer app now uses `overflow: clip` instead of becoming a programmatically scrollable container. Its internal transcript, editor and panel scroll regions are unchanged. The regression asserts both document and app scroll positions after drawer/editor transitions.

## Test coverage

`tests/ui-spacing.py` runs 103 checks across 1440×1000, 1280×800, 820×1180, 768×1024, 1024×768, 390×844, 320×740, 360×800 and 430×932 viewports. It checks column alignment, bounded headers, message-group spacing, compact composers, multiline growth, dynamic Latest positioning, effort/Stop/Send collisions, editor insets, panel wrapping and app-shell focus scrolling. Additional cases cover a desktop split view, a 390×420 height simulation, and 844×390 rotation.

This is Chromium viewport/touch emulation on Linux, not physical phone/tablet, Safari, Android Chrome, native Windows or real on-screen-keyboard testing. It does not establish formal accessibility conformance. Compact secondary controls are smaller than primary touch controls.

Five new Node tests cover tight chart geometry, retained x-axis-title space, identical headed/print chart output and compact diagram margins. Existing editing, service, tool, renderer and responsive suites are rerun separately. See VALIDATION.md for counts and test-run qualifications.

## Development

Edit `src/renderer/spacing.css`. The build appends it to `dist/style.css`, keeping one local stylesheet request. Build and test commands:

```text
npm run preview:build
npm test
python tests/ui-spacing.py --chromium /path/to/chromium
```

The Python UI test requires Playwright and a Chromium executable. In a root-owned isolated test container, add `--no-sandbox` to the test command only. Run the other six UI suites for changes to shared layout. Test the native Windows path separately before release.
