/* BullshitDetector frontend.
 *
 * Single-page fact-checker UI on top of the BullshitDetector Intelligent
 * Contract. Reads on-chain stats (no wallet required) on every load and
 * after each successful submission. Submits claims via genlayer-js +
 * MetaMask.
 */

import { createClient } from "https://esm.sh/genlayer-js@latest";
import * as chains from "https://esm.sh/genlayer-js@latest/chains";
import { TransactionStatus } from "https://esm.sh/genlayer-js@latest/types";
import { DEFAULTS } from "./config.js";

const STATE = {
  account: null,
  network: localStorage.getItem("network") || DEFAULTS.network,
  contract: DEFAULTS.contract || "",
  readClient: null,
  writeClient: null,
  mode: "claim",
  startedAt: 0,
  countdownTimer: null,
};

const $  = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

/* Five mock validator identities used only for the thinking animation.
   The real on-chain validator set varies; these are representative. */
const VALIDATORS = [
  { name: "Gemini",   emoji: "\u{1F52E}", color: "from-sky-500/20 to-blue-500/20",      border: "border-sky-500/30" },
  { name: "GPT",      emoji: "\u{1F9E0}", color: "from-emerald-500/20 to-teal-500/20",  border: "border-emerald-500/30" },
  { name: "Kimi",     emoji: "\u{1F31C}", color: "from-purple-500/20 to-fuchsia-500/20",border: "border-purple-500/30" },
  { name: "Claude",   emoji: "\u{1F3AF}", color: "from-orange-500/20 to-amber-500/20",  border: "border-orange-500/30" },
  { name: "Llama",    emoji: "\u{1F999}", color: "from-rose-500/20 to-pink-500/20",     border: "border-rose-500/30" },
];

/* GenLayer-specific consensus stages, in order. Used by pollGenStatus() to
   show granular progress feedback: PENDING -> PROPOSING -> COMMITTING ->
   REVEALING -> ACCEPTED -> FINALIZED. Standard eth_getTransactionByHash
   only exposes "pending" / "completed", which makes a 60s wait feel like
   the page is frozen; gen_getTransactionByHash exposes every stage. */
const STAGE_ORDER = [
  "PENDING", "PROPOSING", "COMMITTING", "REVEALING",
  "ACCEPTED", "UNDETERMINED", "FINALIZED",
];

const STAGE_LABEL = {
  PENDING:      "queued for validators",
  PROPOSING:    "leader is drafting verdict",
  COMMITTING:   "validators are committing votes",
  REVEALING:    "validators reveal votes",
  ACCEPTED:     "consensus reached - reading verdict",
  UNDETERMINED: "no consensus, retrying",
  FINALIZED:    "verdict finalized",
};

/* Poll GenLayer's gen_getTransactionByHash directly (alongside the
   higher-level genlayer-js helpers) so we can surface the consensus stage
   as it changes. Returns the latest known stage string. */
async function fetchGenStatus(txHash) {
  try {
    const rpcUrl = chainFor(STATE.network).rpcUrls.default.http[0];
    const methods = ["gen_getTransactionByHash", "sim_getTransactionByHash", "eth_getTransactionByHash"];
    for (const method of methods) {
      const resp = await fetch(rpcUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params: [txHash] }),
      });
      if (!resp.ok) continue;
      const j = await resp.json();
      if (!j.result) continue;
      const status = j.result.status || j.result.tx_status;
      if (status) return String(status).toUpperCase();
    }
  } catch (_) { /* swallow - polling, not critical */ }
  return null;
}

// --------------------------------------------------------------------- //
// Clients                                                               //
// --------------------------------------------------------------------- //

function chainFor(name) {
  const c = chains[name];
  if (!c) throw new Error("Unknown chain: " + name);
  return c;
}

function rebuildClients() {
  const chain = chainFor(STATE.network);
  STATE.readClient = createClient({ chain });
  STATE.writeClient = (STATE.account && window.ethereum)
    ? createClient({ chain, account: STATE.account, provider: window.ethereum })
    : null;
  setSdkStatus(STATE.account ? "ready \u00b7 signer on" : "ready \u00b7 read-only");
}

function setSdkStatus(text) {
  $("#sdk-status").textContent = text;
}

// --------------------------------------------------------------------- //
// Wallet                                                                //
// --------------------------------------------------------------------- //

