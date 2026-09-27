"""Claude for the report and Ask jobs (spec 6, 10.4). Frames and audio never come here: LiveScribing stays local.

SPEC-QUESTION(Ron): spec 10.4 says Mellea -> LiteLLM -> Claude. This uses the spec's own fallback instead:
direct Claude calls with Pydantic-validated output and a hand-written 3-attempt loop running the same
requirement checks (app/validate.py). Contracts are unchanged.
"""
import os
from functools import lru_cache

# RESIDENT_LLM_MOCK switches report + Ask separately from LiveScribing (which RESIDENT_MOCK also drives).
MOCK = os.getenv("RESIDENT_LLM_MOCK", os.getenv("RESIDENT_MOCK", "1")) == "1"
MODEL = os.getenv("RESIDENT_MODEL", "claude-sonnet-5")  # spec 6. Sonnet 5 rejects temperature: steer by prompt
LOOP_BUDGET = 3  # spec 10.4


@lru_cache
def client():
    import anthropic  # lazy: CI runs the mocked Resident without the SDK installed

    return anthropic.Anthropic()
