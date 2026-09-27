"""Spec 15: every error the gateway raises uses one of the contract's error codes."""
import re
from pathlib import Path
from typing import get_args

from app.errors import STATUS
from asclep_contracts.common import ErrorCode

APP = Path(__file__).resolve().parents[1] / "app"


def test_status_table_is_exactly_the_spec_codes():
    assert set(STATUS) == set(get_args(ErrorCode))


def test_every_raised_code_is_a_spec_code():
    used = {m for f in APP.rglob("*.py") for m in re.findall(r'AsclepError\(\s*"([A-Z_]+)"', f.read_text())}
    assert used and used <= set(get_args(ErrorCode)), used - set(get_args(ErrorCode))
