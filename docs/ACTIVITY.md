# Tool activity, MCP and delegation

## Supported paths and precise boundaries

A batch in this client is **multiple function calls returned in the same Chat Completions tool round**. The service registers every call before execution, assigns a stable batch identity and order, and runs the queue sequentially. A batched provider response is not evidence that execution was parallel. The UI distinguishes queued, approval-needed, running, done, failed, declined and cancelled. Every result remains paired to its original tool-call ID. This does not implement a billed, asynchronous Batch jobs endpoint, parallel scheduling, or bulk thread operations.

Tinfoil's published router source supports opt-in tool progress inside normal content deltas. The client supplies `X-Tinfoil-Events: web_search,code_execution` on main Chat Completions requests, parses `tinfoil.web_search_call` and `tinfoil.tool_call` markers across arbitrary chunk boundaries, and records bounded provider-reported activity. The adapter does not depend on a new Responses endpoint or a guessed MCP wire field. Sources, arguments and output remain inspectable. A provider event **never** triggers local Python, an extra inference call, file access or another approval. This is passive rendering, not a new attestation of the remote tool implementation; model-generated lookalike markers cannot authorize an action.

Optional Tinfoil web search is exposed in Advanced and sends `web_search_options: {}` only after it is enabled and saved. It remains off in new and migrated conversations. Search entitlement/availability and any additional charges depend on the provider. Event subscription alone does not enable search or code execution. Although the parser understands hosted code-execution events, this version does not provision Tinfoil Chat code-execution containers or their required session credentials. Existing approved local Python is unchanged and is labelled separately.

This client does not register arbitrary MCP servers, launch stdio servers, store MCP OAuth sessions, connect to a user-supplied remote MCP URL, or advertise remote servers' tool catalogues. Those require a separate connection and authorization design. “Tinfoil-managed MCP” describes the provider-reported built-in tool family, not a general MCP connector.

Native hosted sub-agent events were **not verified** in the inspected Chat API source. The implemented substitute is an optional client-side `delegate_task` function. It is advertised to eligible models only when Text-only sub-agents is explicitly set to Ask before each request. No native agent events, API fields or background completion channels are invented.

## Delegated request lifecycle

The model supplies one self-contained `task`, at most 16,000 characters. The exact proposal appears inline for approval. The desktop then requires a second native confirmation of the pending task and selected model before inference begins, and rechecks that the pending proposal is still current. There is no approve-all, persistent trust or unattended mode. Declining does not send a child request; the parent receives a matched declined result.

An approved child uses the same verified Tinfoil SDK client and the same model as its parent lane. It receives a fixed text-only worker instruction and the proposed task, **not an automatic copy of the conversation, the parent's system prompt, attachments or tool history**. The proposing model can explicitly include excerpts in its task; approval is the place to inspect those excerpts. No API keys are inserted in the task. The child receives no tools, web-search enablement or delegation function. Unexpected child tool calls are rejected and the stream is aborted; no recursive or native action follows.

The hard limit is two approved child requests per user send, shared by comparison lanes. A child consumes one request, with no automatic retry, at most the smaller of the parent's output limit and 4,096 output tokens, a 120-second total deadline and a 90-second inactivity deadline. Local returned text/reasoning limits bound retained output. Each child applies the same model-specific thinking parameters as its parent lane. The main response's four-round/eight-call tool budget remains in force.

Returned child reasoning and the child answer stream separately. Usage, when supplied by the provider, is displayed and exported as **delegate-only** usage, not silently folded into the main model token count. A child answer is returned as the original function call's tool result; raw child reasoning is retained locally for inspection but is not inserted in that result. The parent can then summarize the finding. This is a text-analysis worker, not a research agent with its own tools.

Stop sub-agent cancels that child and returns its partial/failed result to the parent so it can continue. The main Stop cancels the parent and its active child. Pending proposals and queued actions cannot resume automatically on restart/import. Cancellation asks the transport to stop; it does not certify that all remote billable work was prevented. A missing completion marker, output-limit finish or rejected tool call is not labelled successful.

## Layout and rendering

A reply's tool calls fold into one row in the same contextual region as reasoning. While the reply runs, the row names the call in progress and each new call rolls into it over the last; when it ends, the row says what was done. Opened, it lists every call in order, a batch's calls under one heading, each call one line that opens its details. Active protected proposals and a running sub-agent stay in full view below the row, even when reasoning is hidden. Sub-agent output has its own task/live-response disclosure, Markdown/math rendering and a separately folded returned-reasoning section. Provider sources use the existing explicit external-URL path. Everything retains the neutral, transparent/grey layout; status color is a small accent, not a navy card.

Closed detail islands do not parse argument JSON, build output DOM or render child Markdown. Weakly held per-host signatures skip unchanged details; existing rich-text caches handle opened content. Open disclosures remain open during streamed child updates. Reduced motion disables the running-dot animation and the row's roll. Phone actions wrap and retain touch sizing rather than squeezing a full desktop activity dashboard into the transcript.

Use the offline preview's **Tool activity** starter, then Send, for a labelled synthetic sequence. It demonstrates a provider event, a queued batch, an inline chart and child output. It never calls the API, connects to an MCP server or runs a real delegate. The native execution refusal remains explicit.

## Sources inspected

Checked 28 September 2026 using the connected GitHub source. Search results referenced router commit `9716d140dc70aa6aa2b10ff1a21defbe4d23d442`; fetched main-branch content is mutable. These establish implementation interfaces, not a live entitlement or tested account connection.

- Router events, header and marker payloads: https://github.com/tinfoilsh/confidential-model-router/blob/main/toolruntime/events.go
- Parallel-tool-call policy (multiple client-owned calls): https://github.com/tinfoilsh/confidential-model-router/blob/main/toolruntime/tool_loop.go
- Built-in MCP families: https://github.com/tinfoilsh/confidential-model-router/blob/main/local_testing.md and https://github.com/tinfoilsh/confidential-model-router/blob/main/toolruntime/profile.go
- Tinfoil-specific options: https://github.com/tinfoilsh/confidential-model-router/blob/main/toolruntime/options.go
- Hosted search implementation: https://github.com/tinfoilsh/confidential-websearch
- Verified JavaScript client: https://github.com/tinfoilsh/tinfoil-js

Neither `subagent` nor `sub_agent` searches in the inspected webapp/router returned a native event interface. This is why client orchestration is explicit; it is not a blanket claim that the provider can never support native agents.

API-key authentication remains unchanged. Tinfoil Chat subscription sessions and browser authentication are not implemented or substituted in this revision.
