# v0.2.16
# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }
"""BullshitDetector - on-chain claim verification.

A user submits a claim (text or URL). Five validator LLMs independently
fact-check it, agree on a VERDICT (TRUE / FALSE / UNVERIFIABLE) plus a
confidence score, and the result is committed to chain forever.

This is the pattern that only GenLayer can support: validators reaching
consensus on the *judgement of an LLM*, not on a deterministic byte sequence.

Storage of history is intentionally minimal (last claim + counters).
Front-ends paginate by indexing events off-chain.
"""

from genlayer import *


# --------------------------------------------------------------------------- #
# Verdicts                                                                    #
# --------------------------------------------------------------------------- #

VERDICT_TRUE          = "TRUE"
VERDICT_FALSE         = "FALSE"
VERDICT_UNVERIFIABLE  = "UNVERIFIABLE"
_ALLOWED_VERDICTS     = (VERDICT_TRUE, VERDICT_FALSE, VERDICT_UNVERIFIABLE)

# Free-text result schema the LLM must follow.
_OUTPUT_FORMAT = (
    "Reply with EXACTLY four lines, in this order, no preamble:\n"
    "VERDICT: TRUE | FALSE | UNVERIFIABLE\n"
    "CONFIDENCE: <integer 0-100>\n"
    "REASONING: <one short paragraph, neutral tone, no hedging>\n"
    "SOURCES: <semicolon-separated URLs or 'none'>"
)


def _parse_field(line, name):
    """Return the trimmed value after 'NAME:' or '' if line doesn't match."""
    prefix = name + ":"
    if line.upper().startswith(prefix):
        return line[len(prefix):].strip()
    return ""


def _parse_llm_output(text):
    """Parse the four expected fields. Missing fields fall back to safe defaults."""
    verdict     = ""
    confidence  = 0
    reasoning   = ""
    sources     = ""
    for raw in text.splitlines():
        line = raw.strip()
        if not line:
            continue
        v = _parse_field(line, "VERDICT")
        if v:
            v = v.upper().split()[0] if v.split() else ""
            if v in _ALLOWED_VERDICTS:
                verdict = v
            continue
        c = _parse_field(line, "CONFIDENCE")
        if c:
            try:
                n = int("".join(ch for ch in c if ch.isdigit() or ch == "-"))
                confidence = max(0, min(100, n))
            except Exception:
                pass
            continue
        r = _parse_field(line, "REASONING")
        if r:
            reasoning = r
            continue
        s = _parse_field(line, "SOURCES")
        if s:
            sources = s
            continue
    if not verdict:
        verdict = VERDICT_UNVERIFIABLE
    return verdict, confidence, reasoning, sources


# --------------------------------------------------------------------------- #
# Fact-checking primitive                                                     #
# --------------------------------------------------------------------------- #

def _fetch_url_excerpt(url, max_chars):
    response = gl.nondet.web.request(url, method="GET")
    if response.status >= 400:
        raise Exception("HTTP " + str(response.status) + " from " + url)
    body = response.body
    if isinstance(body, bytes):
        body = body.decode("utf-8", errors="replace")
    return body[:max_chars]


def _fact_check(claim_text, optional_context):
    """Ask each validator LLM to fact-check the claim and reach consensus."""

    def _block():
        prompt = (
            "You are a strict, careful fact-checker. Rely on widely-known facts "
            "and basic reasoning. If the claim is opinion, ambiguous, about the "
            "future, or impossible to settle, return UNVERIFIABLE.\n\n"
            + _OUTPUT_FORMAT + "\n\n"
            + ("CONTEXT (excerpt from URL):\n" + optional_context + "\n\n" if optional_context else "")
            + "CLAIM:\n" + claim_text
        )
        raw = gl.nondet.exec_prompt(prompt).strip()
        verdict, confidence, reasoning, sources = _parse_llm_output(raw)
        # Re-emit canonical form so validators compare apples to apples.
        return (
            "VERDICT: " + verdict + "\n"
            + "CONFIDENCE: " + str(confidence) + "\n"
            + "REASONING: " + reasoning + "\n"
            + "SOURCES: " + sources
        )

    principle = (
        "Both responses must reach the SAME VERDICT (TRUE / FALSE / "
        "UNVERIFIABLE). The CONFIDENCE numbers may differ by up to 25 points. "
        "REASONING and SOURCES may differ in wording or detail."
    )
    return gl.eq_principle.prompt_comparative(_block, principle)


