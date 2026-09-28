# Rendering work — 0.10

Three runs compare the current production preview with the authentic supplied 0.9 HTML. The fixture contains five retained Markdown/code/math sections and charts, long collapsed reasoning, and 30 paced append updates. Setup is excluded. Both versions process exactly 4,395 Markdown characters in 30 calls and 186,237 template-input characters in 62 updates, with zero artifact remounts during the measured phase.

Draft/Advanced recovery and close review therefore did not increase these counters in this particular normal-streaming fixture. Pending configuration controls are hidden when unused. No claim is made about whole-application speed, account-window memory, close-time serialization, initial startup, GPU power, actual inference latency or billing. Shared-host function timings in render-cost.json are illustrative, not controlled hardware performance evidence.

Native rendering uses a different Chromium version from the Linux test browser. Validate the installed pinned Electron build, display scaling and real-device effects separately. The inherited intermittent rapid control hit-test issue remains a local stress check even though 12 cycles with 24 real non-forced checkbox clicks passed in the handoff suite.

Reproduce after rebuilding preview:

```text
python tests/render-cost.py --baseline <supplied-v0.9-preview.html> --runs 3 --chromium <path>
```

The raw report contains the baseline SHA-256 and each run’s counters. Existing renderer architecture and historical optimization reports remain under history/.