async function connectWallet() {
  if (!window.ethereum) {
    alert(
      "MetaMask not detected.\n\n" +
      "1) Install MetaMask: https://metamask.io/download\n" +
      "2) If you opened this page inside an IDE preview, open it in a real " +
      "Chrome/Brave/Firefox tab instead - MetaMask cannot inject into iframes."
    );
    return;
  }
  try {
    const accs = await window.ethereum.request({ method: "eth_requestAccounts" });
    STATE.account = accs[0];
    rebuildClients();
    renderWallet();
    if (DEFAULTS.autoSwitchNetwork && STATE.writeClient) {
      try { await STATE.writeClient.connect(STATE.network); } catch (e) { console.warn(e); }
    }
  } catch (err) {
    alert("Failed to connect: " + err.message);
  }
}

function disconnect() {
  STATE.account = null;
  rebuildClients();
  renderWallet();
}

function renderWallet() {
  const btn  = $("#connect-btn");
  const info = $("#wallet-info");
  if (STATE.account) {
    const short = STATE.account.slice(0, 6) + "..." + STATE.account.slice(-4);
    btn.textContent = "Disconnect";
    btn.onclick = disconnect;
    info.classList.remove("hidden");
    info.textContent = short + " \u00b7 " + STATE.network;
  } else {
    btn.textContent = "Connect Wallet";
    btn.onclick = connectWallet;
    info.classList.add("hidden");
  }
}

// --------------------------------------------------------------------- //
// Tabs                                                                  //
// --------------------------------------------------------------------- //

function setMode(mode) {
  STATE.mode = mode;
  const claimTab = $("#tab-claim");
  const urlTab   = $("#tab-url");
  const claimIn  = $("#input-claim");
  const urlIn    = $("#input-url");
  if (mode === "claim") {
    claimTab.className = "px-5 py-2 rounded-lg text-sm font-semibold bg-white/10";
    urlTab.className   = "px-5 py-2 rounded-lg text-sm font-semibold text-slate-400 hover:text-slate-200";
    claimIn.classList.remove("hidden");
    urlIn.classList.add("hidden");
  } else {
    urlTab.className   = "px-5 py-2 rounded-lg text-sm font-semibold bg-white/10";
    claimTab.className = "px-5 py-2 rounded-lg text-sm font-semibold text-slate-400 hover:text-slate-200";
    urlIn.classList.remove("hidden");
    claimIn.classList.add("hidden");
  }
}

// --------------------------------------------------------------------- //
// Status banner                                                         //
// --------------------------------------------------------------------- //

function showStatus(text, kind = "info") {
  const colors = {
    info:    "bg-slate-800/70 text-slate-200 border-slate-700",
    pending: "bg-amber-500/10 text-amber-200 border-amber-500/30",
    success: "bg-emerald-500/10 text-emerald-200 border-emerald-500/30",
    error:   "bg-rose-500/10 text-rose-200 border-rose-500/30",
  };
  const el = $("#status-banner");
  el.className = "mt-4 rounded-xl p-4 text-sm mono border whitespace-pre-wrap break-all " + colors[kind];
  el.textContent = text;
  el.classList.remove("hidden");
}

function hideStatus() {
  $("#status-banner").classList.add("hidden");
}

// --------------------------------------------------------------------- //
// Validator thinking row                                                //
// --------------------------------------------------------------------- //

function renderValidatorsRow() {
  const list = $("#validators-list");
  list.innerHTML = "";
  VALIDATORS.forEach((v, i) => {
    const col = document.createElement("div");
    col.className = "validator flex flex-col items-center gap-2 p-3 rounded-xl bg-gradient-to-br " + v.color + " border " + v.border;
    col.style.setProperty("--delay", (i * 0.15) + "s");
    col.innerHTML =
      '<div class="text-3xl">' + v.emoji + '</div>' +
      '<div class="text-[10px] font-semibold text-slate-300 uppercase tracking-wider">' + v.name + '</div>' +
      '<div class="flex gap-1">' +
        '<span class="dot w-1 h-1 rounded-full bg-white" style="--delay:0s"></span>' +
        '<span class="dot w-1 h-1 rounded-full bg-white" style="--delay:0.2s"></span>' +
        '<span class="dot w-1 h-1 rounded-full bg-white" style="--delay:0.4s"></span>' +
      '</div>';
    list.appendChild(col);
  });
}