# --------------------------------------------------------------------------- #
# Contract                                                                    #
# --------------------------------------------------------------------------- #

class BullshitDetector(gl.Contract):
    last_claim:        str
    last_url:          str
    last_verdict:      str
    last_confidence:   u256
    last_reasoning:    str
    last_sources:      str
    last_submitter:    str

    total_count:       u256
    true_count:        u256
    false_count:       u256
    unverifiable_count: u256

    def __init__(self):
        self.last_claim         = ""
        self.last_url           = ""
        self.last_verdict       = ""
        self.last_confidence    = u256(0)
        self.last_reasoning     = ""
        self.last_sources       = ""
        self.last_submitter     = ""

        self.total_count        = u256(0)
        self.true_count         = u256(0)
        self.false_count        = u256(0)
        self.unverifiable_count = u256(0)

    # ----- Internal helper -----
    def _commit(self, claim, url, raw_result):
        verdict, confidence, reasoning, sources = _parse_llm_output(raw_result)
        self.last_claim         = claim
        self.last_url           = url
        self.last_verdict       = verdict
        self.last_confidence    = u256(confidence)
        self.last_reasoning     = reasoning
        self.last_sources       = sources
        self.total_count        = u256(int(self.total_count) + 1)
        if verdict == VERDICT_TRUE:
            self.true_count = u256(int(self.true_count) + 1)
        elif verdict == VERDICT_FALSE:
            self.false_count = u256(int(self.false_count) + 1)
        else:
            self.unverifiable_count = u256(int(self.unverifiable_count) + 1)

    # ----- Public writes -----
    @gl.public.write
    def verify_claim(self, claim: str) -> None:
        """Fact-check a free-form text claim."""
        text = claim.strip()
        if len(text) < 4:
            raise Exception("claim is too short")
        if len(text) > 1000:
            raise Exception("claim is too long (1000 char max)")
        result = _fact_check(text, "")
        self._commit(text, "", result)

    @gl.public.write
    def verify_url(self, url: str, claim_about_url: str) -> None:
        """Fetch a URL and fact-check the supplied claim against its content."""
        if not (url.startswith("http://") or url.startswith("https://")):
            raise Exception("url must be absolute (http:// or https://)")
        claim_text = claim_about_url.strip()
        if len(claim_text) < 4:
            raise Exception("claim_about_url is too short")
        excerpt = _fetch_url_excerpt(url, 4000)
        result = _fact_check(claim_text, excerpt)
        self._commit(claim_text, url, result)

    # ----- Public views -----
    @gl.public.view
    def get_last_claim(self) -> str:
        return self.last_claim

    @gl.public.view
    def get_last_url(self) -> str:
        return self.last_url

    @gl.public.view
    def get_last_verdict(self) -> str:
        return self.last_verdict

    @gl.public.view
    def get_last_confidence(self) -> u256:
        return self.last_confidence

    @gl.public.view
    def get_last_reasoning(self) -> str:
        return self.last_reasoning

    @gl.public.view
    def get_last_sources(self) -> str:
        return self.last_sources

    @gl.public.view
    def get_total_count(self) -> u256:
        return self.total_count

    @gl.public.view
    def get_true_count(self) -> u256:
        return self.true_count

    @gl.public.view
    def get_false_count(self) -> u256:
        return self.false_count

    @gl.public.view
    def get_unverifiable_count(self) -> u256:
        return self.unverifiable_count
