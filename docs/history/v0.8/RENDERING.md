# Rendering work — 0.8

The retained response/visualization architecture and neutral seamless style are unchanged. New activity details use lazy `data-rich-host` islands: a collapsed history, batch or child never renders its JSON/output/Markdown. A WeakMap stores one signature per mounted detail host; unchanged fields skip template work. Open child reasoning shares the bounded rich-text renderer and is not generated or parsed while closed. Active approvals always materialize the exact proposed task/code. Background updates and reduced motion retain their prior behavior.

Three runs of the production-renderer fixture compare this source with the supplied 0.7 preview. The fixture contains five retained Markdown/code/math sections and charts, with long collapsed reasoning, followed by 30 paced append updates. Setup and first render are excluded. During the measured phase, both versions process 4,395 Markdown characters in 30 Markdown calls, make 62 template updates and perform zero artifact remounts. Template input is 275,176 characters in 0.7 and 186,237 in 0.8: **32.32% less template input** in this fixture. It is a work counter, not a measured 32% whole-application speedup, battery saving, token saving or network benchmark.

Per-run timings are instrumented on a shared Linux Chromium host and should not be compared as dedicated hardware benchmarks. The new child-stream fixture independently checks retained open disclosures and lazy closed output, but no claim is made about a measured Windows multi-agent workload. Source/result strings still occupy bounded conversation memory; laziness avoids rendering them, not storing them.

See `render-cost.json` for individual runs and the baseline SHA-256. Previous records remain under `history/v0.7/`. Reproduce with:

```text
python tests/render-cost.py --baseline <supplied-v0.7-preview.html> --runs 3 --chromium <chromium-path>
python tests/ui-activity.py --chromium <chromium-path>
```