function showValidators() {
  $("#validators-row").classList.remove("hidden");
  $("#consensus-stage").textContent = "starting consensus\u2026";
  $("#consensus-bar").style.width = "5%";
  STATE.startedAt = Date.now();
  if (STATE.countdownTimer) clearInterval(STATE.countdownTimer);
  STATE.countdownTimer = setInterval(() => {
    const elapsed = Math.floor((Date.now() - STATE.startedAt) / 1000);
    $("#tx-countdown").textContent = "elapsed " + elapsed + "s";
  }, 500);
}

function hideValidators() {
  $("#validators-row").classList.add("hidden");
  if (STATE.countdownTimer) {
    clearInterval(STATE.countdownTimer);
    STATE.countdownTimer = null;
  }
}

function setConsensusStage(stage) {
  if (!stage) return;
  const label = STAGE_LABEL[stage] || stage.toLowerCase();
  $("#consensus-stage").textContent = stage + " \u00b7 " + label;
  const idx = STAGE_ORDER.indexOf(stage);
  if (idx >= 0) {
    const pct = Math.min(100, Math.round(((idx + 1) / STAGE_ORDER.length) * 100));
    $("#consensus-bar").style.width = pct + "%";
  }
}

// --------------------------------------------------------------------- //
// Verdict rendering                                                     //
// --------------------------------------------------------------------- //

function pillClassesFor(verdict) {
  const v = (verdict || "").toUpperCase();
  if (v === "TRUE")  return { cls: "pill-true",  text: "TRUE",         emoji: "\u2714" };
  if (v === "FALSE") return { cls: "pill-false", text: "FALSE",        emoji: "\u2716" };
  return                  { cls: "pill-unv",   text: "UNVERIFIABLE", emoji: "?" };
}

function renderVerdict({ claim, url, verdict, confidence, reasoning, sources, txHash }) {
  const card = $("#verdict-card");
  card.classList.remove("hidden");
  card.classList.remove("verdict-reveal");
  void card.offsetWidth; // reflow to restart animation
  card.classList.add("verdict-reveal");

  const pill = $("#verdict-pill");
  const p = pillClassesFor(verdict);
  pill.className = "inline-block px-4 py-2 rounded-full text-sm font-extrabold tracking-wide text-white " + p.cls;
  pill.textContent = p.emoji + "  " + p.text;

  $("#verdict-claim").textContent = (url ? "[" + url + "] " : "") + claim;

  const conf = Number(confidence) || 0;
  $("#verdict-confidence").textContent = conf;
  const bar = $("#verdict-confidence-bar");
  bar.style.width = conf + "%";
  const verdictColor = {
    "TRUE":   "linear-gradient(90deg, #10b981, #34d399)",
    "FALSE":  "linear-gradient(90deg, #f43f5e, #fb7185)",
  }[(verdict || "").toUpperCase()] || "linear-gradient(90deg, #64748b, #94a3b8)";
  bar.style.background = verdictColor;

  $("#verdict-sources").textContent = sources || "\u2014";
  $("#verdict-reasoning").textContent = reasoning || "\u2014";

  if (txHash) {
    $("#verdict-tx").textContent = "tx " + txHash.slice(0, 10) + "\u2026" + txHash.slice(-8);
  } else {
    $("#verdict-tx").textContent = "";
  }
}

// --------------------------------------------------------------------- //
// On-chain stats panel                                                  //
// --------------------------------------------------------------------- //

async function refreshStats() {
  if (!STATE.contract) {
    $("#contract-addr").textContent = "no contract configured";
    return;
  }
  $("#contract-addr").textContent =
    STATE.contract.slice(0, 8) + "..." + STATE.contract.slice(-6) +
    " \u00b7 " + STATE.network;

  const fetchers = [
    "get_total_count", "get_true_count", "get_false_count", "get_unverifiable_count",
    "get_last_claim", "get_last_url", "get_last_verdict", "get_last_confidence",
  ];

  let results;
  try {
    results = await Promise.all(fetchers.map((fn) =>
      STATE.readClient.readContract({ address: STATE.contract, functionName: fn, args: [] })
        .catch(() => null)
    ));
  } catch (e) { console.warn(e); return; }

  const total = Number(results[0] || 0);
  const t = Number(results[1] || 0);
  const f = Number(results[2] || 0);
  const u = Number(results[3] || 0);
  $("#stat-total").textContent = total;
  $("#stat-true").textContent  = t;
  $("#stat-false").textContent = f;
  $("#stat-unv").textContent   = u;
  const denom = Math.max(total, 1);
  $("#stat-true-bar").style.width  = ((t / denom) * 100) + "%";
  $("#stat-false-bar").style.width = ((f / denom) * 100) + "%";
  $("#stat-unv-bar").style.width   = ((u / denom) * 100) + "%";

  const recentClaim  = String(results[4] || "");
  const recentUrl    = String(results[5] || "");
  const recentVerdict = String(results[6] || "");
  const recentConf   = Number(results[7] || 0);

  $("#recent-claim").textContent = recentClaim || "no submissions yet";
  $("#recent-url").textContent   = recentUrl ? "\u2197 " + recentUrl : "";

  const pill = $("#recent-verdict-pill");
  if (recentVerdict) {
    const p = pillClassesFor(recentVerdict);
    pill.className = "px-3 py-1.5 rounded-full font-bold text-white " + p.cls;
    pill.textContent = p.emoji + " " + p.text;
    pill.classList.remove("hidden");
    $("#recent-confidence").textContent = recentConf + "% confidence";
  } else {
    pill.classList.add("hidden");
    $("#recent-confidence").textContent = "";
  }
}

