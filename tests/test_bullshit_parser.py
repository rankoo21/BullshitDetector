"""Offline tests for the BullshitDetector LLM-output parser.

The parser must be tolerant of small LLM formatting drift while still
producing one of three canonical verdicts.
"""

import importlib.util
import sys
from pathlib import Path

# Load the contract module without going through the genlayer SDK -- we only
# need the pure-Python helpers below the contract class.
_CONTRACT_PATH = Path(__file__).resolve().parents[1] / "studio_contracts" / "bullshit_detector.py"


def _load_helpers():
    """Re-execute just the helper definitions, skipping the genlayer import."""
    src = _CONTRACT_PATH.read_text(encoding="utf-8")
    # Drop everything from `from genlayer import *` and below the class
    helper_src = []
    for line in src.splitlines():
        if line.startswith("from genlayer"):
            continue
        if line.startswith("class BullshitDetector"):
            break
        helper_src.append(line)
    namespace = {}
    exec("\n".join(helper_src), namespace)
    return namespace


HELPERS = _load_helpers()
parse_llm_output = HELPERS["_parse_llm_output"]
VERDICT_TRUE         = HELPERS["VERDICT_TRUE"]
VERDICT_FALSE        = HELPERS["VERDICT_FALSE"]
VERDICT_UNVERIFIABLE = HELPERS["VERDICT_UNVERIFIABLE"]


def test_clean_true_output():
    raw = (
        "VERDICT: TRUE\n"
        "CONFIDENCE: 95\n"
        "REASONING: Bitcoin's whitepaper was published in 2008.\n"
        "SOURCES: https://bitcoin.org/bitcoin.pdf"
    )
    v, c, r, s = parse_llm_output(raw)
    assert v == VERDICT_TRUE
    assert c == 95
    assert "Bitcoin" in r
    assert s.startswith("https://")


def test_clean_false_output():
    raw = (
        "VERDICT: FALSE\n"
        "CONFIDENCE: 99\n"
        "REASONING: The Earth is not flat; this is a well-established astronomical fact.\n"
        "SOURCES: none"
    )
    v, c, r, s = parse_llm_output(raw)
    assert v == VERDICT_FALSE
    assert c == 99
    assert s == "none"


def test_unverifiable_for_future_claim():
    raw = (
        "VERDICT: UNVERIFIABLE\n"
        "CONFIDENCE: 30\n"
        "REASONING: This claim concerns a future event and cannot be settled now.\n"
        "SOURCES: none"
    )
    v, c, _r, _s = parse_llm_output(raw)
    assert v == VERDICT_UNVERIFIABLE
    assert c == 30


def test_lowercase_verdict_is_normalised():
    raw = "verdict: true\nconfidence: 80\nreasoning: ok\nsources: x"
    v, _c, _r, _s = parse_llm_output(raw)
    assert v == VERDICT_TRUE


def test_unknown_verdict_falls_back_to_unverifiable():
    raw = "VERDICT: MAYBE\nCONFIDENCE: 50\nREASONING: hm\nSOURCES: none"
    v, _c, _r, _s = parse_llm_output(raw)
    assert v == VERDICT_UNVERIFIABLE


def test_confidence_clamped_to_0_100():
    over  = "VERDICT: TRUE\nCONFIDENCE: 150\nREASONING: x\nSOURCES: y"
    under = "VERDICT: FALSE\nCONFIDENCE: -5\nREASONING: x\nSOURCES: y"
    _v1, c1, _r1, _s1 = parse_llm_output(over)
    _v2, c2, _r2, _s2 = parse_llm_output(under)
    assert c1 == 100
    assert c2 == 0


def test_garbage_input_falls_back_safely():
    v, c, r, s = parse_llm_output("the model just rambled with no schema")
    assert v == VERDICT_UNVERIFIABLE
    assert c == 0
    assert r == ""
    assert s == ""


def test_extra_whitespace_and_blank_lines():
    raw = (
        "\n\n  VERDICT:   TRUE  \n"
        "\n"
        "CONFIDENCE:    72\n"
        "  REASONING:  Multiple credible sources confirm this.  \n"
        "SOURCES: https://example.org ; https://wikipedia.org\n"
    )
    v, c, r, s = parse_llm_output(raw)
    assert v == VERDICT_TRUE
    assert c == 72
    assert "credible" in r
    assert "wikipedia" in s
