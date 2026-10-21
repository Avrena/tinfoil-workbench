"""Pure server settings contract; no SSH, credentials, containers or provider calls."""
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "remote"))
from settings import job_settings, same_submission


class SettingsTests(unittest.TestCase):
    def test_old_jobs_use_defaults(self):
        self.assertEqual(job_settings({}), dict(systemPrompt="", systemPromptName="", temperature=None,
                         reasoningEffort="default", thinkingMode="default", maxRounds=20, maxCalls=40, maxTokens=4096, maxSeconds=1800))

    def test_preserves_instructions_and_only_whitelists_settings(self):
        value = job_settings(dict(systemPrompt="  Exact\ntext  ", systemPromptName="Preset", temperature=0,
                                  reasoningEffort="high", thinkingMode="disabled", session="not-display", messages=[]))
        self.assertEqual(value["systemPrompt"], "  Exact\ntext  ")
        self.assertNotIn("session", value)
        self.assertNotIn("messages", value)
        self.assertEqual(job_settings(dict(systemPrompt="  ", systemPromptName="Unused"))["systemPromptName"], "")

    def test_invalid_numeric_and_enum_values_fail(self):
        for value in [True, "1", -0.01, 2.01, float("nan"), float("inf")]:
            with self.subTest(temperature=value), self.assertRaises(ValueError):
                job_settings(dict(temperature=value))
        for key in ("maxRounds", "maxCalls", "maxTokens", "maxSeconds"):
            for value in (True, 0, 1.5, 1000000):
                with self.subTest(key=key, value=value), self.assertRaises(ValueError):
                    job_settings({key: value})
        for key, value in [("reasoningEffort", "automatic"), ("reasoningEffort", None), ("thinkingMode", True),
                           ("systemPrompt", None), ("systemPromptName", "two\nlines")]:
            with self.subTest(key=key, value=value), self.assertRaises(ValueError):
                job_settings({key: value})

    def test_utf16_limit_matches_desktop(self):
        job_settings(dict(systemPrompt="😀" * 20000))
        with self.assertRaises(ValueError):
            job_settings(dict(systemPrompt="😀" * 20001))

    def test_request_id_binds_settings_and_resource_limits(self):
        previous = dict(workspace="a" * 32, model="test-model", prompt="Exact task", policy="workspace-auto",
                        systemPrompt="Exact instructions", temperature=0.5)
        self.assertTrue(same_submission(previous, previous.copy()))
        for key, value in [("systemPrompt", "Other"), ("temperature", 0.7), ("maxTokens", 100),
                           ("model", "other-model"), ("policy", "other"), ("prompt", "Other task")]:
            with self.subTest(key=key):
                self.assertFalse(same_submission(previous, dict(previous, **{key: value})))


if __name__ == "__main__":
    unittest.main()
