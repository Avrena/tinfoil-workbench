# Rendering design and measured work — 0.7

## Visual contract

Inline figures have no outer background, border, radius or shadow. The surrounding transcript uses neutral #1e1e1e; the sidebar is #181818. Host SVG roots contain no full-canvas background rectangle. Axes, labels, nodes and table separators are neutral greys; distinguishable plot series may use editor-syntax colors. The title and unobtrusive controls share a row. Preview/Data/Source controls remain keyboard accessible and become clearer on hover/focus.

HTML preview documents use transparent html/body and a dark root color scheme, matching the containing frame. A transparent body alone is insufficient in Chromium when the child and containing frame disagree about color-scheme; a raster assertion checks the actual composited result. Authored explicit styles remain authoritative. The PDF export path adjusts only generated SVG color attributes, not arbitrary document text or authored styles, for light paper backgrounds.

## Where work was removed

Before 0.5 the transcript reconciler preserved DOM identity, but still built a large HTML template on each update. It also passed unchanged answer segments and collapsed reasoning through Markdown/LaTeX/code rendering. The new outer reconciler treats rich-text regions as opaque islands. A WeakMap retains one previous source/options record per live island; unchanged content does not enter Markdown or template parsing at all. Opening reasoning renders its latest source, not a stale snapshot. Existing code-block indices remain tied to the preceding text.

Math and highlighted-code caches use bounded LRU eviction: math up to 128 entries, code up to 64 entries, each with a 512,000 UTF-16-character estimated key/value cost ceiling. This is a character-cost budget, not a measured heap-byte limit. Oversized entries are not retained. Caches are cleared when switching conversations. Whole rendered streaming prefixes are not accumulated in an unbounded cache.

The active changed Markdown segment is still parsed as a whole to preserve fences, tables, links and math correctness. This is not a new fully incremental Markdown parser. Cached math/code fragments reduce sub-work, while earlier text islands skip the parser entirely.

A one-shot requestAnimationFrame/timeout scheduler coalesces snapshots. Normal active text is throttled to 32 ms; text longer than 32,000 characters uses 64 ms. Urgent completion/approval/error updates bypass the delay. No perpetual idle animation-frame loop is used. The underlying data snapshot updates immediately; rendering is deferred when the document is hidden or a modal is open and catches up when available. Existing selection/scroll preservation and reduced-motion controls remain.

One shared IntersectionObserver with a 400 px preload margin defers the initial mounting of off-screen inline previews. Keyboard focus can also activate a figure. After mounting, static state is retained; this is not whole-transcript virtualization. CSS content-visibility may skip off-screen layout/paint of host visualization canvases, but is not relied on to suspend arbitrary script execution.

An inline selected revision retains at most Preview, Data and Source surfaces. Active-tab clicks do nothing expensive, and switching views preserves static filters, sort/page state and chart series choices. Selecting a different revision disposes those views. Collapsing a static figure hides rather than rebuilds it. Interactive HTML is different: leaving Preview or collapsing destroys the running frame; scrolling alone does not stop it. Hidden static views trade some bounded per-figure memory for fewer rebuilds. Very long loaded histories can still grow DOM memory.

Chart toggles reconcile keyed SVG series groups rather than replacing the SVG. Line/area plots above 80 samples omit redundant point circles, while retaining all samples in the path and preserving isolated single points. Scatter plots retain every dot. Entry animation runs once per mounted chart instead of restarting on toggles. Table filtering builds a string index on first use, debounces 70 ms, and inserts only the current page; sorting/filter selection is reused during pagination.

## Editor and responsive work in 0.6

The editor owns its textarea nodes and per-field buffers independently of incoming snapshots. Plain typing is native; character/diff/preview refresh is debounced by 140 ms. Changes uses a linear common-prefix/suffix scan and bounds the displayed changed region to 60,000 characters. Preview is capped at 200,000 characters, while source editing follows the existing prompt/reply limits. It does not build or cache every keystroke prefix.

Navigation uses a signature of project/thread metadata and search state. Completed navigation need not be regenerated on every streamed token; response text is scanned only when search is active. Visible viewport updates are coalesced with requestAnimationFrame. Charts use ResizeObserver and rebuild geometry only after a meaningful width change, preserving series selection and avoiding resize-entry animations. Printing retains the original paper geometry.

Modals use a flat scrim rather than a full-window blur. Underlying embedded frames are removed from layout while a modal is open, without destroying their browsing context; this does not suspend arbitrary opted-in scripts. A short first-paint pointer guard is separate from animations and keyboard focus. Stress runs found an intermittent Chromium hit-test issue on immediate Reading-modal reopening; see VALIDATION.md rather than treating the current mitigations as a proven universal fix.

## Spacing work in 0.7

A separate spacing layer is bundled into the existing local stylesheet; it adds no runtime dependency or second CSS request. Container queries reflow figure headers at their actual available width. There are no per-token element measurements and no per-message observers for spacing.

One ResizeObserver belongs to the composer region. It updates a CSS height variable only when the region changes and recalculates textarea size only on a width change. Draft input still sizes its textarea directly. Latest follows that height rather than a fixed bottom offset. A non-scrollable clipped outer app prevents focus restoration from moving the whole shell; transcript, tables, panels and editors remain scrollable.

Host chart rendering passes `tight:true`, reclaiming unused heading/axis-title bands without reducing the plotting rectangle. The option is ignored for headed/print exports. Heading-free diagrams receive content-sized top/bottom margins. None of this recolors authored HTML, images or documents.

## Reproducible comparison

`tests/render-cost.py` instruments in-memory copies of the supplied **0.6** preview and **0.7.0** built from this source. Each version ran three times on Linux Chromium. The fixture contains five retained Markdown/math/code sections, five charts and long collapsed reasoning, followed by 30 paced appends and a final state. Setup is excluded; the distributed preview contains no benchmark hooks.

| Work counter, median | 0.6 | 0.7 |
| --- | ---: | ---: |
| Markdown calls | 30 | 30 |
| Characters passed to Markdown | 4,395 | 4,395 |
| Repeated prefix-code lexing calls | 0 | 0 |
| Characters passed to template reconciliation | 275,176 | 275,176 |
| Template calls | 62 | 62 |
| Artifact mounts during measured updates | 0 | 0 |

The spacing changes do not increase the measured repeated-input work in this fixture. Timings are retained in `render-cost.json` but fluctuate on the shared host; no generalized speedup, GPU/power improvement, token-cost reduction or Windows benchmark is inferred. The screenshot charts contain unrelated synthetic example data.

The regression budget permits at most 10% additional Markdown input and 30% additional template input. The supplied baseline SHA-256 and individual runs are in the raw result. Historical 0.6 reports are under `history/v0.6/` and not counted as new executions.

```sh
python tests/render-cost.py --baseline /path/to/tinfoil-workbench-v0.6-preview.html --runs 3 --chromium /path/to/chromium
```

Root-owned isolated test containers may require test-only `--no-sandbox`; that is not a production Electron argument. No unbounded-history virtualization or suspension of arbitrary opted-in iframe JavaScript is claimed.

## References

Browser mechanisms used here, reviewed for this implementation:

- https://developer.mozilla.org/en-US/docs/Web/API/Window/requestAnimationFrame
- https://developer.mozilla.org/en-US/docs/Web/API/Intersection_Observer_API
- https://developer.mozilla.org/en-US/docs/Web/CSS/content-visibility
- https://developer.mozilla.org/en-US/docs/Web/CSS/contain-intrinsic-size

The performance counts describe this implementation and its fixture, not claims taken from those documents.
