"""Read-only display projection of retained worker records. No provider or tool calls."""


def transcript_view(state, tools):
    """Recover actual round/tool order without exposing system or raw protocol messages.

    The worker retains every tool-bearing assistant message, then appends the final
    reply to its aggregate content. A current tool can precede its protocol result.
    Match tool occurrences in order (call IDs can repeat across rounds), and only
    use the aggregate tail after verifying its exact retained prefix. Inconsistent
    older records fall back to the unordered view instead of inventing chronology.
    """
    messages = state.get("messages", [])
    if not isinstance(messages, list):
        return None, False
    entries, content_prefix, reasoning_prefix = [], "", ""
    tool_index = round_index = 0
    for message in messages:
        if not isinstance(message, dict) or message.get("role") != "assistant":
            continue
        content = message.get("content") or ""
        reasoning = message.get("reasoning_content") or ""
        if not isinstance(content, str) or not isinstance(reasoning, str):
            return None, False
        content_prefix += ("\n\n" if content_prefix else "") + content
        reasoning_prefix += reasoning
        entries.append({"id": f"assistant-{round_index}", "role": "assistant", "content": content, "reasoning": reasoning})
        round_index += 1
        for call in message.get("tool_calls", []):
            if tool_index >= len(tools):
                break  # The worker has not started the remaining calls yet.
            tool = tools[tool_index]
            if call.get("id") != tool.get("id") or call.get("function", {}).get("name") != tool.get("name"):
                return None, False
            entries.append({"id": f"tool-{tool_index}", "role": "tool", "tool": tool_index})
            tool_index += 1
    if tool_index != len(tools):
        return None, False
    content, reasoning = state.get("content") or "", state.get("reasoning") or ""
    if not content.startswith(content_prefix) or not reasoning.startswith(reasoning_prefix):
        return None, False
    tail, thinking = content[len(content_prefix):], reasoning[len(reasoning_prefix):]
    if content_prefix and tail.startswith("\n\n"):
        tail = tail[2:]
    if tail or thinking or state.get("rounds", 0) > round_index:
        entries.append({"id": f"assistant-{round_index}", "role": "assistant", "content": tail, "reasoning": thinking})
        round_index += 1
    partial = state.get("partial")
    if isinstance(partial, dict):
        entries.append({"id": f"assistant-{round_index}", "role": "assistant", "content": partial.get("content") or "", "reasoning": partial.get("reasoning") or "", "partial": True})
    if len(entries) > 100:
        return None, True
    # Bound the whole transcript, not just each round. Keep stable IDs/positions
    # even when later text is clipped, and let the UI disclose that truncation.
    budget, truncated = 160000, False
    for entry in entries:
        if entry["role"] != "assistant":
            continue
        for key, cap in [("content", 100000), ("reasoning", 60000)]:
            value = entry[key].encode("utf-16-le")
            limit = min(cap, budget)
            truncated |= len(value) // 2 > limit
            entry[key] = value[:limit * 2].decode("utf-16-le", errors="ignore")
            budget -= len(entry[key].encode("utf-16-le")) // 2
    return entries, truncated
