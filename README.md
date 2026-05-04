# BullshitDetector

> A smell test for the internet, on chain.

Submit any claim &mdash; free text or a URL. **Five validator LLMs
fact-check it independently** and reach consensus on a `TRUE` / `FALSE` /
`UNVERIFIABLE` verdict, plus a confidence score and reasoning. Every
verdict is committed to chain forever.

Powered by [GenLayer](https://docs.genlayer.com), the only chain where
contracts can call the live web and reach consensus on **the judgement
of an LLM** rather than just a deterministic byte sequence.

> **GenLayer Builders Program submission &middot; Projects & Milestones**

---

## Live deployment

- 🌐 **Website**: <https://bullshit-detector-brown.vercel.app/>
- Network: **studionet**
- Contract: `0xa99B32CC23189e3DE78343F96840097dcC27a081`

## What the contract does

`studio_contracts/bullshit_detector.py` exposes:

| Method | Kind | What it does |
| ------ | ---- | ------------ |
| `verify_claim(claim)` | write | Fact-check a free-form text claim. |
| `verify_url(url, claim_about_url)` | write | Fetch a page, then fact-check a claim against its content. |
| `get_last_*` | view | Latest claim, URL, verdict, confidence, reasoning, sources. |
| `get_total_count`, `get_true_count`, `get_false_count`, `get_unverifiable_count` | view | Running tallies. |

### How consensus is enforced

```python
principle = (
    "Both responses must reach the SAME VERDICT (TRUE / FALSE / UNVERIFIABLE). "
    "The CONFIDENCE numbers may differ by up to 25 points. "
    "REASONING and SOURCES may differ in wording or detail."
)
return gl.eq_principle.prompt_comparative(_block, principle)
```

If even one validator disagrees on the verdict, the transaction reverts
&mdash; nothing pollutes the on-chain state.

## What the website does

`site/index.html` + `site/app.js`:

1. Reads the latest verdict and tallies on every page-load &mdash; no
   wallet required. Auto-refreshes every 30 seconds.
2. Lets a user submit a new claim via MetaMask: a single transaction
   triggers all five validators in parallel, takes 30-60 seconds, and
   the verdict appears inline.
3. Two input modes: free text claim, or URL + claim-about-URL.

The frontend talks to the contract through
[`genlayer-js`](https://github.com/genlayerlabs/genlayer-js) loaded
from `esm.sh`, so there is no build step.

## Quick start

### Tests offline

```bash
pip install pytest
pytest -q
```

8 parser tests, all green, all offline (no `gl` SDK required).

### Deploy the contract

Open <https://studio.genlayer.com>, paste
`studio_contracts/bullshit_detector.py`, click **Deploy** (no
constructor args), copy the deployed address.

### Wire it to the site

```js
// site/config.js
export const DEFAULTS = {
  network: "studionet",
  contract: "0xYOURADDRESS",
  autoSwitchNetwork: true,
};
```

### Serve

```bash
cd site
python -m http.server 8765
```

Open `http://localhost:8765` **in a real browser tab** (Chrome / Brave /
Firefox &mdash; not in an IDE preview iframe; MetaMask cannot inject
into iframes).

## Repository layout

```
bullshit-detector/
|-- README.md
|-- LICENSE
|-- pyproject.toml
|-- studio_contracts/
|   |-- README.md
|   `-- bullshit_detector.py
|-- site/
|   |-- index.html
|   |-- app.js
|   `-- config.js
`-- tests/
    `-- test_bullshit_parser.py
```

## License

MIT.
