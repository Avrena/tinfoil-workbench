"""Read-only transcript projection checks; no SSH, provider, or container calls."""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "remote"))
from display import transcript_view


def assistant(content, call=None, reasoning=""):
    return {"role": "assistant", "content": content, "reasoning_content": reasoning,
            "tool_calls": [{"id": call, "function": {"name": "run_command"}}] if call else []}


class TranscriptTest(unittest.TestCase):
    def test_order_and_no_protocol_or_system_exposure(self):
        state = {"messages": [{"role": "system", "content": "PRIVATE GUIDE"},
                              {"role": "user", "content": "Task"},
                              assistant("Checking.", "call-1", "Reasoning."),
                              {"role": "tool", "content": "RAW PROTOCOL"}],
                 "content": "Checking.\n\n**Done.**", "reasoning": "Reasoning.Final thinking.", "rounds": 2}
        entries, clipped = transcript_view(state, [{"id": "call-1", "name": "run_command"}])
        self.assertEqual([e["role"] for e in entries], ["assistant", "tool", "assistant"])
        self.assertEqual(entries[-1]["content"], "**Done.**")
        self.assertEqual(entries[-1]["reasoning"], "Final thinking.")
        self.assertNotIn("PRIVATE GUIDE", str(entries))
        self.assertNotIn("RAW PROTOCOL", str(entries))
        self.assertFalse(clipped)

    def test_running_tool_precedes_its_protocol_result(self):
        state = {"messages": [assistant("Checking.", "call-1")], "content": "Checking.", "rounds": 1}
        entries, _ = transcript_view(state, [{"id": "call-1", "name": "run_command", "status": "running"}])
        self.assertEqual(entries[-1], {"id": "tool-0", "role": "tool", "tool": 0})

    def test_repeated_call_ids_are_matched_by_occurrence(self):
        state = {"messages": [assistant("First", "same"), assistant("Second", "same")],
                 "content": "First\n\nSecond\n\nDone", "rounds": 3}
        entries, _ = transcript_view(state, [{"id": "same", "name": "run_command"}] * 2)
        self.assertEqual([e["tool"] for e in entries if e["role"] == "tool"], [0, 1])
        self.assertEqual(len({e["id"] for e in entries}), len(entries))

    def test_partial_has_same_id_after_completion(self):
        state = {"messages": [assistant("Before", "call-1")], "content": "Before", "rounds": 1,
                 "partial": {"content": "A partial", "reasoning": "Thinking"}}
        tools = [{"id": "call-1", "name": "run_command"}]
        partial, _ = transcript_view(state, tools)
        del state["partial"]
        state.update(content="Before\n\nA partial answer", reasoning="Thinking", rounds=2)
        complete, _ = transcript_view(state, tools)
        self.assertEqual(partial[-1]["id"], complete[-1]["id"])
        self.assertTrue(partial[-1]["partial"])
        self.assertNotIn("partial", complete[-1])

    def test_stopped_partial_is_retained(self):
        entries, _ = transcript_view({"status": "stopped", "partial": {"content": "Unfinished"}}, [])
        self.assertEqual(entries[0]["content"], "Unfinished")
        self.assertTrue(entries[0]["partial"])

    def test_empty_round_does_not_create_duplicate_tail(self):
        state = {"messages": [assistant("Before", "a"), assistant("", "b")],
                 "content": "Before\n\n\n\nFinal", "rounds": 3}
        entries, _ = transcript_view(state, [{"id": x, "name": "run_command"} for x in ["a", "b"]])
        self.assertEqual([e["content"] for e in entries if e["role"] == "assistant"], ["Before", "", "Final"])

    def test_inconsistent_history_uses_explicit_unordered_fallback(self):
        self.assertIsNone(transcript_view({"messages": [assistant("Not a prefix")], "content": "Different"}, [])[0])
        self.assertIsNone(transcript_view({"content": "Old combined output"}, [{"id": "a", "name": "run_command"}])[0])
        state = {"messages": [assistant("Check", "a")], "content": "Check"}
        self.assertIsNone(transcript_view(state, [{"id": "b", "name": "run_command"}])[0])

    def test_display_bounds_match_javascript_utf16_without_splitting_surrogates(self):
        state = {"content": "😀" * 60000, "reasoning": "考" * 70000, "rounds": 1}
        entries, clipped = transcript_view(state, [])
        self.assertTrue(clipped)
        self.assertEqual(len(entries[0]["content"].encode("utf-16-le")) // 2, 100000)
        self.assertEqual(len(entries[0]["reasoning"]), 60000)

    def test_global_budget_and_empty_authenticating_state(self):
        entries, clipped = transcript_view({"status": "authenticating"}, [])
        self.assertEqual(entries, [])
        self.assertFalse(clipped)
        state = {"content": "a" * 100000, "reasoning": "b" * 60000,
                 "partial": {"content": "c" * 10}, "rounds": 1}
        entries, clipped = transcript_view(state, [])
        self.assertTrue(clipped)
        self.assertEqual(entries[-1]["content"], "")


if __name__ == "__main__":
    unittest.main()
