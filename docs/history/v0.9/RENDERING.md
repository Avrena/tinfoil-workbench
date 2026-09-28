# Rendering work — 0.9

The new Account view uses the existing retained DOM reconciliation. Its body is built only while the panel is open; unchanged identity/status data skips DOM-template processing. The small sidebar identity entry has its own cached signature. Updates preserve opened usage details, while unrelated transcript work still pauses during a modal and resumes through the bounded scheduler. No remote avatar request is added.

Three runs compare the production preview with the supplied authentic 0.8 HTML. The fixture includes five retained Markdown/code/math sections and charts, long collapsed reasoning and 30 paced append updates. Initial render/setup are excluded. Both versions process exactly **4,395 Markdown characters in 30 calls**, **186,237 template-input characters in 62 updates**, and **zero artifact remounts** in the measured phase. New account chrome therefore did not increase these counters for that specific closed-account streaming fixture.

This does not measure actual account login, the isolated website window's resource usage, account-open work, whole-application speed, power, API latency or billing. A signed-in hidden website page retains its ordinary browser/network overhead. Function timing on a shared Linux Chromium host is illustrative rather than a controlled hardware comparison. No claim of zero extra account-feature memory cost is made.

See render-cost.json for per-run measurements and the authentic baseline SHA-256. Historical rendering notes remain under history/v0.8/.

```text
python tests/render-cost.py --baseline <supplied-v0.8-preview.html> --runs 3 --chromium <chromium-path>
python tests/ui-account.py --chromium <chromium-path>
```
