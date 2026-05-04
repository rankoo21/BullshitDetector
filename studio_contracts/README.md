# studio_contracts/

## `bullshit_detector.py`

Single Intelligent Contract that verifies claims via LLM consensus.

### Deploy

1. Open <https://studio.genlayer.com>.
2. New contract -> paste the file -> **Deploy** (no constructor args).
3. Copy the deployed address.
4. Drop the address into `../site/config.js`.

### Public surface

- `verify_claim(claim: str)` -- fact-check a text claim.
- `verify_url(url: str, claim_about_url: str)` -- fact-check a claim
  against a fetched webpage.
- `get_last_claim` / `get_last_url` / `get_last_verdict` /
  `get_last_confidence` / `get_last_reasoning` / `get_last_sources`
- `get_total_count` / `get_true_count` / `get_false_count` /
  `get_unverifiable_count`

### Why a single contract?

So you can share **one address** with anyone. The landing page reads the
latest verdict and tallies from the same contract on every load.