async function readVerdictDetails() {
  const fields = ["get_last_claim", "get_last_url", "get_last_verdict",
                  "get_last_confidence", "get_last_reasoning", "get_last_sources"];
  const results = await Promise.all(fields.map((f) =>
    STATE.readClient.readContract({ address: STATE.contract, functionName: f, args: [] })
  ));
  return {
    claim:      String(results[0]),
    url:        String(results[1]),
    verdict:    String(results[2]),
    confidence: Number(results[3]),
    reasoning:  String(results[4]),
    sources:    String(results[5]),
  };
}

// --------------------------------------------------------------------- //
// Submit                                                                //
// --------------------------------------------------------------------- //

async function verify() {
  if (!STATE.contract) {
    showStatus("No BullshitDetector contract configured. Edit site/config.js.", "error");
    return;
  }
  if (!STATE.writeClient) {
    showStatus("Connect your wallet first to submit a transaction.", "error");
    return;
  }

  let method, args;
  let submittedClaim = "";
  let submittedUrl = "";
  if (STATE.mode === "claim") {
    submittedClaim = $("#claim-text").value.trim();
    if (submittedClaim.length < 4) {
      showStatus("Type a claim with at least 4 characters.", "error");
      return;
    }
    method = "verify_claim";
    args = [submittedClaim];
  } else {
    submittedUrl = $("#url-input").value.trim();
    submittedClaim = $("#url-claim-text").value.trim();
    if (!/^https?:\/\//.test(submittedUrl)) {
      showStatus("URL must start with http:// or https://", "error");
      return;
    }
    if (submittedClaim.length < 4) {
      showStatus("Describe the claim you want verified about this URL.", "error");
      return;
    }
    method = "verify_url";
    args = [submittedUrl, submittedClaim];
  }

  const btn = $("#verify-btn");
  btn.disabled = true;
  $("#verdict-card").classList.add("hidden");
  hideStatus();

  try {
    showStatus("Approve the transaction in MetaMask\u2026", "pending");
    try { await STATE.writeClient.connect(STATE.network); } catch (_) {}

    const txHash = await STATE.writeClient.writeContract({
      address: STATE.contract,
      functionName: method,
      args,
      value: BigInt(0),
    });
    showValidators();
    showStatus("tx submitted: " + txHash + "\nLeader will draft a verdict in ~10s, then four more validators must agree. Total: 30-120s.", "pending");

    /* Run three parallel pollers and race for the first verdict that
       lands. The loops are intentionally cheap (one HTTP per 2-3s):
         - genStatusLoop:  polls gen_getTransactionByHash to surface the
                           consensus stage (PENDING -> PROPOSING -> ...).
         - storageLoop:    polls our contract view methods so we can
                           render the verdict the moment it is committed,
                           independent of whatever the receipt helper
                           thinks. This is what actually unblocks the UI.
         - receiptLoop:    the genlayer-js helper, kept for compatibility
                           but treated as best-effort. */

    let details = null;
    let stopped = false;

    const stop = () => { stopped = true; };

    const genStatusLoop = (async () => {
      let last = "";
      for (let i = 0; i < 90 && !stopped; i++) {
        const stage = await fetchGenStatus(txHash);
        if (stage && stage !== last) {
          last = stage;
          setConsensusStage(stage);
        }
        await new Promise((r) => setTimeout(r, 2500));
      }
    })();

    const storageLoop = (async () => {
      for (let i = 0; i < 90 && !stopped; i++) {
        try {
          const d = await readVerdictDetails();
          const claimMatch = d.claim && d.claim.trim() === submittedClaim;
          const urlMatch = STATE.mode === "url"
            ? (d.url && d.url.trim() === submittedUrl)
            : true;
          if (d.verdict && claimMatch && urlMatch) { details = d; stop(); return; }
        } catch (_) { /* contract may briefly be unavailable, retry */ }
        await new Promise((r) => setTimeout(r, 2500));
      }
    })();

    const receiptLoop = (async () => {
      try {
        await STATE.readClient.waitForTransactionReceipt({
          hash: txHash,
          status: TransactionStatus.ACCEPTED,
          retries: 120,
          interval: 2500,
        });
      } catch (_) { /* fine - storageLoop is the source of truth */ }
    })();

    await Promise.race([storageLoop, receiptLoop]);
    stop();
    /* Make sure genStatus / receipt loops finish quietly. */
    await Promise.allSettled([genStatusLoop, storageLoop, receiptLoop]);

    /* If the receipt helper finished first, give storageLoop one last
       chance synchronously - the verdict often lands within the next
       second or two after ACCEPTED. */
    if (!details) {
      for (let i = 0; i < 10; i++) {
        try {
          const d = await readVerdictDetails();
          const claimMatch = d.claim && d.claim.trim() === submittedClaim;
          const urlMatch = STATE.mode === "url"
            ? (d.url && d.url.trim() === submittedUrl)
            : true;
          if (d.verdict && claimMatch && urlMatch) { details = d; break; }
        } catch (_) { /* retry */ }
        await new Promise((r) => setTimeout(r, 2000));
      }
    }

    hideValidators();

    if (details) {
      renderVerdict({ ...details, txHash });
      showStatus("\u2713 Consensus reached. tx: " + txHash, "success");
    } else {
      showStatus(
        "Transaction submitted but the verdict hasn't landed yet.\n" +
        "tx: " + txHash + "\n" +
        "Refresh the stats panel in a minute to see the result.",
        "pending"
      );
    }
    refreshStats();
  } catch (err) {
    hideValidators();
    showStatus("Failed: " + (err.message || err), "error");
  } finally {
    btn.disabled = false;
  }
}

