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
  mode: "claim", // "claim" | "url"
};

const $ = (sel) => document.querySelector(sel);

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
  setSdkStatus(STATE.account ? "ready · signer on" : "ready · read-only");
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
      "Chrome/Brave/Firefox tab instead — MetaMask cannot inject into iframes."
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
  const btn = $("#connect-btn");
  const info = $("#wallet-info");
  if (STATE.account) {
    const short = STATE.account.slice(0, 6) + "..." + STATE.account.slice(-4);
    btn.textContent = "Disconnect";
    btn.onclick = disconnect;
    info.classList.remove("hidden");
    info.textContent = short + " · " + STATE.network;
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
    claimTab.className = "px-4 py-1.5 rounded-md text-sm font-semibold bg-white/15";
    urlTab.className   = "px-4 py-1.5 rounded-md text-sm font-semibold text-slate-400 hover:text-slate-200";
    claimIn.classList.remove("hidden");
    urlIn.classList.add("hidden");
  } else {
    urlTab.className   = "px-4 py-1.5 rounded-md text-sm font-semibold bg-white/15";
    claimTab.className = "px-4 py-1.5 rounded-md text-sm font-semibold text-slate-400 hover:text-slate-200";
    urlIn.classList.remove("hidden");
    claimIn.classList.add("hidden");
  }
}

// --------------------------------------------------------------------- //
// Status banner                                                         //
// --------------------------------------------------------------------- //

function showStatus(text, kind = "info") {
  const colors = {
    info:    "bg-slate-800 text-slate-200 border-slate-700",
    pending: "bg-amber-500/10 text-amber-200 border-amber-500/30",
    success: "bg-emerald-500/10 text-emerald-200 border-emerald-500/30",
    error:   "bg-rose-500/10 text-rose-200 border-rose-500/30",
  };
  const el = $("#status-banner");
  el.className = "mt-4 rounded-xl p-4 text-sm font-mono border whitespace-pre-wrap break-all " + colors[kind];
  el.textContent = text;
  el.classList.remove("hidden");
}

function hideStatus() {
  $("#status-banner").classList.add("hidden");
}

// --------------------------------------------------------------------- //
// Verdict rendering                                                     //
// --------------------------------------------------------------------- //

function pillClassesFor(verdict) {
  const v = (verdict || "").toUpperCase();
  if (v === "TRUE")  return { bg: "verdict-true",  text: "TRUE",         emoji: "✅" };
  if (v === "FALSE") return { bg: "verdict-false", text: "FALSE",        emoji: "❌" };
  return                  { bg: "verdict-unv",   text: "UNVERIFIABLE", emoji: "🤷" };
}

function renderVerdict({ claim, url, verdict, confidence, reasoning, sources }) {
  const card = $("#verdict-card");
  const pill = $("#verdict-pill");
  const p = pillClassesFor(verdict);
  pill.className = "inline-block px-4 py-1.5 rounded-full text-sm font-extrabold tracking-wide mb-4 text-white " + p.bg;
  pill.textContent = p.emoji + "  " + p.text;
  $("#verdict-claim").textContent = (url ? "[" + url + "] " : "") + claim;
  $("#verdict-confidence").textContent = (confidence ?? 0) + "%";
  $("#verdict-sources").textContent = sources || "—";
  $("#verdict-reasoning").textContent = reasoning || "—";
  card.classList.remove("hidden");
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
    "  on " + STATE.network;

  const reads = [
    ["get_total_count",        (v) => $("#stat-total").textContent  = String(v)],
    ["get_true_count",         (v) => $("#stat-true").textContent   = String(v)],
    ["get_false_count",        (v) => $("#stat-false").textContent  = String(v)],
    ["get_unverifiable_count", (v) => $("#stat-unv").textContent    = String(v)],
    ["get_last_claim",         (v) => {
      const s = String(v) || "";
      $("#recent-claim").textContent = s || "no submissions yet";
    }],
    ["get_last_url",           (v) => {
      const s = String(v) || "";
      $("#recent-url").textContent = s ? "↗ " + s : "";
    }],
    ["get_last_verdict",       (v) => {
      const s = String(v) || "";
      const pill = $("#recent-verdict-pill");
      if (!s) { pill.classList.add("hidden"); return; }
      const p = pillClassesFor(s);
      pill.className = "px-2 py-1 rounded font-bold text-white " + p.bg;
      pill.textContent = p.emoji + " " + p.text;
      pill.classList.remove("hidden");
    }],
    ["get_last_confidence",    (v) => {
      const n = Number(v) || 0;
      $("#recent-confidence").textContent = n ? n + "% confidence" : "";
    }],
  ];

  await Promise.all(reads.map(async ([fn, set]) => {
    try {
      const v = await STATE.readClient.readContract({
        address: STATE.contract,
        functionName: fn,
        args: [],
      });
      set(v);
    } catch (e) {
      console.warn("read failed", fn, e);
    }
  }));
}

