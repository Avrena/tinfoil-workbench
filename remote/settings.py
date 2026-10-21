"""Bounded, data-only job settings shared by submission and retained-job views."""
import math


def bounded_text(value, name, maximum):
    if not isinstance(value, str) or len(value.encode("utf-16-le", errors="surrogatepass")) // 2 > maximum:
        raise ValueError(name + " exceeds its limit or is not text.")
    return value


def job_settings(request):
    instructions = bounded_text(request.get("systemPrompt", ""), "System instructions", 40000)
    name = bounded_text(request.get("systemPromptName", ""), "Instructions name", 80).strip()
    if any(ord(char) < 32 or ord(char) == 127 for char in name):
        raise ValueError("Instructions name must be on one line.")
    temperature = request.get("temperature")
    if temperature is not None and (type(temperature) not in (int, float) or not math.isfinite(temperature) or not 0 <= temperature <= 2):
        raise ValueError("Temperature must be between 0 and 2, or null for provider default.")
    effort = request.get("reasoningEffort", "default")
    thinking = request.get("thinkingMode", "default")
    if effort not in ("default", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"):
        raise ValueError("Invalid reasoning effort.")
    if thinking not in ("default", "enabled", "disabled"):
        raise ValueError("Invalid thinking mode.")
    result = {"systemPrompt": instructions, "systemPromptName": name if instructions.strip() else "",
              "temperature": temperature, "reasoningEffort": effort, "thinkingMode": thinking}
    for key, default, maximum in [("maxRounds", 20, 30), ("maxCalls", 40, 60), ("maxTokens", 4096, 16384), ("maxSeconds", 1800, 3600)]:
        value = request.get(key, default)
        if type(value) is not int or not 1 <= value <= maximum:
            raise ValueError(key + " exceeds its limit.")
        result[key] = value
    return result


def same_submission(previous, request):
    """A reused request id can only acknowledge the same captured job, never rerun it."""
    return (previous["workspace"] == request.get("workspace")
            and previous["prompt"] == request.get("prompt")
            and request.get("policy") == previous.get("policy") == "workspace-auto"
            and request.get("model", "default") in (None, "default", previous["model"])
            and job_settings(previous) == job_settings(request))