// --------------------------------------------------------------------- //
// Copy helpers                                                          //
// --------------------------------------------------------------------- //

async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (_) {
    return false;
  }
}

function flashCopied(btn) {
  const prev = btn.textContent;
  btn.textContent = "\u2713 copied";
  setTimeout(() => { btn.textContent = prev; }, 1400);
}

// --------------------------------------------------------------------- //
// Init                                                                  //
// --------------------------------------------------------------------- //

document.addEventListener("DOMContentLoaded", () => {
  // Network selector
  const sel = $("#network-select");
  sel.value = STATE.network;
  sel.addEventListener("change", () => {
    STATE.network = sel.value;
    localStorage.setItem("network", STATE.network);
    rebuildClients();
    renderWallet();
    refreshStats();
  });

  // Tabs
  $("#tab-claim").addEventListener("click", () => setMode("claim"));
  $("#tab-url").addEventListener("click",   () => setMode("url"));

  // Example chips
  $$(".example-chip").forEach((btn) => {
    btn.addEventListener("click", () => {
      $("#claim-text").value = btn.getAttribute("data-claim") || "";
      $("#claim-text").focus();
    });
  });

  // Verify
  $("#verify-btn").addEventListener("click", verify);

  // Stats refresh
  $("#stats-refresh").addEventListener("click", refreshStats);

  // Copy contract
  $("#copy-contract").addEventListener("click", async (e) => {
    const ok = await copyToClipboard(STATE.contract || "");
    if (ok) flashCopied(e.currentTarget);
  });

  // Pre-render the validator row so first submission doesn't flicker
  renderValidatorsRow();

  // Auto-reconnect if MetaMask is already authorised
  if (window.ethereum && window.ethereum.selectedAddress) {
    STATE.account = window.ethereum.selectedAddress;
  }
  rebuildClients();
  renderWallet();
  refreshStats();
  setInterval(refreshStats, 30000);

  if (window.ethereum) {
    window.ethereum.on("accountsChanged", (accs) => {
      STATE.account = accs[0] || null;
      rebuildClients();
      renderWallet();
    });
    window.ethereum.on("chainChanged", () => rebuildClients());
  }
});