async function readVerdictDetails() {
  /* Returns the full verdict struct from chain. Used after a successful write. */
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
  if (STATE.mode === "claim") {
    const claim = $("#claim-text").value.trim();
    if (claim.length < 4) {
      showStatus("Type a claim with at least 4 characters.", "error");
      return;
    }
    method = "verify_claim";
    args = [claim];
  } else {
    const url = $("#url-input").value.trim();
    const claim = $("#url-claim-text").value.trim();
    if (!/^https?:\/\//.test(url)) {
      showStatus("URL must start with http:// or https://", "error");
      return;
    }
    if (claim.length < 4) {
      showStatus("Describe the claim you want verified about this URL.", "error");
      return;
    }
    method = "verify_url";
    args = [url, claim];
  }

  const btn = $("#verify-btn");
  btn.disabled = true;
  $("#verdict-card").classList.add("hidden");

  try {
    showStatus("Approve the transaction in MetaMask...", "pending");
    try { await STATE.writeClient.connect(STATE.network); } catch (_) {}

    const txHash = await STATE.writeClient.writeContract({
      address: STATE.contract,
      functionName: method,
      args,
      value: BigInt(0),
    });
    showStatus("tx submitted: " + txHash + "\nFive validators are fact-checking independently. This usually takes 30-90s.", "pending");

    /* GenLayer consensus regularly takes 45-90s. Give it up to ~5 minutes
       and fall back to reading the chain state even if waitForReceipt
       eventually gives up: the tx often lands successfully while the
       client-side poller is still waiting. */
    let receiptOk = false;
    try {
      await STATE.readClient.waitForTransactionReceipt({
        hash: txHash,
        status: TransactionStatus.ACCEPTED,
        retries: 120,
        interval: 2500,
      });
      receiptOk = true;
    } catch (waitErr) {
      console.warn("waitForTransactionReceipt timed out, will fall back to reading chain state:", waitErr);
    }

    showStatus(
      (receiptOk ? "ACCEPTED" : "Still waiting on chain confirmation") +
      " · reading verdict from chain...",
      "pending"
    );

    /* Poll the view methods for up to another ~90s to catch the verdict
       the moment it lands, whether or not waitForReceipt returned cleanly. */
    let details = null;
    for (let i = 0; i < 30; i++) {
      const d = await readVerdictDetails();
      if (d.verdict && d.claim) {
        details = d;
        break;
      }
      await new Promise((r) => setTimeout(r, 3000));
    }

    if (details) {
      renderVerdict(details);
      showStatus("✓ Consensus reached. tx: " + txHash, "success");
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
    showStatus("Failed: " + (err.message || err), "error");
  } finally {
    btn.disabled = false;
  }
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

  // Verify
  $("#verify-btn").addEventListener("click", verify);

  // Stats refresh
  $("#stats-refresh").addEventListener("click", refreshStats);

  // Auto-reconnect
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
