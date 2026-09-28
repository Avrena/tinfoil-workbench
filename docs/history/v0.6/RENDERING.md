# Rendering design and measured work — 0.6

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

## Reproducible comparison

`tests/render-cost.py` instruments in-memory copies of the authentic supplied **0.5** preview and the **0.6.0** preview built from this source. The distributed preview contains no benchmark hook. Each version ran three times on Linux Chromium. The fixture contains five retained Markdown/math/code sections, five charts and long collapsed reasoning, then 30 paced appends and a final state. Setup is excluded.

| Work counter, median | 0.5 | 0.6 |
| --- | ---: | ---: |
| Markdown calls | 30 | 30 |
| Characters passed to Markdown | 4,395 | 4,395 |
| Repeated prefix-code lexing calls | 0 | 0 |
| Characters passed to template reconciliation | 274,474 | 275,176 |
| Template calls | 62 | 62 |
| Artifact mounts during measured updates | 0 | 0 |

The new editing/header controls add 702 template characters across this fixture, or **0.26%**, while retaining the previous Markdown optimization. This revision does not claim another large rendering speedup. Timings are included in raw runs but fluctuate on the shared host; counters are more useful here. This is not Windows CPU/GPU/power measurement, token billing, API latency or a whole-app performance guarantee. The chart in the UI screenshots contains unrelated, explicitly synthetic example values.

The current regression budget permits at most 10% additional Markdown input and 30% additional template input; the previous version's 0.4-to-0.5 improvement thresholds are not reused as if they applied to this release. Baseline SHA-256 and individual runs are retained in `render-cost.json`.

```sh
python tests/render-cost.py --baseline /path/to/tinfoil-workbench-v0.5-preview.html --runs 3 --chromium /path/to/chromium
```

The root-owned test container uses test-only Chromium sandbox flags. They are not production Electron arguments. No unbounded-history virtualization or guaranteed suspension of iframe JavaScript is claimed.

## References

Browser mechanisms used here, reviewed for this implementation:

- https://developer.mozilla.org/en-US/docs/Web/API/Window/requestAnimationFrame
- https://developer.mozilla.org/en-US/docs/Web/API/Intersection_Observer_API
- https://developer.mozilla.org/en-US/docs/Web/CSS/content-visibility
- https://developer.mozilla.org/en-US/docs/Web/CSS/contain-intrinsic-size

The performance counts describe this implementation and its fixture, not claims taken from those documents.
