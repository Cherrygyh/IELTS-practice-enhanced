import importlib.util
import unittest
from pathlib import Path


TOOL_PATH = Path(__file__).resolve().parents[3] / "developer/tests/tools/listeningpractice/transcribe_local_audio.py"
spec = importlib.util.spec_from_file_location("transcribe_local_audio", TOOL_PATH)
tool = importlib.util.module_from_spec(spec)
spec.loader.exec_module(tool)


class ListeningTranscriptBoundsTest(unittest.TestCase):
    def test_last_window_keeps_speech_but_never_exceeds_audio(self):
        segments = tool.bounded_segments([
            {"start": 416.58, "end": 421.18, "text": "  Final question.  "},
            {"start": 440.36, "end": 470.34, "text": "Thank you."},
        ], 469.58)
        self.assertEqual(segments[0], {"start": 416.58, "end": 421.18, "text": "Final question."})
        self.assertEqual(segments[1], {"start": 440.36, "end": 469.58, "text": "Thank you."})

    def test_window_outside_audio_is_omitted(self):
        self.assertEqual(tool.bounded_segments([
            {"start": 30, "end": 59.98, "text": "Thank you."},
        ], 29.9), [])

    def test_subcentisecond_duration_does_not_round_past_end(self):
        self.assertEqual(tool.bounded_segments([
            {"start": 0, "end": 1.24, "text": "Speech."},
            {"start": 0.5, "end": 0.5, "text": "Empty range."},
            {"start": 0, "end": 1, "text": "  "},
        ], 1.235), [{"start": 0.0, "end": 1.235, "text": "Speech."}])


if __name__ == "__main__":
    unittest.main()
